#!/usr/bin/env node
/**
 * Generates the "Secret Key (for OAuth)" for Supabase's Apple provider: an
 * ES256 JWT signed with the Sign in with Apple key. Apple caps it at six
 * months, so rerun this and paste the new value into Supabase (Authentication
 * → Sign In / Providers → Apple) before it expires.
 *
 *   node scripts/apple-client-secret.mjs ~/path/to/AuthKey_XXXXXXXXXX.p8
 *
 * The key ID is read from the file name. The secret is copied to the
 * clipboard (macOS) rather than printed; pass --print to print it instead.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { createPrivateKey, sign } from "node:crypto";

const TEAM_ID = "JAK975JG8T";
const SERVICES_ID = "com.luddohouse.web";
const MAX_AGE_SECONDS = 180 * 24 * 60 * 60; // Apple allows up to ~6 months.

const args = process.argv.slice(2);
const keyPath = args.find((arg) => !arg.startsWith("--"));
const keyId = keyPath && basename(keyPath).match(/^AuthKey_([A-Z0-9]{10})\.p8$/)?.[1];
if (!keyPath || !keyId) {
  console.error("Usage: node scripts/apple-client-secret.mjs path/to/AuthKey_XXXXXXXXXX.p8 [--print]");
  process.exit(1);
}

const base64url = (value) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const expires = now + MAX_AGE_SECONDS;
const unsigned = `${base64url({ alg: "ES256", kid: keyId })}.${base64url({
  iss: TEAM_ID,
  iat: now,
  exp: expires,
  aud: "https://appleid.apple.com",
  sub: SERVICES_ID,
})}`;
const signature = sign("sha256", Buffer.from(unsigned), {
  key: createPrivateKey(readFileSync(keyPath)),
  dsaEncoding: "ieee-p1363",
}).toString("base64url");
const secret = `${unsigned}.${signature}`;

const expiry = new Date(expires * 1000).toISOString().slice(0, 10);
if (args.includes("--print")) {
  console.log(secret);
} else {
  execFileSync("pbcopy", { input: secret });
  console.log(`Copied the Apple client secret to the clipboard (key ${keyId}, for ${SERVICES_ID}).`);
}
console.log(`It expires on ${expiry}; generate a new one before then.`);
