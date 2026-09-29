begin;
select plan(3);

select is((private.ludo_default_rules()->>'teamUp')::boolean, false, 'Team Up is off by default');

select is(private.ludo_team_up_won(jsonb_build_array(
  jsonb_build_object('color','red','state','finished'), jsonb_build_object('color','red','state','finished'),
  jsonb_build_object('color','red','state','finished'), jsonb_build_object('color','red','state','finished'),
  jsonb_build_object('color','yellow','state','finished'), jsonb_build_object('color','yellow','state','finished'),
  jsonb_build_object('color','yellow','state','finished'), jsonb_build_object('color','yellow','state','finished')
), 'red'::text), true, 'a side wins only after all eight partner pawns finish');

select is(private.ludo_team_up_won(jsonb_build_array(
  jsonb_build_object('color','red','state','finished'), jsonb_build_object('color','yellow','state','track')
), 'red'::text), false, 'an unfinished partner pawn prevents the team win');

select * from finish();
rollback;
