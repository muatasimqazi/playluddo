-- Rush mode (docs/COMPETITIVE_ROADMAP.md F2.3): a match with a clock. When
-- the time is up the players are ranked where they stand, by the same
-- order used everywhere else: pieces home, then progress, then turn order.
--
-- `matchMinutes` is 0 (off, the default), 5 or 10. The turn in progress
-- always finishes: the clock is checked when the turn would pass on, not
-- in the middle of someone's move. A paused match's clock stops with it.

alter table public.rooms add column match_ends_at timestamptz;

create or replace function private.ludo_default_rules()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select '{"bonusRollOnFinish": true, "startOnBoard": 0, "pawnsToWin": 4,
           "captureToEnterHome": false, "snakesAnyRollToStart": false, "snakesBounceBack": false,
           "matchMinutes": 0}'::jsonb;
$$;

-- Ends a timed match where everyone stands.
create or replace function private.ludo_end_match_on_time(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_standings jsonb;
  v_ranked uuid[];
begin
  select * into v_room from public.rooms where id = p_room_id;
  if v_room.status <> 'in_game' then return; end if;

  select jsonb_agg(jsonb_build_object(
    'id', p.id,
    'pawnsFinished', (select count(*) from public.pawns pw where pw.player_id = p.id and pw.state = 'finished'),
    'totalProgress', (select coalesce(sum(coalesce(pw.path_index, 0)), 0) from public.pawns pw where pw.player_id = p.id),
    'turnOrder', p.seat_index
  )) into v_standings
  from public.players p where p.room_id = p_room_id;

  select array_agg(value::text::uuid order by ord)
  into v_ranked
  from jsonb_array_elements_text(private.ludo_rank_players(v_standings)) with ordinality t(value, ord);

  update public.rooms
  set status = 'summary',
      turn_phase = 'complete',
      turn_player_id = null,
      turn_deadline_at = null,
      active_dice_value = null,
      winner_ids = v_ranked,
      match_end_reason = 'completed'
  where id = p_room_id;

  perform private.ludo_append_event(p_room_id, 'match_completed', v_ranked[1],
    jsonb_build_object('winnerId', v_ranked[1], 'placements', v_ranked, 'reason', 'time'));
end;
$$;
revoke execute on function private.ludo_end_match_on_time(uuid) from public;

-- Redefines the live version: the clock is checked as the turn passes on.
CREATE OR REPLACE FUNCTION private.ludo_advance_to_next_player(p_room_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_room public.rooms;
  v_current_seat int;
  v_next_player_id uuid;
begin
  select * into v_room from public.rooms where id = p_room_id;

  -- Rush mode (F2.3): the clock ran out during that turn, so the turn
  -- finished and the match ends here rather than mid-move.
  if v_room.match_ends_at is not null and v_room.status = 'in_game' and now() >= v_room.match_ends_at then
    perform private.ludo_end_match_on_time(p_room_id);
    return;
  end if;

  select seat_index into v_current_seat
  from public.players
  where room_id = p_room_id and id = v_room.turn_player_id;

  select id into v_next_player_id
  from public.players
  where room_id = p_room_id
    and not (id = any(v_room.winner_ids))
  order by
    case when seat_index > coalesce(v_current_seat, -1) then 0 else 1 end,
    seat_index
  limit 1;

  update public.rooms
  set turn_player_id = v_next_player_id,
      turn_phase = 'awaiting_roll',
      turn_deadline_at = private.ludo_next_turn_deadline(v_next_player_id),
      active_dice_value = null,
      consecutive_sixes = 0,
      rolls_this_turn = 0
  where id = p_room_id;
end;
$function$;
revoke execute on function private.ludo_advance_to_next_player(uuid) from public;
