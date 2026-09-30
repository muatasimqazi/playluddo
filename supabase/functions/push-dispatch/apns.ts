/**
 * Apple Push Notification service over its HTTP/2 API, authenticated with a
 * token (.p8) key rather than a certificate, so there's nothing to renew
 * yearly. Secrets:
 *   APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY (the .p8 contents),
 *   APNS_BUNDLE_ID (defaults to com.luddohouse.app),
 *   APNS_ENVIRONMENT ("production", the default, or "sandbox").
 *
 * Debug builds from Xcode get sandbox tokens and TestFlight/App Store builds
 * get production ones, and the device can't tell us which it has. A token
 * the configured environment calls BadDeviceToken is retried once against
 * the other one before it's treated as dead.
 */
import { importEs256PrivateKey, signJwt } from "./jwt.ts";
import type { SendResult } from "./webpush.ts";

export interface ApnsConfig {
  keyId: string;
  teamId: string;
  privateKey: string;
  bundleId: string;
  sandbox: boolean;
}

export function apnsConfigFromEnv(): ApnsConfig | null {
  const keyId = Deno.env.get("APNS_KEY_ID");
  const teamId = Deno.env.get("APNS_TEAM_ID");
  const privateKey = Deno.env.get("APNS_PRIVATE_KEY");
  if (!keyId || !teamId || !privateKey) return null;
  return {
    keyId,
    teamId,
    privateKey,
    bundleId: Deno.env.get("APNS_BUNDLE_ID") ?? "com.luddohouse.app",
    sandbox: Deno.env.get("APNS_ENVIRONMENT") === "sandbox",
  };
}

export interface ApnsMessage {
  title: string;
  body: string;
  /** Replaces an earlier notification with the same id (e.g. per room). */
  collapseId: string;
  threadId: string;
  ttlSeconds: number;
  data: Record<string, string>;
}

// Apple wants the provider token reused for up to an hour and refreshed no
// more than every 20 minutes.
let cachedToken: { value: string; issuedAt: number } | null = null;

async function providerToken(config: ApnsConfig): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && now - cachedToken.issuedAt < 40 * 60) return cachedToken.value;
  const key = await importEs256PrivateKey(config.privateKey);
  const value = await signJwt("ES256", key, { iss: config.teamId, iat: now }, { kid: config.keyId });
  cachedToken = { value, issuedAt: now };
  return value;
}

async function post(config: ApnsConfig, sandbox: boolean, token: string, message: ApnsMessage) {
  const host = sandbox ? "api.sandbox.push.apple.com" : "api.push.apple.com";
  const response = await fetch(`https://${host}/3/device/${token}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${await providerToken(config)}`,
      "apns-topic": config.bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-collapse-id": message.collapseId.slice(0, 64),
      "apns-expiration": String(Math.floor(Date.now() / 1000) + message.ttlSeconds),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      aps: {
        alert: { title: message.title, body: message.body },
        sound: "default",
        "thread-id": message.threadId,
      },
      ...message.data,
    }),
  });
  const reason = response.ok
    ? ""
    : ((await response.json().catch(() => ({}))) as { reason?: string }).reason ?? "";
  if (response.ok) await response.body?.cancel();
  return { status: response.status, reason };
}

export async function sendApns(config: ApnsConfig, token: string, message: ApnsMessage): Promise<SendResult> {
  let result = await post(config, config.sandbox, token, message);
  if (result.status === 400 && result.reason === "BadDeviceToken") {
    result = await post(config, !config.sandbox, token, message);
  }
  if (result.status === 200) return "ok";
  if (result.status === 410 || result.reason === "BadDeviceToken" || result.reason === "Unregistered") {
    return "gone";
  }
  console.error("push-dispatch: APNs failed", result.status, result.reason);
  return "error";
}
