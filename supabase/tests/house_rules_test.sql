-- pgTAP tests for supabase/migrations/20260928240000_house_rules.sql and
-- 20260928240100_turn_timer_source.sql: the presets, the turn-timer rule,
-- and the allow-list the server enforces (docs/COMPETITIVE_ROADMAP.md F2.4,
-- decision 14).
-- Run with `supabase test db` (requires `supabase start`).

begin;
select plan(15);

create temporary table hr_state (key text primary key, value jsonb);
grant select, insert on hr_state to authenticated;
insert into auth.users (id, is_anonymous) values ('d4444444-0000-0000-0000-000000000001', true);
create function pg_temp.room() returns uuid language sql as $$
  select (value->>'roomId')::uuid from hr_state where key = 'room';
$$;
create function pg_temp.set_rules(r text) returns text language sql as $$
  select format('select public.set_room_rules(%L, %L)', pg_temp.room(), r);
$$;

-- -------------------------------------------------------------------------
-- The presets
-- -------------------------------------------------------------------------

select is(
  (select count(*)::int from jsonb_object_keys(private.ludo_rule_presets())), 4,
  'there are four presets to start from'
);
select is(
  private.ludo_rule_presets()->'classic', private.ludo_resolve_rules(null) - 'matchMinutes'
    - 'snakesAnyRollToStart' - 'snakesBounceBack',
  'Classic is simply the defaults'
);
select is((private.ludo_rule_presets()->'quick'->>'pawnsToWin')::int, 2, 'Quick is a shorter game');
select is((private.ludo_rule_presets()->'master'->>'captureToEnterHome')::boolean, true, 'Master holds pieces back until a capture');
select is((private.ludo_rule_presets()->'family'->>'turnSeconds')::int, 30, 'Family gives everyone longer to think');

-- Every preset is allowed, by construction.
select ok(
  (select bool_and(private.ludo_rules_allowed(value)) from jsonb_each(private.ludo_rule_presets())),
  'every preset is a combination a host may pick'
);

-- -------------------------------------------------------------------------
-- The allow-list
-- -------------------------------------------------------------------------

select ok(private.ludo_rules_allowed('{"blockades": true}'::jsonb), 'Classic with blockades on is allowed');
select ok(private.ludo_rules_allowed('{"bonusRollOnFinish": false}'::jsonb), 'Classic without the extra roll is allowed');
select ok(private.ludo_rules_allowed('{"turnSeconds": 10}'::jsonb), 'Classic with a shorter timer is allowed');
select ok(
  not private.ludo_rules_allowed('{"blockades": true, "captureToEnterHome": true}'::jsonb),
  'but two changes at once are not, until their fixtures exist'
);
select ok(
  not private.ludo_rules_allowed('{"startOnBoard": 3}'::jsonb),
  'and nor is a number nobody has agreed on'
);

-- The match clock and the Snakes rules sit outside the list.
select ok(
  private.ludo_rules_allowed('{"blockades": true, "matchMinutes": 10, "snakesBounceBack": true}'::jsonb),
  'the match clock and the Snakes rules combine with anything on the list'
);

-- -------------------------------------------------------------------------
-- What a host may set
-- -------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'd4444444-0000-0000-0000-000000000001';
insert into hr_state values ('room', public.create_room('Hosty', null, 2));

select lives_ok(pg_temp.set_rules('{"blockades": true}'), 'a host picks Classic with blockades');
select throws_ok(
  pg_temp.set_rules('{"blockades": true, "captureToEnterHome": true}'),
  'P0001', 'RULES_NOT_ALLOWED',
  'and is refused a combination that is not on the list'
);
select throws_ok(
  pg_temp.set_rules('{"turnSeconds": 7}'),
  'P0001', 'INVALID_RULES',
  'a turn timer has to be one of the three lengths'
);

select * from finish();
rollback;
