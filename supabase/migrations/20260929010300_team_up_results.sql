-- Resolve every requested, bot-selected and timed-out move through the same
-- authoritative legality function.  In Team Up a seat remains in rotation
-- after its own four finish, then may play the opposite partner's pawns.
create or replace function private.ludo_perform_move(p_room_id uuid,p_player_id uuid,p_pawn_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_room public.rooms;
  v_actor_color text;
  v_owner_color text;
  v_team boolean;
  v_before jsonb;
  v_legal jsonb;
  v_move jsonb;
  v_after jsonb;
  v_pawn jsonb;
  v_finished boolean;
  v_won boolean;
  v_bonus boolean;
  v_winners uuid[];
  v_player_count int;
  v_winning_side smallint;
  v_owner_id uuid;
begin
  select * into v_room from public.rooms where id=p_room_id;
  select color into v_actor_color from public.players where id=p_player_id and room_id=p_room_id;
  v_team := coalesce((private.ludo_resolve_rules(v_room.match_rules)->>'teamUp')::boolean,false);
  v_before := private.ludo_room_pawns_json(p_room_id);
  v_legal := private.ludo_legal_moves(v_before,v_actor_color,v_room.active_dice_value,
    v_room.match_rules,(select has_captured from public.players where id=p_player_id));
  select value into v_move from jsonb_array_elements(v_legal)
    where (value->>'pawnId')::uuid=p_pawn_id;
  if v_move is null then raise exception 'ILLEGAL_MOVE'; end if;
  select color,player_id into v_owner_color,v_owner_id
    from public.pawns pw join public.players pl on pl.id=pw.player_id
    where pw.id=p_pawn_id and pw.room_id=p_room_id;
  v_after := private.ludo_apply_move(v_before,v_move);
  for v_pawn in select value from jsonb_array_elements(v_after) loop
    update public.pawns set state=v_pawn->>'state',path_index=(v_pawn->>'pathIndex')::int
      where id=(v_pawn->>'id')::uuid;
  end loop;
  if jsonb_array_length(coalesce(v_move->'capturesPawnIds','[]'::jsonb))>0 then
    update public.players set has_captured=true where id=p_player_id and not has_captured;
  end if;
  perform private.ludo_append_event(p_room_id,'legal_move_selected',p_player_id,
    v_move || jsonb_build_object('pawnOwnerId',v_owner_id));

  v_finished := private.ludo_is_match_won(v_after,v_owner_color,v_room.match_rules);
  if v_team then
    -- Finishing the actor's own four only unlocks partner control.  The
    -- result is decided by the two colors together, never by pawnsToWin.
    if v_finished and not private.ludo_is_match_won(v_before,v_owner_color,v_room.match_rules) then
      perform private.ludo_append_event(p_room_id,'player_finished',v_owner_id,
        jsonb_build_object('side',(select side from public.players where id=v_owner_id)));
    end if;
    v_won := private.ludo_team_up_won(v_after,v_owner_color);
    if v_won then
      select side into v_winning_side from public.players where id=v_owner_id;
      select array_agg(id order by case when side=v_winning_side then 0 else 1 end,seat_index)
        into v_winners from public.players where room_id=p_room_id;
      update public.rooms set status='summary',winner_ids=v_winners,
        match_end_reason='completed',turn_phase='complete',turn_deadline_at=null,
        turn_player_id=null,active_dice_value=null where id=p_room_id;
      perform private.ludo_append_event(p_room_id,'match_completed',p_player_id,
        jsonb_build_object('winnerId',v_winners[1],'winningSide',v_winning_side,
          'winningPlayerIds',to_jsonb(v_winners[1:2]),'placements',to_jsonb(v_winners)));
    end if;
  else
    v_won := v_finished;
    if v_won then
      v_winners := case when p_player_id=any(v_room.winner_ids) then v_room.winner_ids
        else array_append(v_room.winner_ids,p_player_id) end;
      select count(*) into v_player_count from public.players where room_id=p_room_id;
      perform private.ludo_append_event(p_room_id,'player_finished',p_player_id,
        jsonb_build_object('place',array_length(v_winners,1)));
      if (v_player_count=2 and coalesce(array_length(v_winners,1),0)>=1)
        or coalesce(array_length(v_winners,1),0)>=v_player_count then
        update public.rooms set status='summary',winner_ids=v_winners,
          match_end_reason='completed',turn_phase='complete',turn_deadline_at=null,
          active_dice_value=null where id=p_room_id;
        perform private.ludo_append_event(p_room_id,'match_completed',v_winners[1],
          jsonb_build_object('winnerId',v_winners[1],'placements',v_winners));
      else
        update public.rooms set winner_ids=v_winners where id=p_room_id;
        perform private.ludo_advance_to_next_player(p_room_id);
      end if;
    end if;
  end if;

  if not v_won and (v_team or not v_finished) then
    v_bonus := private.ludo_earns_bonus_roll(v_room.active_dice_value,v_move,v_room.match_rules);
    if v_bonus then
      update public.rooms set turn_phase='awaiting_roll',
        turn_deadline_at=private.ludo_next_turn_deadline(p_player_id),active_dice_value=null
        where id=p_room_id;
    else
      perform private.ludo_advance_to_next_player(p_room_id);
    end if;
  end if;
  perform private.ludo_broadcast_state(p_room_id);
  return jsonb_build_object('move',v_move,'won',v_won);
end;
$$;
revoke execute on function private.ludo_perform_move(uuid,uuid,uuid) from public;
