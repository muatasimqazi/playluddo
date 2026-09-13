-- RLS policies + the private helper functions they (and the M2 RPCs in the
-- next migration) depend on. Per docs/PRD.md Section 6.2 / Section 10 Open
-- Question #8: these are AI-authored and MUST be reviewed and signed off by
-- the product owner before this migration is ever applied to staging or
-- production. It is safe and expected to run locally for development.
--
-- Design recap (docs/IMPLEMENTATION_HANDOFF.md Section 5):
--   - No table in this app grants INSERT/UPDATE/DELETE to authenticated/anon,
--     ever. All writes happen inside SECURITY DEFINER RPCs (next migration).
--   - SELECT is scoped to "a seat in this room" — no spectator mode in MVP.
--   - Realtime Broadcast is authorized the same way, via a policy on
--     realtime.messages, and only works because clients subscribe with
--     { config: { private: true } } — an unauthenticated/public-mode
--     subscribe skips RLS entirely (confirmed against Realtime's channel-join
--     behavior), so that client-side flag is not optional.

-- ---------------------------------------------------------------------------
-- Private helpers used inside policies (and by the RPCs in the next
-- migration). SECURITY DEFINER + `set search_path = ''` is the same pattern
-- used for the rules engine, and is specifically the documented Supabase
-- pattern for breaking self-referential RLS recursion: a policy on `players`
-- that queried `players` directly to check membership would recurse.
--
-- `private` has no grants to PUBLIC (previous migration), and SECURITY
-- DEFINER only changes what a function's OWN body can touch — it doesn't
-- let a role call the function in the first place. A policy's USING clause
-- evaluates as the querying role (authenticated), not as the function
-- owner, so `ludo_is_seated_in_room` and `ludo_room_id_from_topic` — the two
-- helpers actually invoked from policies below, not just from other
-- SECURITY DEFINER functions — need an explicit schema USAGE + function
-- EXECUTE grant. (Confirmed empirically: without this, every policy that
-- calls them fails with "permission denied for function", before RLS logic
-- even runs.) The rest of `private` stays unreachable by authenticated/anon.
-- ---------------------------------------------------------------------------

grant usage on schema private to authenticated;

create or replace function private.ludo_is_seated_in_room(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.players
    where players.room_id = p_room_id
      and players.user_id = (select auth.uid())
  );
$$;

revoke execute on function private.ludo_is_seated_in_room(uuid) from public;
grant execute on function private.ludo_is_seated_in_room(uuid) to authenticated;

-- The caller's own seat id in a room, or null if they aren't seated there.
-- Used by the RPCs (next migration) to authorize "is this your turn / are
-- you the host" — not just "are you seated at all".
create or replace function private.ludo_caller_player_id(p_room_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.players
  where room_id = p_room_id and user_id = (select auth.uid())
  limit 1;
$$;

revoke execute on function private.ludo_caller_player_id(uuid) from public;

-- Parses a Realtime topic of the form "room:<uuid>" back to the room id, or
-- null for anything else — used only by the realtime.messages policy below.
-- plpgsql (not sql) specifically so the exception handler can turn a
-- malformed topic into "not seated" (false) rather than a policy-evaluation
-- error, which is the safe failure direction here.
create or replace function private.ludo_room_id_from_topic(p_topic text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_topic is null or p_topic !~ '^room:' then
    return null;
  end if;
  return substring(p_topic from 6)::uuid;
exception when others then
  return null;
end;
$$;

revoke execute on function private.ludo_room_id_from_topic(text) from public;
grant execute on function private.ludo_room_id_from_topic(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Table RLS policies — SELECT only. INSERT/UPDATE/DELETE are deliberately
-- absent: the schema migration already enabled RLS with no policies, which
-- denies all direct client writes by default. This migration does not
-- change that.
--
-- RLS restricts which ROWS a policy exposes; it is not a substitute for the
-- table-level GRANT that lets a role touch the table at all (confirmed
-- empirically: without this, `authenticated` gets "permission denied for
-- table rooms" before RLS is even evaluated, per the local Supabase image's
-- "don't auto-expose new tables" default noted in supabase/config.toml).
-- Only SELECT is granted — never INSERT/UPDATE/DELETE, matching the "no
-- direct client writes" design above.
-- ---------------------------------------------------------------------------

grant select on public.rooms, public.players, public.pawns, public.match_events to authenticated;

create policy "seated players can read their room" on public.rooms
for select to authenticated
using ( (select private.ludo_is_seated_in_room(id)) );

create policy "seated players can read seats in their room" on public.players
for select to authenticated
using ( (select private.ludo_is_seated_in_room(room_id)) );

create policy "seated players can read pawns in their room" on public.pawns
for select to authenticated
using ( (select private.ludo_is_seated_in_room(room_id)) );

create policy "seated players can read events in their room" on public.match_events
for select to authenticated
using ( (select private.ludo_is_seated_in_room(room_id)) );

-- ---------------------------------------------------------------------------
-- Realtime Broadcast authorization (docs/PRD.md Section 6.3, 7)
-- ---------------------------------------------------------------------------

create policy "seated players can receive their room's broadcasts" on realtime.messages
for select to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and private.ludo_room_id_from_topic((select realtime.topic())) is not null
  and (select private.ludo_is_seated_in_room(private.ludo_room_id_from_topic((select realtime.topic()))))
);

-- No INSERT policy on realtime.messages: clients never call realtime.send()
-- themselves. Only the SECURITY DEFINER RPCs do, and those run as the
-- function owner (postgres, which has bypassrls), so they need no policy.
