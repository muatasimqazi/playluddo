begin;
select plan(26);

select results_eq(
  $$select (private.snakes_move(jsonb_build_array(jsonb_build_object('id','piece','color','red','state','track','pathIndex',a-1)), 'red', 1)->>'toTileId')
    from (values (4),(9),(18),(28),(50),(71),(14),(59),(87),(93),(95),(98)) v(a)$$,
  $$values ('snakes:16'),('snakes:30'),('snakes:44'),('snakes:54'),('snakes:73'),('snakes:91'),
    ('snakes:6'),('snakes:40'),('snakes:45'),('snakes:72'),('snakes:75'),('snakes:38')$$,
  'all six ladders and six snakes match the artwork');
select is(private.snakes_move('[{"id":"piece","color":"red","state":"nest","pathIndex":null}]', 'red', 0), null::jsonb, 'invalid die is rejected');
select is(private.snakes_move('[{"id":"piece","color":"red","state":"track","pathIndex":99}]', 'red', 2), null::jsonb, 'exact 100 is required');
select is(private.snakes_move('[{"id":"piece","color":"red","state":"nest","pathIndex":null}]', 'red', 3), null::jsonb, 'a nest piece needs a six to enter, not just any roll');
select is(private.snakes_move('[{"id":"piece","color":"red","state":"nest","pathIndex":null}]', 'red', 6)->>'toTileId', 'snakes:6', 'a six enters the nest piece onto square 6');

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111191', 'snake-host@test.com'),
  ('11111111-1111-1111-1111-111111111192', 'snake-guest@test.com');
insert into public.rooms (id, code, status, game_type) values
  ('aaaaaaaa-0000-0000-0000-000000000099', 'SNAKEQ', 'in_game', 'snakes_and_ladders');
insert into public.players (id, room_id, seat_index, user_id, display_name, color) values
  ('bbbbbbbb-0000-0000-0000-000000000090', 'aaaaaaaa-0000-0000-0000-000000000099', 0, '11111111-1111-1111-1111-111111111191', 'Host', 'red'),
  ('bbbbbbbb-0000-0000-0000-000000000091', 'aaaaaaaa-0000-0000-0000-000000000099', 1, '11111111-1111-1111-1111-111111111192', 'Guest', 'green');
update public.rooms set host_player_id = 'bbbbbbbb-0000-0000-0000-000000000090', turn_player_id = 'bbbbbbbb-0000-0000-0000-000000000090'
  where id = 'aaaaaaaa-0000-0000-0000-000000000099';
insert into public.pawns (room_id, player_id, pawn_index, state, path_index)
  select room_id, id, 0, 'track', 99 from public.players where room_id = 'aaaaaaaa-0000-0000-0000-000000000099';

select private.snakes_apply_roll('aaaaaaaa-0000-0000-0000-000000000099', 'bbbbbbbb-0000-0000-0000-000000000090', 2);
select is((select path_index from public.pawns where player_id = 'bbbbbbbb-0000-0000-0000-000000000090'), 99, 'overshoot leaves piece on its square');
select is((select turn_player_id from public.rooms where code = 'SNAKEQ'), 'bbbbbbbb-0000-0000-0000-000000000091'::uuid, 'overshoot advances the turn');
update public.pawns set path_index = 3 where player_id = 'bbbbbbbb-0000-0000-0000-000000000091';
select private.snakes_apply_roll('aaaaaaaa-0000-0000-0000-000000000099', 'bbbbbbbb-0000-0000-0000-000000000091', 6);
select is((select path_index from public.pawns where player_id = 'bbbbbbbb-0000-0000-0000-000000000091'), 30, 'roll lands on 9 then climbs to 30');
select is((select turn_player_id from public.rooms where code = 'SNAKEQ'), 'bbbbbbbb-0000-0000-0000-000000000091'::uuid, 'six grants another roll');
select private.snakes_apply_roll('aaaaaaaa-0000-0000-0000-000000000099', 'bbbbbbbb-0000-0000-0000-000000000091', 1);
update public.pawns set path_index = 13 where player_id = 'bbbbbbbb-0000-0000-0000-000000000090';
select private.snakes_apply_roll('aaaaaaaa-0000-0000-0000-000000000099', 'bbbbbbbb-0000-0000-0000-000000000090', 1);
select is((select path_index from public.pawns where player_id = 'bbbbbbbb-0000-0000-0000-000000000090'), 6, 'snake slides from 14 to 6');

