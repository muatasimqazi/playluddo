/**
 * Short-lived WebRTC ICE servers for the table call (docs/COMPETITIVE_ROADMAP.md
 * Section 7, V1). A public STUN server alone can't punch through strict home
 * routers and mobile carriers, so voice and video need a TURN relay. This mints
 * ephemeral TURN credentials from Twilio's Network Traversal Service at join
 * time, so the client never holds a static TURN secret and the credentials
 * expire on their own (Section 15, R5/R6).
 *
 * The caller must be signed in (a seated player). The Twilio account SID and
 * auth token stay server-side as secrets and never reach the client:
 *   supabase secrets set TWILIO_ACCOUNT_SID=AC... TWILIO_AUTH_TOKEN=...
 * Locally they're read from supabase/functions/.env (or --env-file).
 *
 * Deploy: supabase functions deploy ice-servers
 * verify_jwt is off in supabase/config.toml; the session is checked here with
 * auth.getUser, which also works with asymmetric JWT signing keys.
 *
 * If Twilio is unreachable or unconfigured, this still returns a STUN-only set
 * with `fallback: true` so a call can be attempted (it just won't relay).
 */
import { createClient } from "@supabase/supabase-js";

// Credentials live one hour — long enough for a game, short enough to limit
// exposure if a token leaks. Peers created after this may need a fresh fetch.
const TTL_SECONDS = 3600;

// The RTCIceServer shape the browser's RTCPeerConnection expects (Deno has no
// DOM lib, so it's declared here rather than imported).
interface IceServer {
  urls: string;
  username?: string;
  credential?: string;
}

const STUN_FALLBACK: IceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

interface TwilioIceServer {
  url?: string;
  urls?: string;
  username?: string;
  credential?: string;
}

async function twilioIceServers(): Promise<IceServer[] | null> {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const token = Deno.env.get("TWILIO_AUTH_TOKEN");
  if (!sid || !token) {
    console.error("ice-servers: TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set");
    return null;
  }

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Tokens.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ Ttl: String(TTL_SECONDS) }),
    },
  );

  if (!response.ok) {
    console.error(
      "ice-servers: Twilio token request failed",
      response.status,
      await response.text().catch(() => ""),
    );
    return null;
  }

  const data = (await response.json()) as { ice_servers?: TwilioIceServer[] };
  const servers: IceServer[] = [];
  for (const s of data.ice_servers ?? []) {
    const urls = s.urls ?? s.url;
    if (!urls) continue;
    // Only TURN entries carry credentials; STUN entries are bare.
    servers.push(
      s.username && s.credential
        ? { urls, username: s.username, credential: s.credential }
        : { urls },
    );
  }

  return servers.length > 0 ? servers : null;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const jwt = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "Sign in first." }, 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: { user }, error: userError } = await admin.auth.getUser(jwt);
  if (userError || !user) return json({ error: "Sign in first." }, 401);

  try {
    const servers = await twilioIceServers();
    if (servers) return json({ iceServers: servers, ttl: TTL_SECONDS, fallback: false });
  } catch (error) {
    console.error("ice-servers: unexpected error", error);
  }
  // Never fail the call outright — STUN-only still connects on open networks.
  return json({ iceServers: STUN_FALLBACK, ttl: 0, fallback: true });
});
