create function private.luddo_guard_paused_room()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.paused_at is not null and new.paused_at is not null and
    (new.status, new.turn_player_id, new.turn_phase, new.turn_deadline_at,
     new.rolls_this_turn, new.active_dice_value, new.consecutive_sixes, new.winner_ids)
    is distinct from
    (old.status, old.turn_player_id, old.turn_phase, old.turn_deadline_at,
     old.rolls_this_turn, old.active_dice_value, old.consecutive_sixes, old.winner_ids)
  then raise exception 'MATCH_PAUSED'; end if;
  return new;
end; $$;
create trigger luddo_guard_paused_room before update on public.rooms
for each row execute function private.luddo_guard_paused_room();

create function private.luddo_guard_paused_pawn()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists(select 1 from public.rooms where id = old.room_id and paused_at is not null)
  then raise exception 'MATCH_PAUSED'; end if;
  return new;
end; $$;
create trigger luddo_guard_paused_pawn before update on public.pawns
for each row execute function private.luddo_guard_paused_pawn();
