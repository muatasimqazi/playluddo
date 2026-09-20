-- Lets a team member start (or discover) a table already associated with
-- their team, so getting the whole team into a room doesn't require
-- manually sharing a join code with each person — get_my_teams now also
-- reports each team's currently-joinable room, if any, so the home page
-- can surface "your team has an open table" with no separate query.

alter table public.rooms add column team_id uuid references public.teams(id) on delete set null;
create index rooms_team_id_idx on public.rooms(team_id) where team_id is not null;

-- Redefines create_room (originally text-only, in
-- 20260913235804_m4_backfill_lobby_broadcasts.sql) to accept an optional
-- team to associate the new room with. Adding a parameter changes the
-- function's signature, so the old single-arg overload must be dropped
-- first or PostgREST ends up with two ambiguous candidates.
drop function if exists public.create_room(text);

create or replace function public.create_room(p_display_name text, p_team_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_code text;
  v_player_id uuid;
  v_team_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  if p_team_id is not null then
    select t.id into v_team_id
    from public.teams t
    join public.team_members tm on tm.team_id = t.id
    where t.id = p_team_id and tm.user_id = (select auth.uid());
    if v_team_id is null then
      raise exception 'NOT_TEAM_MEMBER';
    end if;
  end if;

  v_code := private.ludo_generate_room_code();

  insert into public.rooms (code, status, team_id)
  values (v_code, 'lobby', v_team_id)
  returning id into v_room_id;

  insert into public.players (room_id, seat_index, user_id, display_name, color, status, is_bot)
  values (v_room_id, 0, (select auth.uid()), p_display_name, private.ludo_color_for_seat(0), 'connected', false)
  returning id into v_player_id;

  update public.rooms set host_player_id = v_player_id where id = v_room_id;

  perform private.ludo_broadcast_state(v_room_id);

  return jsonb_build_object('roomId', v_room_id, 'code', v_code, 'playerId', v_player_id);
end;
$$;

revoke execute on function public.create_room(text, uuid) from public;
grant execute on function public.create_room(text, uuid) to authenticated;
revoke execute on function public.create_room(text, uuid) from anon;

-- Extends the M4 teams snapshot (20260919030000_private_teams.sql) with
-- each team's currently-joinable room, if any. security definer already
-- bypasses RLS on rooms/players here, same as the rest of this function.
create or replace function private.luddo_my_teams_json(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id,
    'name', t.name,
    'inviteCode', t.invite_code,
    'ownerUserId', t.owner_user_id,
    'createdAt', t.created_at,
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', tm.user_id,
        'role', tm.role,
        'displayName', tm.display_name,
        'avatarId', tm.avatar_id,
        'joinedAt', tm.joined_at
      ) order by case when tm.role = 'owner' then 0 else 1 end, tm.joined_at)
      from public.team_members tm where tm.team_id = t.id
    ), '[]'::jsonb),
    'activeRoom', (
      select jsonb_build_object(
        'roomId', r.id,
        'code', r.code,
        'status', r.status,
        'seatsTaken', (select count(*) from public.players p where p.room_id = r.id)
      )
      from public.rooms r
      where r.team_id = t.id and r.status in ('lobby', 'in_game')
      order by r.created_at desc
      limit 1
    )
  ) order by t.created_at), '[]'::jsonb)
  from public.teams t
  join public.team_members mine on mine.team_id = t.id
  where mine.user_id = p_user_id;
$$;
