/**
 * Sends queued push notifications (docs/COMPETITIVE_ROADMAP.md F1.7).
 *
 * Woken by the push-sweep cron job through pg_net whenever the outbox has
 * something pending (supabase/migrations/20260930140000_push_notifications.sql).
 * It claims a batch with push_claim, which has already applied each player's
 * settings and quiet hours and dropped anything no longer true, sends each
 * message to its device, and reports back with push_complete, including
 * tokens the push services say are gone.
 *
 * Only the cron job may call this: it must present PUSH_DISPATCH_SECRET,
 * the same value stored in Vault as push_dispatch_secret. verify_jwt is off
 * in supabase/config.toml.
 *
 * Secrets (supabase secrets set …); a platform without its secrets is
 * skipped and its messages are marked failed:
 *   PUSH_DISPATCH_SECRET
 *   iOS:     APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY, [APNS_BUNDLE_ID], [APNS_ENVIRONMENT]
 *   Android: FCM_SERVICE_ACCOUNT
 *   Web:     VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
 *
 * Deploy: supabase functions deploy push-dispatch
 */
import { createClient } from "@supabase/supabase-js";
import { apnsConfigFromEnv, sendApns } from "./apns.ts";
import { type PushKind, pushText } from "./copy.ts";
import { fcmConfigFromEnv, sendFcm } from "./fcm.ts";
import { type SendResult, sendWebPush, type VapidKeys } from "./webpush.ts";

interface ClaimedMessage {
  outboxId: number;
  kind: PushKind;
  roomId: string | null;
  data: Record<string, unknown>;
  platform: "ios" | "android" | "web";
  token: string;
  webP256dh: string | null;
  webAuth: string | null;
  locale: string;
}

// Turn and rematch alerts are useless a minute later; table invitations keep
// a little longer so a phone that was briefly offline still gets them.
const TTL_SECONDS: Record<PushKind, number> = {
  turn: 60,
  rematch: 60,
  friend_table: 600,
  team_table: 600,
};

const BATCH = 100;
// Stop claiming new batches well inside the function's time limit.
const TIME_BUDGET_MS = 20_000;

function vapidFromEnv(): VapidKeys | null {
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const subject = Deno.env.get("VAPID_SUBJECT");
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

function timingSafeEqual(a: string, b: string) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

const apns = apnsConfigFromEnv();
const fcm = fcmConfigFromEnv();
const vapid = vapidFromEnv();

async function send(message: ClaimedMessage): Promise<SendResult> {
  const { title, body } = pushText(message.kind, message.locale, message.data);
  // Tapping opens the room: the table itself, or the join-by-link flow for
  // an invitation (app/room/page.tsx).
  const url = message.roomId ? `/room?id=${message.roomId}` : "/";
  const data = { url, kind: message.kind, roomId: message.roomId ?? "" };
  // One notification per room and kind: a newer turn replaces the last.
  const tag = `${message.kind}-${message.roomId ?? "none"}`;
  const ttlSeconds = TTL_SECONDS[message.kind];

  switch (message.platform) {
    case "ios":
      if (!apns) return "error";
      return sendApns(apns, message.token, { title, body, collapseId: tag, threadId: message.kind, ttlSeconds, data });
    case "android":
      if (!fcm) return "error";
      return sendFcm(fcm, message.token, { title, body, tag, ttlSeconds, data });
    case "web":
      if (!vapid || !message.webP256dh || !message.webAuth) return "error";
      return sendWebPush(
        { endpoint: message.token, p256dh: message.webP256dh, auth: message.webAuth },
        { title, body, tag, ...data },
        vapid,
        { ttlSeconds, topic: tag },
      );
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const secret = Deno.env.get("PUSH_DISPATCH_SECRET");
  const presented = request.headers.get("x-push-secret") ?? "";
  if (!secret || !timingSafeEqual(presented, secret)) {
    return new Response("Forbidden", { status: 403 });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const started = Date.now();
  let sent = 0;
  let failed = 0;
  while (Date.now() - started < TIME_BUDGET_MS) {
    const { data: messages, error } = await admin.rpc("push_claim", { p_limit: BATCH });
    if (error) {
      console.error("push-dispatch: claim failed", error.message);
      return new Response("Claim failed", { status: 500 });
    }
    const batch = (messages ?? []) as ClaimedMessage[];
    if (batch.length === 0) break;

    const outcomes = await Promise.all(
      batch.map((message) =>
        send(message).catch((err) => {
          console.error("push-dispatch: send threw", err);
          return "error" as const;
        })
      ),
    );

    const results = batch.map((message, i) => ({ outboxId: message.outboxId, ok: outcomes[i] === "ok" }));
    const deadTokens = batch.filter((_, i) => outcomes[i] === "gone").map((m) => m.token);
    sent += outcomes.filter((o) => o === "ok").length;
    failed += outcomes.filter((o) => o !== "ok").length;

    const { error: completeError } = await admin.rpc("push_complete", {
      p_results: results,
      p_dead_tokens: deadTokens,
    });
    if (completeError) console.error("push-dispatch: complete failed", completeError.message);
  }

  return Response.json({ sent, failed });
});
