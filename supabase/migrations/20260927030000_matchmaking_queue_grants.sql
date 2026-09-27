-- Align matchmaking_queue with every other table: strip the default table
-- grants Supabase gives anon/authenticated on new public tables. RLS (with
-- no policies) already blocks row access, but TRUNCATE, REFERENCES and
-- TRIGGER aren't governed by RLS. Only the security definer matchmaking
-- RPCs touch this table.
revoke all on public.matchmaking_queue from anon, authenticated;
