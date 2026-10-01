-- Opening a player's profile from anywhere they show up (docs/COMPETITIVE_ROADMAP.md
-- F3.1), not just their seat. The leaderboard, team season, friends list,
-- recently-played list and tournament brackets already address players by
-- account id (leaderboard_json, get_friends, get_recent_players and
-- get_tournament all return userId), so get_account_profile takes that id
-- where get_player_profile (20260929030000_player_profile.sql) takes a seat.
--
-- Both now share private.profile_view, so the visibility rules can't drift:
-- guests have no public profile, profile_hidden hides stats from everyone but
-- the player themselves, and name/avatar stay visible either way.

create or replace function private.profile_view(p_caller uuid, p_target uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_self boolean;
  v_hidden boolean;
  v_identity jsonb;
begin
  if p_target is null then
    return jsonb_build_object('visibility', 'none');
  end if;

  -- Guests (anonymous accounts) have no public profile.
  if exists (select 1 from auth.users where id = p_target and is_anonymous = true) then
    return jsonb_build_object('visibility', 'guest');
  end if;

  v_self := p_target = p_caller;
  v_identity := private.profile_identity(p_target);
  if v_identity is null then
    return jsonb_build_object('visibility', 'none');
  end if;

  v_hidden := coalesce(
    (select raw_user_meta_data ->> 'profile_hidden' from auth.users where id = p_target),
    'false'
  ) = 'true';

  if v_hidden and not v_self then
    return jsonb_build_object('visibility', 'hidden', 'isSelf', false) || v_identity;
  end if;

  return jsonb_build_object('visibility', 'visible', 'isSelf', v_self, 'hidden', v_hidden)
    || v_identity
    || private.profile_stats(p_target);
end;
$$;

revoke execute on function private.profile_view(uuid, uuid) from public;

-- Unchanged behaviour; the body after resolving the seat moved to profile_view.
create or replace function public.get_player_profile(p_player_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_target uuid;
begin
  if v_caller is null then raise exception 'UNAUTHENTICATED'; end if;

  if p_player_id is null then
    v_target := v_caller;
  else
    -- A bot or unfilled seat has no account behind it.
    select user_id into v_target
    from public.players
    where id = p_player_id and is_bot = false;
  end if;

  return private.profile_view(v_caller, v_target);
end;
$$;

revoke execute on function public.get_player_profile(uuid) from public, anon;
grant execute on function public.get_player_profile(uuid) to authenticated;

-- The profile of an account the client already knows by id (see header).
create or replace function public.get_account_profile(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
begin
  if v_caller is null then raise exception 'UNAUTHENTICATED'; end if;
  return private.profile_view(v_caller, p_user_id);
end;
$$;

revoke execute on function public.get_account_profile(uuid) from public, anon;
grant execute on function public.get_account_profile(uuid) to authenticated;

-- Bracket seats carry their seat id (players.id) so a seat opens its profile
-- the way it does at the table. Otherwise as 20260929120000_tournaments.sql.
create or replace function public.get_tournament(p_tournament_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_t public.tournaments;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select * into v_t from public.tournaments where id = p_tournament_id;
  if not found then raise exception 'TOURNAMENT_NOT_FOUND'; end if;
  if not exists (select 1 from public.team_members where team_id = v_t.team_id and user_id = v_uid) then
    raise exception 'NOT_TEAM_MEMBER';
  end if;

  return jsonb_build_object(
    'id', v_t.id,
    'name', v_t.name,
    'teamId', v_t.team_id,
    'size', v_t.size,
    'gameType', v_t.game_type,
    'status', v_t.status,
    'checkInOpensAt', v_t.check_in_opens_at,
    'startsAt', v_t.starts_at,
    'winnerUserId', v_t.winner_user_id,
    'myUserId', v_uid,
    'entrants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', e.user_id,
        'displayName', private.clean_text(e.display_name),
        'seed', e.seed,
        'checkedIn', e.checked_in,
        'eliminated', e.eliminated
      ) order by e.seed)
      from public.tournament_entrants e where e.tournament_id = v_t.id), '[]'::jsonb),
    'tables', coalesce((
      select jsonb_agg(jsonb_build_object(
        'round', tt.round,
        'tableIndex', tt.table_index,
        'roomId', tt.room_id,
        'status', tt.status,
        'mine', exists (
          select 1 from public.players p
          where p.room_id = tt.room_id and p.user_id = v_uid),
        'seats', coalesce((
          select jsonb_agg(jsonb_build_object(
            'playerId', p.id,
            'displayName', p.display_name,
            'color', p.color,
            'isBot', p.is_bot,
            'placement', (select r.placement from public.match_results r
              join public.rooms rm on rm.id = tt.room_id
              where r.match_id = rm.current_match_id and r.player_id = p.id)
          ) order by p.seat_index)
          from public.players p where p.room_id = tt.room_id), '[]'::jsonb)
      ) order by tt.round, tt.table_index)
      from public.tournament_tables tt where tt.tournament_id = v_t.id), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.get_tournament(uuid) from public, anon;
grant execute on function public.get_tournament(uuid) to authenticated;
