begin;
select plan(10);
insert into auth.users(id,email) values
('11111111-1111-1111-1111-111111111111','table-host@test.com'),
('22222222-2222-2222-2222-222222222222','table-outsider@test.com');
create temporary table table_test_state(key text primary key,value jsonb);
grant select,insert on table_test_state to authenticated;
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-1111-1111-111111111111';
insert into table_test_state values('room',public.create_room('Host'));

select throws_ok(
  $$select public.send_table_message((select (value->>'roomId')::uuid from table_test_state where key='room'),'','chat')$$,
  'P0001','INVALID_MESSAGE','empty messages are rejected');
select throws_ok(
  $$select public.send_table_message((select (value->>'roomId')::uuid from table_test_state where key='room'),'made up','reaction')$$,
  'P0001','INVALID_MESSAGE','only supported reactions are accepted');
insert into table_test_state values('message',public.send_table_message((select (value->>'roomId')::uuid from table_test_state where key='room'),' Hello table ','chat'));
select is((select value->>'playerId' from table_test_state where key='message'),(select value->>'playerId' from table_test_state where key='room'),'the server assigns the authenticated sender');
select is((select value->>'text' from table_test_state where key='message'),'Hello table','messages are trimmed');
select is((select count(*) from public.table_messages),1::bigint,'a seated player can read their table messages');
select is((select event_sequence from public.rooms where id=(select (value->>'roomId')::uuid from table_test_state where key='room')),0::bigint,'conversation never changes the game event sequence');
select throws_ok(
  $$select public.send_table_message((select (value->>'roomId')::uuid from table_test_state where key='room'),'Again','chat')$$,
  'P0001','Please wait a moment before sending another message.','rapid messages are rate limited');
set local request.jwt.claim.sub='22222222-2222-2222-2222-222222222222';
select is_empty($$select * from public.table_messages$$,'outsiders cannot read private conversations');
select throws_ok(
  $$select public.send_table_message((select (value->>'roomId')::uuid from table_test_state where key='room'),'Uninvited','chat')$$,
  'P0001','SEAT_NOT_CONTROLLED','outsiders cannot send to a table');
set local role anon;
select throws_ok($$select public.send_table_message('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Hello','chat')$$,'42501',null,'anonymous role cannot call the message RPC');
select * from finish();
rollback;