-- 2-player match: the winning roll must end the match immediately — there's
-- no second place to wait for.
update public.pawns set path_index = 99 where room_id = 'aaaaaaaa-0000-0000-0000-000000000099';
select private.snakes_apply_roll('aaaaaaaa-0000-0000-0000-000000000099', 'bbbbbbbb-0000-0000-0000-000000000091', 1);
select is((select status from public.rooms where code = 'SNAKEQ'), 'summary', 'a 2-player match ends the instant the first player reaches 100');
select is((select winner_ids from public.rooms where code = 'SNAKEQ'), array['bbbbbbbb-0000-0000-0000-000000000091'::uuid], 'the winner is recorded with no second place');
select is((select match_end_reason from public.rooms where code = 'SNAKEQ'), 'completed', 'match end reason is set');
select is((select turn_player_id from public.rooms where code = 'SNAKEQ'), null::uuid, 'no one is left with a turn');
select is((select path_index from public.pawns where player_id = 'bbbbbbbb-0000-0000-0000-000000000090'), 99, 'the other player''s piece never got to move');
select is((select max(sequence) from public.match_events where room_id = 'aaaaaaaa-0000-0000-0000-000000000099'),
  (select count(*) from public.match_events where room_id = 'aaaaaaaa-0000-0000-0000-000000000099'), 'durable roll and move events have contiguous sequences');

-- 3-player match: unchanged behavior — the first (and second) finisher must
-- NOT end the match, since there's a real placement order to determine.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111193', 'snake-p1@test.com'),
  ('11111111-1111-1111-1111-111111111194', 'snake-p2@test.com'),
  ('11111111-1111-1111-1111-111111111195', 'snake-p3@test.com');
insert into public.rooms (id, code, status, game_type) values
  ('aaaaaaaa-0000-0000-0000-000000000098', 'SNAKE3', 'in_game', 'snakes_and_ladders');
insert into public.players (id, room_id, seat_index, user_id, display_name, color) values
  ('bbbbbbbb-0000-0000-0000-000000000092', 'aaaaaaaa-0000-0000-0000-000000000098', 0, '11111111-1111-1111-1111-111111111193', 'P1', 'red'),
  ('bbbbbbbb-0000-0000-0000-000000000093', 'aaaaaaaa-0000-0000-0000-000000000098', 1, '11111111-1111-1111-1111-111111111194', 'P2', 'green'),
  ('bbbbbbbb-0000-0000-0000-000000000094', 'aaaaaaaa-0000-0000-0000-000000000098', 2, '11111111-1111-1111-1111-111111111195', 'P3', 'yellow');
update public.rooms set host_player_id = 'bbbbbbbb-0000-0000-0000-000000000092', turn_player_id = 'bbbbbbbb-0000-0000-0000-000000000092'
  where id = 'aaaaaaaa-0000-0000-0000-000000000098';
insert into public.pawns (room_id, player_id, pawn_index, state, path_index)
  select room_id, id, 0, 'track', 99 from public.players where room_id = 'aaaaaaaa-0000-0000-0000-000000000098';

select private.snakes_apply_roll('aaaaaaaa-0000-0000-0000-000000000098', 'bbbbbbbb-0000-0000-0000-000000000092', 1);
select is((select status from public.rooms where code = 'SNAKE3'), 'in_game', 'a 3-player match does not end when the first player reaches 100');
select is((select winner_ids from public.rooms where code = 'SNAKE3'), array['bbbbbbbb-0000-0000-0000-000000000092'::uuid], 'first placement is recorded');
select private.snakes_apply_roll('aaaaaaaa-0000-0000-0000-000000000098', 'bbbbbbbb-0000-0000-0000-000000000093', 1);
select is((select status from public.rooms where code = 'SNAKE3'), 'in_game', 'a 3-player match does not end when the second player reaches 100 either');
select is((select winner_ids from public.rooms where code = 'SNAKE3'),
  array['bbbbbbbb-0000-0000-0000-000000000092'::uuid, 'bbbbbbbb-0000-0000-0000-000000000093'::uuid], 'second placement preserves finishing order');
select private.snakes_apply_roll('aaaaaaaa-0000-0000-0000-000000000098', 'bbbbbbbb-0000-0000-0000-000000000094', 1);
select is((select status from public.rooms where code = 'SNAKE3'), 'summary', 'the match ends once the last player finishes');
select is((select winner_ids from public.rooms where code = 'SNAKE3'),
  array['bbbbbbbb-0000-0000-0000-000000000092'::uuid, 'bbbbbbbb-0000-0000-0000-000000000093'::uuid, 'bbbbbbbb-0000-0000-0000-000000000094'::uuid],
  'all three placements are preserved in finishing order');

update public.players set rematch_ready = true where room_id = 'aaaaaaaa-0000-0000-0000-000000000099';
select private.ludo_maybe_start_rematch('aaaaaaaa-0000-0000-0000-000000000099');
select is((select game_type from public.rooms where code = 'SNAKEQ'), 'snakes_and_ladders', 'rematch retains board choice');
select is((select count(*) from public.pawns where room_id = 'aaaaaaaa-0000-0000-0000-000000000099'), 0::bigint, 'rematch clears old pieces');
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111191';
select public.start_match('aaaaaaaa-0000-0000-0000-000000000099');
select is((select count(*) from public.pawns where room_id = 'aaaaaaaa-0000-0000-0000-000000000099'), 4::bigint, 'starting the rematch creates one piece per seat, including bots');
reset role;
select is(private.snakes_move('[{"id":"piece","color":"red","state":"finished","pathIndex":100}]', 'red', 1), null::jsonb, 'finished players cannot move again');
select * from finish();
rollback;
