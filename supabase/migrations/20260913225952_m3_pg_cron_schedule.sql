-- Schedules the turn-timeout sweep every 1 second (docs/PRD.md Section 6.3 —
-- chosen against the "95% within timer + 2s" success metric budget: a 1s
-- sweep leaves headroom inside that window; a 2s sweep would consume it
-- entirely in scheduling jitter alone). No Edge Function or external
-- scheduler involved — pg_cron calls the plpgsql function directly.

create extension if not exists pg_cron;

select cron.schedule(
  'sweep-expired-turns',
  '1 second',
  $$select public.sweep_expired_turns()$$
);
