begin;
select plan(4);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111181', 'color-host@test.com'),
  ('11111111-1111-1111-1111-111111111182', 'color-guest@test.com');
insert into public.rooms (id, code, status) values
  ('aaaaaaaa-0000-0000-0000-000000000088', 'COLORQ', 'lobby');
insert into public.players (id, room_id, seat_index, user_id, display_name, color) values
  ('bbbbbbbb-0000-0000-0000-000000000080', 'aaaaaaaa-0000-0000-0000-000000000088', 0, '11111111-1111-1111-1111-111111111181', 'Host', 'red'),
  ('bbbbbbbb-0000-0000-0000-000000000081', 'aaaaaaaa-0000-0000-0000-000000000088', 1, '11111111-1111-1111-1111-111111111182', 'Guest', 'green');
update public.rooms set host_player_id = 'bbbbbbbb-0000-0000-0000-000000000080'
  where id = 'aaaaaaaa-0000-0000-0000-000000000088';

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111181';
select is(
  (public.set_player_color('aaaaaaaa-0000-0000-0000-000000000088', 'blue')->>'hostPlayerId'),
  'bbbbbbbb-0000-0000-0000-000000000080',
  'a player can claim an open base without losing host identity'
);
select is((select color from public.players where id = 'bbbbbbbb-0000-0000-0000-000000000080'), 'blue', 'color changes');
select is((select seat_index from public.players where id = 'bbbbbbbb-0000-0000-0000-000000000080'), 3, 'seat follows the selected base');
select throws_ok(
  $$select public.set_player_color('aaaaaaaa-0000-0000-0000-000000000088', 'green')$$,
  'P0001', 'COLOR_TAKEN', 'occupied bases cannot be claimed'
);

select * from finish();
rollback;
