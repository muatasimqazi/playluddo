-- Party Mode's TV view (docs/COMPETITIVE_ROADMAP.md Section 6, P4).

-- The screen animates rolls and moves from the room's event log, as seated
-- phones do. Events hold no secrets: the dice seed stays in
-- private.match_dice until the match ends.
create policy "party screens can read events in their room" on public.match_events
for select to authenticated
using ( (select private.ludo_is_display_of_room(room_id)) );

-- A phone choosing a piece shows that choice on the screen before it
-- confirms. Only the player whose move it is, only a legal piece, and only
-- in a party room; nothing is stored, and a later preview or the move
-- itself replaces it. A null pawn clears the preview.
create or replace function public.party_preview_move(p_room_id uuid, p_pawn_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_state jsonb;
begin
  if (select auth.uid()) is null then raise exception 'UNAUTHENTICATED'; end if;
  v_player := private.ludo_caller_player_id(p_room_id);
  if v_player is null then raise exception 'SEAT_NOT_CONTROLLED'; end if;
  if not coalesce((select is_party from public.rooms where id = p_room_id), false) then
    raise exception 'NOT_PARTY_ROOM';
  end if;
  v_state := private.ludo_room_state_json(p_room_id);
  if v_state->>'turnPlayerId' is distinct from v_player::text or v_state->>'turnPhase' <> 'awaiting_move' then
    raise exception 'NOT_YOUR_TURN';
  end if;
  if p_pawn_id is not null and not exists (
    select 1 from jsonb_array_elements(v_state->'legalMoves') m where m->>'pawnId' = p_pawn_id::text
  ) then
    raise exception 'ILLEGAL_MOVE';
  end if;
  perform realtime.send(
    jsonb_build_object('playerId', v_player, 'pawnId', p_pawn_id, 'eventSequence', (v_state->>'eventSequence')::bigint),
    'move_preview',
    'room:' || p_room_id::text,
    true
  );
end;
$$;
revoke execute on function public.party_preview_move(uuid, uuid) from public;
grant execute on function public.party_preview_move(uuid, uuid) to authenticated;
