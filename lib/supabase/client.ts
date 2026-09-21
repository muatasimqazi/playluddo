import { createBrowserClient } from "@supabase/ssr";

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
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key);
}
