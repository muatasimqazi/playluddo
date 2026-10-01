import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { expect, it } from "vitest";
import { sendSignInCode, verifySignInCode } from "../../lib/supabase/linkAccount";

/**
 * F0.4: a guest's age answer survives signing in, because signing in links the
 * guest instead of replacing it (lib/supabase/linkAccount.ts). Runs the real
 * email-code path against local Supabase, reading the code from Mailpit.
 * Isolated local-only clients and throwaway addresses.
 */
it("a guest who adds their email keeps their user id and age answer; a taken email falls back to sign-in", async () => {
  // The environment wins over .env.local, so this can run against local
  // Supabase while .env.local points elsewhere.
  const env = { ...parseEnv(readFileSync(".env.local", "utf8")), ...process.env };
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Configure local Supabase in .env.local first.");
  if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname)) {
    throw new Error("Integration tests only run against local Supabase.");
  }
  const mailpit = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const guest = createClient(url, anonKey, options);
  const second = createClient(url, anonKey, options);
  const email = `link-${crypto.randomUUID()}@example.com`;
  const userIds: string[] = [];

  try {
    const { data: signedIn, error } = await guest.auth.signInAnonymously();
    if (error) throw error;
    const guestId = signedIn.user!.id;
    userIds.push(guestId);

    const declared = await guest.rpc("declare_age", { p_birth_year: 1990, p_birth_month: 6 });
    if (declared.error) throw declared.error;
    const before = await guest.rpc("get_age_eligibility");
    // Guests never get video, whatever their age (V0).
    expect(before.data).toMatchObject({ declared: true, video: false });

    const sent = await sendSignInCode(guest, "email", email, "http://localhost:3000/");
    expect(sent).toEqual({ error: null, linking: true });

    const code = await waitForCode(mailpit, email);
    const verified = await verifySignInCode(guest, "email", email, code, sent.linking);
    if (verified.error) throw verified.error;

    // Same user, now permanent: the answer carried over without being asked again.
    expect(verified.data.user?.id).toBe(guestId);
    expect(verified.data.user?.is_anonymous).toBe(false);
    const after = await guest.rpc("get_age_eligibility");
    expect(after.data).toMatchObject({ declared: true, video: true });

    // A different guest using the same email is switching accounts, so it gets
    // an ordinary sign-in code and nothing is linked or copied.
    const other = await second.auth.signInAnonymously();
    if (other.error) throw other.error;
    userIds.push(other.data.user!.id);
    const fallback = await sendSignInCode(second, "email", email, "http://localhost:3000/");
    expect(fallback).toEqual({ error: null, linking: false });
  } finally {
    const db = new Client({
      connectionString:
        process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    });
    await db.connect();
    try {
      await db.query("delete from auth.users where id=any($1::uuid[]) or email=$2", [userIds, email]);
    } finally {
      await db.end();
    }
  }
}, 45000);

async function waitForCode(mailpit: string, to: string): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const search = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const { messages } = (await search.json()) as { messages: { ID: string }[] };
    if (messages.length) {
      const message = await fetch(`${mailpit}/api/v1/message/${messages[0].ID}`);
      const { Text, HTML } = (await message.json()) as { Text: string; HTML: string };
      const code = `${Text}\n${HTML}`.match(/\b\d{6,10}\b/)?.[0];
      if (code) return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No sign-in code reached ${to}`);
}
