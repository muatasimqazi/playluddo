begin;
select plan(19);
insert into auth.users(id,email) values
('11111111-1111-1111-1111-111111111111','mod-host@test.com'),
('22222222-2222-2222-2222-222222222222','mod-guest@test.com'),
('33333333-3333-3333-3333-333333333333','mod-outsider@test.com');
create temporary table mod_state(key text primary key,value jsonb);
grant select,insert on mod_state to authenticated;
set local role authenticated;

-- Filter
set local request.jwt.claim.sub='11111111-1111-1111-1111-111111111111';
insert into mod_state values('room',public.create_room('Host'));
insert into mod_state values('msg',public.send_table_message((select (value->>'roomId')::uuid from mod_state where key='room'),'what the FUCK, you bitch','chat'));
select is((select value->>'text' from mod_state where key='msg'),'what the ****, you ****','profanity in chat is masked before it is stored or broadcast');
select is((select text from public.table_messages order by created_at desc limit 1),'what the ****, you ****','the stored message is masked too');
reset role;
select is(private.clean_text('Nice cockpit, Dickens. Class act, Scunthorpe!'),'Nice cockpit, Dickens. Class act, Scunthorpe!','ordinary words containing those letters are untouched');
select is(private.clean_text('motherfuckers'),'****','compound forms are caught');
set local role authenticated;

set local request.jwt.claim.sub='22222222-2222-2222-2222-222222222222';
insert into mod_state values('join',public.join_room_by_id((select (value->>'roomId')::uuid from mod_state where key='room'),'Shithead'));
select is((select display_name from public.players where id=(select (value->>'playerId')::uuid from mod_state where key='join')),'****','seat names are masked');

-- Blocks
set local request.jwt.claim.sub='11111111-1111-1111-1111-111111111111';
select is(public.blocked_player_ids((select (value->>'roomId')::uuid from mod_state where key='room')),'{}'::uuid[],'nobody is blocked at first');
select lives_ok(
  format('select public.set_player_blocked(%L,%L,true)',
    (select value->>'roomId' from mod_state where key='room'),
    (select value->>'playerId' from mod_state where key='join')),
  'a seated player can block another person at the table');
select lives_ok(
  format('select public.set_player_blocked(%L,%L,true)',
    (select value->>'roomId' from mod_state where key='room'),
    (select value->>'playerId' from mod_state where key='join')),
  'blocking twice is harmless');
select is(
  public.blocked_player_ids((select (value->>'roomId')::uuid from mod_state where key='room')),
  array[(select (value->>'playerId')::uuid from mod_state where key='join')],
  'the blocked seat is listed for the blocker');
set local request.jwt.claim.sub='22222222-2222-2222-2222-222222222222';
select is(public.blocked_player_ids((select (value->>'roomId')::uuid from mod_state where key='room')),'{}'::uuid[],'blocks are one-way and private to the blocker');
set local request.jwt.claim.sub='11111111-1111-1111-1111-111111111111';
select throws_ok(
  format('select public.set_player_blocked(%L,%L,true)',
    (select value->>'roomId' from mod_state where key='room'),
    (select value->>'playerId' from mod_state where key='room')),
  'P0001','PLAYER_NOT_FOUND','players cannot block themselves');
select lives_ok(
  format('select public.set_player_blocked(%L,%L,false)',
    (select value->>'roomId' from mod_state where key='room'),
    (select value->>'playerId' from mod_state where key='join')),
  'a block can be undone');
select is(public.blocked_player_ids((select (value->>'roomId')::uuid from mod_state where key='room')),'{}'::uuid[],'unblocking removes it');

-- Reports
select lives_ok(
  format('select public.report_player(%L,%L,%L,%L)',
    (select value->>'roomId' from mod_state where key='room'),
    (select value->>'playerId' from mod_state where key='join'),
    'harassment','  rude name  '),
  'a seated player can report another person at the table');
reset role;
select is((select count(*) from public.player_reports where reported_user_id='22222222-2222-2222-2222-222222222222' and reason='harassment' and details='rude name' and status='open'),1::bigint,'the report is stored for review with trimmed details');
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-1111-1111-111111111111';
select throws_ok(
  format('select public.report_player(%L,%L,%L)',
    (select value->>'roomId' from mod_state where key='room'),
    (select value->>'playerId' from mod_state where key='join'),
    'made-up'),
  'P0001','INVALID_REPORT','unknown reasons are rejected');
select throws_ok($$select * from public.player_reports$$,'42501',null,'players cannot read reports');
select throws_ok($$select * from public.player_blocks$$,'42501',null,'players cannot read the blocks table directly');

set local request.jwt.claim.sub='33333333-3333-3333-3333-333333333333';
select throws_ok(
  format('select public.report_player(%L,%L,%L)',
    (select value->>'roomId' from mod_state where key='room'),
    (select value->>'playerId' from mod_state where key='join'),
    'spam'),
  'P0001','SEAT_NOT_CONTROLLED','outsiders cannot report players at a table they are not at');

select * from finish();
rollback;
