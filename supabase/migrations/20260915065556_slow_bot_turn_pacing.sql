-- Per direct instruction: turns were advancing far too quickly to actually
-- watch, especially bot-vs-bot. Root cause was private.ludo_next_turn_deadline
-- (20260913225951_m3_timers_bots_reconnect.sql) setting a bot-controlled
-- seat's deadline to `now()` — already-expired the instant it's set, so the
-- very next ~1s sweep tick (public.sweep_expired_turns, unrelated and
-- unchanged — that cadence is about sweep responsiveness, not gameplay
-- pacing) picks it up and acts immediately. A full bot turn is two such
-- sub-steps (roll, then move), so consecutive bot turns were only ever
-- ~1-2 seconds apart with no deliberate pause at all.
--
-- Gives bot-controlled seats a real "thinking" pause instead, long enough
-- to actually watch a roll/move land before the next one fires. The human
-- decision window (15s) is untouched.
create or replace function private.ludo_next_turn_deadline(p_player_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.ludo_is_bot_controlled(p_player_id) then now() + interval '2 seconds'
    else now() + interval '15 seconds'
  end;
$$;

revoke execute on function private.ludo_next_turn_deadline(uuid) from public;
