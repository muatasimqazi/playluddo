-- pgTAP tests for supabase/migrations/20260928080000_more_reactions.sql:
-- the new emoji and quick phrases are accepted, the original six still are
-- (older app versions send them), and anything else is refused. Whether
-- the list matches lib/realtime/reactions.ts is checked in tests/parity.
-- Run with `supabase test db` (requires `supabase start`).

begin;
select plan(7);

insert into auth.users (id, email) values ('aaaaaaaa-0000-0000-0000-000000000001', 'reactor@test.com');
create temporary table reaction_state (key text primary key, value jsonb);
grant select, insert on reaction_state to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
insert into reaction_state values ('room', public.create_room('Reactor'));

-- now() is fixed inside this transaction, so the one-per-second rate limit
-- is cleared by backdating what was already sent (as the table owner).
create function pg_temp.react(p_text text) returns text language plpgsql as $$
begin
  reset role;
  update public.table_messages set created_at = now() - interval '2 seconds';
  set local role authenticated;
  return public.send_table_message(
    (select (value->>'roomId')::uuid from reaction_state where key = 'room'), p_text, 'reaction')->>'text';
end;
$$;

select is(pg_temp.react('🍀'), '🍀', 'a new emoji is accepted');
select is(pg_temp.react('Nice move!'), 'Nice move!', 'a quick phrase is accepted');
select is(pg_temp.react('Revenge!'), 'Revenge!', 'the situational phrase is accepted');
select is(pg_temp.react('👋'), '👋', 'the original emoji still work for older app versions');

select throws_ok(
  $$select pg_temp.react('Nice move')$$,
  'P0001', 'INVALID_MESSAGE',
  'a phrase that is nearly but not exactly on the list is refused'
);
select throws_ok(
  $$select pg_temp.react('anything at all')$$,
  'P0001', 'INVALID_MESSAGE',
  'free text cannot be sent as a reaction'
);

select throws_ok(
  $$select public.send_table_message((select (value->>'roomId')::uuid from reaction_state where key = 'room'), '🎉', 'reaction')$$,
  'P0001', 'Please wait a moment before sending another message.',
  'reactions share chat''s one-per-second limit'
);

select * from finish();
rollback;
