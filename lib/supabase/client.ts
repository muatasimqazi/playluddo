import { createBrowserClient } from "@supabase/ssr";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { isNativeApp } from "../native";

// One client per page, like createBrowserClient's own browser singleton —
// several auth clients sharing a storage key race each other's refreshes.
let nativeClient: SupabaseClient | undefined;

/**
 * Browser Supabase client. This is the only client the app needs for MVP —
 * every game mutation goes through a SECURITY DEFINER RPC (`supabase.rpc(...)`)
 * called under the signed-in user's own session; there is no server-side
 * service-role client anywhere in this app. See docs/PRD.md Section 6.2 and
 * docs/IMPLEMENTATION_HANDOFF.md Section 6.
 *
 * NOTE: session-refresh middleware (for server components/route handlers that
 * need the current user) is not wired up yet — add it alongside the first
 * auth-dependent server route, per @supabase/ssr's documented pattern.
 */
export function createClient() {
  // Supabase now issues "publishable" keys (sb_publishable_...) in place of
  // the legacy anon JWT; a local Supabase instance (`supabase start`) still
  // only emits the legacy name, so both are supported rather than assuming
  // whichever this environment happens to have.
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  // @supabase/ssr keeps the session in document.cookie, which doesn't
  // persist inside the app's web view (served from capacitor://localhost):
  // the anonymous sign-in succeeded but the next RPC went out with no
  // session, as the anon role — "permission denied for function
  // create_room". The static app build has no server to read cookies
  // anyway, so it keeps the session in localStorage instead.
  if (isNativeApp()) {
    nativeClient ??= createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key);
    return nativeClient;
  }
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key);
}
