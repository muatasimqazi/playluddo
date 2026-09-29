-- Full match replay access (docs/COMPETITIVE_ROADMAP.md F4.3, R1). The board
-- replay is reconstructed on the client from a match's own events, so the
-- server only needs to hand back the starting snapshot and the ordered,
-- paginated event stream -- to participants of that match only.

-- A match's transcript: metadata, the starting snapshot (seats enriched with
-- current names/avatars, and pawn ownership), and the visual events after a
-- given sequence. Paginate with p_after_sequence + the returned events' last
-- sequence. Readable only by someone who played in the match.
create or replace function public.get_match_transcript(
  p_match_id uuid,
  p_after_sequence bigint default 0,
  p_limit int default 500
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_match public.matches;
  v_started jsonb;
  v_events jsonb;
begin
  if v_user_id is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 1000 then raise exception 'INVALID_LIMIT'; end if;

  select * into v_match from public.matches where id = p_match_id;
  if not found then raise exception 'MATCH_NOT_FOUND'; end if;

  if not exists (
    select 1 from public.match_results r
    where r.match_id = p_match_id and r.user_id = v_user_id
  ) then raise exception 'NOT_A_PARTICIPANT'; end if;

  select jsonb_build_object(
    'seats', coalesce((
      select jsonb_agg(jsonb_build_object(
        'playerId', s->>'playerId',
        'seatIndex', (s->>'seatIndex')::int,
        'color', s->>'color',
        'isBot', (s->>'isBot')::boolean,
        'displayName', private.clean_text(coalesce(p.display_name, 'Player')),
        'avatarId', u.raw_user_meta_data ->> 'avatar_id'
      ) order by (s->>'seatIndex')::int)
      from jsonb_array_elements(e.payload -> 'seats') s
      left join public.players p on p.id = (s->>'playerId')::uuid
      left join auth.users u on u.id = p.user_id
    ), '[]'::jsonb),
    'pawns', e.payload -> 'pawns'
  ) into v_started
  from public.match_events e
  where e.match_id = p_match_id and e.event_type = 'match_started'
  order by e.sequence
  limit 1;

  if v_started is null then raise exception 'MATCH_NOT_REPLAYABLE'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.sequence,
    'sequence', e.sequence,
    'event_type', e.event_type,
    'player_id', e.player_id,
    'payload', e.payload,
    'created_at', e.created_at
  ) order by e.sequence), '[]'::jsonb) into v_events
  from (
    select sequence, event_type, player_id, payload, created_at
    from public.match_events
    where match_id = p_match_id
      and event_type in ('dice_rolled', 'legal_move_selected', 'player_finished', 'match_completed')
      and sequence > p_after_sequence
    order by sequence
    limit p_limit
  ) e;

  return jsonb_build_object(
    'matchId', v_match.id,
    'gameType', v_match.game_type,
    'rules', v_match.rules,
    'endedAt', v_match.ended_at,
    'endReason', v_match.end_reason,
    'seats', v_started -> 'seats',
    'pawns', v_started -> 'pawns',
    'events', v_events
  );
end;
$$;

revoke execute on function public.get_match_transcript(uuid, bigint, int) from public, anon;
grant execute on function public.get_match_transcript(uuid, bigint, int) to authenticated;

-- The caller's own finished matches, newest first, for the profile history list
-- (F3.1) and the replay entry points. Paginate with p_before = the oldest
-- endedAt already shown.
create or replace function public.get_my_match_history(
  p_limit int default 20,
  p_before timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 50 then raise exception 'INVALID_LIMIT'; end if;

  return (
    with mine as (
      select m.id, m.game_type, m.ended_at, m.end_reason, mr.placement, mr.player_id
      from public.match_results mr
      join public.matches m on m.id = mr.match_id
      where mr.user_id = v_user_id
        and m.ended_at is not null
        and (p_before is null or m.ended_at < p_before)
      order by m.ended_at desc
      limit p_limit
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'matchId', mine.id,
      'gameType', mine.game_type,
      'endedAt', mine.ended_at,
      'endReason', mine.end_reason,
      'placement', mine.placement,
      'playerCount', (select count(*) from public.match_results r where r.match_id = mine.id),
      'opponents', coalesce((
        select jsonb_agg(private.clean_text(coalesce(p.display_name, 'Player')) order by r.seat_index)
        from public.match_results r
        left join public.players p on p.id = r.player_id
        where r.match_id = mine.id and r.player_id <> mine.player_id
      ), '[]'::jsonb)
    ) order by mine.ended_at desc), '[]'::jsonb)
    from mine
  );
end;
$$;

revoke execute on function public.get_my_match_history(int, timestamptz) from public, anon;
grant execute on function public.get_my_match_history(int, timestamptz) to authenticated;
