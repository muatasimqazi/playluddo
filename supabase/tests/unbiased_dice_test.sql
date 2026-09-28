-- pgTAP tests for supabase/migrations/20260928020000_unbiased_dice.sql.
-- The byte-to-face mapping is checked for all 256 inputs, so the fairness
-- guarantee doesn't rest on a statistical sample.
-- Run with `supabase test db` (requires `supabase start`).

begin;
select plan(9);

select is(
  (select count(*)::int from generate_series(0, 255) b where private.die_face_from_byte(b) is null),
  4,
  'exactly four bytes are rejected'
);

select is(
  (select array_agg(b order by b) from generate_series(0, 255) b where private.die_face_from_byte(b) is null),
  array[252, 253, 254, 255],
  'the rejected bytes are 252-255'
);

select is(
  (
    select array_agg(n order by face)
    from (
      select private.die_face_from_byte(b) as face, count(*)::int as n
      from generate_series(0, 251) b
      group by 1
    ) faces
  ),
  array[42, 42, 42, 42, 42, 42],
  'the 252 accepted bytes map to exactly 42 per face'
);

select is(
  (select array_agg(distinct private.die_face_from_byte(b) order by private.die_face_from_byte(b)) from generate_series(0, 251) b),
  array[1, 2, 3, 4, 5, 6],
  'accepted bytes only produce faces 1-6'
);

-- A smoke test of the random draw itself, not the fairness gate: 6,000
-- rolls stay in range and show every face (missing one has probability
-- around 6 * (5/6)^6000, effectively zero).
select is(
  (select array_agg(distinct f order by f) from (select private.roll_die() as f from generate_series(1, 6000)) rolls),
  array[1, 2, 3, 4, 5, 6],
  'roll_die returns every face and nothing else'
);

-- Since 20260928070000_verifiable_dice.sql, both games roll through
-- roll_match_die, which maps seeded bytes with the same die_face_from_byte
-- and falls back to roll_die for a match without a seed.
select ok(
  (select prosrc like '%private.roll_match_die(p_room_id)%' and prosrc not like '%gen_random_bytes%'
   from pg_proc where oid = 'private.ludo_perform_ludo_roll(uuid,uuid)'::regprocedure)
  and (select prosrc like '%private.roll_match_die(p_room_id)%' and prosrc not like '%gen_random_bytes%'
       from pg_proc where oid = 'private.ludo_perform_roll(uuid,uuid)'::regprocedure),
  'Ludo and Snakes & Ladders rolls go through roll_match_die'
);

select ok(
  (select prosrc like '%private.dice_face(%' and prosrc like '%private.roll_die()%'
   from pg_proc where oid = 'private.roll_match_die(uuid)'::regprocedure)
  and (select prosrc like '%private.die_face_from_byte(%'
       from pg_proc where oid = 'private.dice_face(bytea,uuid,integer)'::regprocedure),
  'roll_match_die uses the unbiased byte mapping, and roll_die without a seed'
);

select ok(
  not has_function_privilege('authenticated', 'private.roll_die()', 'execute')
  and not has_function_privilege('anon', 'private.roll_die()', 'execute'),
  'clients cannot call roll_die'
);

select ok(
  not has_function_privilege('authenticated', 'private.die_face_from_byte(int)', 'execute')
  and not has_function_privilege('anon', 'private.die_face_from_byte(int)', 'execute'),
  'clients cannot call die_face_from_byte'
);

select * from finish();
rollback;
