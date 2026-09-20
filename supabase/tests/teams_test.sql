begin;
select plan(10);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111131', 'team-owner@test.com'),
  ('22222222-2222-2222-2222-222222222232', 'team-friend@test.com'),
  ('33333333-3333-3333-3333-333333333333', 'team-stranger@test.com');

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111131';
select lives_ok(
  $$select public.create_team('Friday Players', 'Owner', 'avatar-1')$$,
  'a signed-in player can create a private team'
);
select is(
  jsonb_array_length(public.get_my_teams()),
  1,
  'the owner can list their team'
);
select throws_ok(
  $$select * from public.teams$$,
  '42501', null,
  'team tables cannot be queried directly'
);

set local role postgres;
update public.teams set invite_code = 'TEAMCODE1'
where owner_user_id = '11111111-1111-1111-1111-111111111131';

set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222232';
select lives_ok(
  $$select public.join_team('teamcode1', 'Friend', 'avatar-2')$$,
  'a friend can join with the shared code'
);
select is(
  (public.get_my_teams()->0->>'name'),
  'Friday Players',
  'a member can see the joined team'
);
select is(
  jsonb_array_length(public.get_my_teams()->0->'members'),
  2,
  'team members can see one another'
);

set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select is(
  jsonb_array_length(public.get_my_teams()),
  0,
  'a non-member cannot discover the private team'
);
select throws_ok(
  $$select public.join_team('WRONGCODE', 'Stranger', null)$$,
  'P0001', 'TEAM_NOT_FOUND',
  'an invalid invitation cannot reveal or join a team'
);

set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222232';
select lives_ok(
  $q$select public.leave_team((public.get_my_teams()->0->>'id')::uuid)$q$,
  'a member can leave a team'
);
select is(
  jsonb_array_length(public.get_my_teams()),
  0,
  'the team disappears from the former member list'
);

select * from finish();
rollback;
