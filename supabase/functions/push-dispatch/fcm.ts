/**
 * Firebase Cloud Messaging's HTTP v1 API, for the Android app. Secret:
 *   FCM_SERVICE_ACCOUNT: the JSON key of a service account in the Firebase
 *   project with the "Firebase Cloud Messaging API Admin" role.
 * The service account signs a short JWT that Google swaps for an OAuth
 * access token, cached until shortly before it expires.
 */
import { importRs256PrivateKey, signJwt } from "./jwt.ts";
import type { SendResult } from "./webpush.ts";

export interface FcmConfig {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

export function fcmConfigFromEnv(): FcmConfig | null {
  const raw = Deno.env.get("FCM_SERVICE_ACCOUNT");
  if (!raw) return null;
  try {
    const account = JSON.parse(raw) as { project_id?: string; client_email?: string; private_key?: string };
    if (!account.project_id || !account.client_email || !account.private_key) return null;
    return { projectId: account.project_id, clientEmail: account.client_email, privateKey: account.private_key };
  } catch {
    console.error("push-dispatch: FCM_SERVICE_ACCOUNT is not valid JSON");
    return null;
  }
}

export interface FcmMessage {
  title: string;
  body: string;
  /** Replaces an earlier notification with the same tag (e.g. per room). */
  tag: string;
  ttlSeconds: number;
  data: Record<string, string>;
}

/** Must match the channel the app creates (lib/push/native.ts). */
export const ANDROID_CHANNEL_ID = "table";

let cachedAccess: { token: string; expiresAt: number } | null = null;

async function accessToken(config: FcmConfig): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedAccess && cachedAccess.expiresAt - 60 > now) return cachedAccess.token;
  const assertion = await signJwt("RS256", await importRs256PrivateKey(config.privateKey), {
    iss: config.clientEmail,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) {
    throw new Error(`FCM OAuth failed: ${response.status} ${await response.text().catch(() => "")}`);
  }
  const data = (await response.json()) as { access_token: string; expires_in: number };
  cachedAccess = { token: data.access_token, expiresAt: now + data.expires_in };
  return data.access_token;
}

export async function sendFcm(config: FcmConfig, token: string, message: FcmMessage): Promise<SendResult> {
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${config.projectId}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await accessToken(config)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: message.title, body: message.body },
          data: message.data,
          android: {
            priority: "HIGH",
            ttl: `${message.ttlSeconds}s`,
            collapse_key: message.tag,
            notification: { channel_id: ANDROID_CHANNEL_ID, tag: message.tag },
          },
        },
      }),
    },
  );
  if (response.ok) {
    await response.body?.cancel();
    return "ok";
  }
  const error = (await response.json().catch(() => ({}))) as {
    error?: { status?: string; details?: { errorCode?: string }[] };
  };
  const code = error.error?.details?.find((d) => d.errorCode)?.errorCode ?? error.error?.status;
  if (response.status === 404 || code === "UNREGISTERED") return "gone";
  console.error("push-dispatch: FCM failed", response.status, code);
  return "error";
}
