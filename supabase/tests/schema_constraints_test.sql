-- pgTAP tests for schema-level constraint behavior that isn't specific to
-- any one RPC — currently just players.user_id's ON DELETE SET NULL
-- (supabase/migrations/20260914001348_fix_players_user_id_on_delete.sql).
-- Run with `supabase test db`.

begin;
select plan(4);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'deleteme@test.com');

insert into public.rooms (id, code, status) values
  ('aaaaaaaa-0000-0000-0000-0000000000f1', 'DELTEST', 'lobby');

insert into public.players (id, room_id, seat_index, user_id, display_name, color, status, is_bot) values
  ('bbbbbbbb-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-0000000000f1', 0,
   '11111111-1111-1111-1111-111111111111', 'DeleteMe', 'red', 'connected', false);

select lives_ok(
  $$delete from auth.users where id = '11111111-1111-1111-1111-111111111111'$$,
  'deleting a user who still holds a seat succeeds (does not raise a foreign-key violation)'
);

select isnt_empty(
  $$select 1 from public.players where id = 'bbbbbbbb-0000-0000-0000-0000000000f1'$$,
  'the seat itself is untouched — it is orphaned, not deleted'
);

select is(
  (select user_id from public.players where id = 'bbbbbbbb-0000-0000-0000-0000000000f1'),
  null,
  'user_id is set null on the orphaned seat rather than blocking the delete'
);

select results_eq(
  $$select display_name, color, is_bot from public.players
    where id = 'bbbbbbbb-0000-0000-0000-0000000000f1'$$,
  $$values ('DeleteMe'::text, 'red'::text, false)$$,
  'every other field on the orphaned seat is unchanged'
);

select * from finish();
rollback;
