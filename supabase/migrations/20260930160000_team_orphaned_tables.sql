-- Orphaned team tables (follow-up to 20260919050000_team_active_room.sql).
--
-- A team's "open table" was simply its newest room still in the lobby or in
-- a game. Nothing ever retires a lobby, and the turn sweep skips a game the
-- host paused, so a table everyone walked away from stayed "open" for good:
-- the home page kept offering "Join now" to a game nobody could get into
-- (already started, or full of people who'd left), with no way to start
-- another. Two fixes:
--   * the team snapshot only reports a table someone has used in the last
--     30 minutes (any roll, move, or opening the table counts), and says
--     whether the caller holds a seat there and how many seats it has, so
--     the home page can offer "Join now" only when it would work;
--   * a game paused with nobody at it for an hour is closed out as
--     abandoned, as an unpaused one already is after three minutes.

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
        'seatsTaken', (select count(*) from public.players p where p.room_id = r.id),
        'maxPlayers', r.max_players,
        'isSeated', exists (
          select 1 from public.players p where p.room_id = r.id and p.user_id = p_user_id
        )
      )
      from public.rooms r
      where r.team_id = t.id
        and r.status in ('lobby', 'in_game')
        -- Someone has been at it lately; a table everyone left isn't "open".
        and (
          r.created_at > now() - interval '30 minutes'
          or exists (
            select 1 from public.players p
            where p.room_id = r.id and not p.is_bot and p.last_seen_at > now() - interval '30 minutes'
          )
        )
      order by r.created_at desc
      limit 1
    )
  ) order by t.created_at), '[]'::jsonb)
  from public.teams t
  join public.team_members mine on mine.team_id = t.id
  where mine.user_id = p_user_id;
$$;

-- Redefines 20260928220100_rush_mode_clock.sql's version: adds the last loop,
-- closing out a game the host paused and everyone then left.
create or replace function public.sweep_expired_turns()
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare v_room_id uuid;
begin
  for v_room_id in select id from public.rooms where status = 'in_game' and paused_at is null and turn_deadline_at is not null and turn_deadline_at <= now() for update skip locked loop
    if private.party_pause_for_absence(v_room_id) then
      perform private.ludo_broadcast_state(v_room_id);
      continue;
    end if;
    perform private.ludo_resolve_turn_timeout(v_room_id);
    perform private.ludo_check_abandonment(v_room_id);
    perform private.ludo_broadcast_state(v_room_id);
  end loop;
  -- A timed match whose clock ran out while nobody was taking a turn.
  for v_room_id in select id from public.rooms
    where status = 'in_game' and paused_at is null and match_ends_at is not null and match_ends_at <= now()
    for update skip locked loop
    perform private.ludo_end_match_on_time(v_room_id);
    perform private.ludo_broadcast_state(v_room_id);
  end loop;
  for v_room_id in select id from public.rooms where status = 'in_game' and paused_for_player_id is not null and paused_at <= now() - interval '2 minutes' for update skip locked loop
    perform private.party_absence_expired(v_room_id);
    perform private.ludo_check_abandonment(v_room_id);
    perform private.ludo_broadcast_state(v_room_id);
  end loop;
  -- A game the host paused that nobody has come back to for an hour: no
  -- turn clock runs while paused, so nothing else would ever end it.
  for v_room_id in select r.id from public.rooms r
    where r.status = 'in_game' and r.paused_at is not null and r.paused_for_player_id is null
      and r.paused_at <= now() - interval '1 hour'
      and not exists (
        select 1 from public.players p
        where p.room_id = r.id and not p.is_bot and p.last_seen_at > now() - interval '1 hour'
      )
    for update skip locked loop
    -- Unpaused in the same update: the paused-room guard
    -- (20260919020100_guard_paused_matches.sql) refuses any other change.
    update public.rooms
    set status = 'abandoned', match_end_reason = 'abandoned', turn_phase = 'complete', paused_at = null
    where id = v_room_id;
    perform private.ludo_append_event(v_room_id, 'match_abandoned', null, '{}'::jsonb);
    perform private.ludo_broadcast_state(v_room_id);
  end loop;
end;
$function$;
revoke execute on function public.sweep_expired_turns() from public;
