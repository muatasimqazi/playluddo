-- Fix: a 3- or 4-seat quick match that times out with nobody else found
-- failed with NOT_ENOUGH_PLAYERS instead of starting against computers.
-- public.start_match checks "at least 2 seated" *before* it bot-fills the
-- empty seats, so a lone host never got that far (and the whole matchmake
-- call rolled back). Quick-match rooms now seat their computers themselves,
-- via fill_bot, before calling start_match. Otherwise unchanged from
-- 20260927020000_matchmaking.sql.
create or replace function private.matchmaking_start_room(
  p_display_name text,
  p_game_type text,
  p_player_count int,
  p_user_ids uuid[],
  p_names text[]
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_room_id uuid;
  v_humans int := coalesce(array_length(p_user_ids, 1), 0);
  v_bot_names text[] := array['Rowan', 'Sage', 'Jules', 'Avery', 'Kai', 'Maya', 'Theo', 'Nia'];
  v_bot record;
  v_seat int;
begin
  v_room_id := (public.create_room(p_display_name, null, p_player_count) ->> 'roomId')::uuid;
  update public.rooms set game_type = p_game_type where id = v_room_id;

  if p_player_count = 2 then
    if v_humans = 0 then
      perform public.fill_bot(v_room_id, 2);
    else
      insert into public.players (room_id, seat_index, user_id, display_name, color, status, is_bot)
      values (v_room_id, 2, p_user_ids[1], p_names[1], private.ludo_color_for_seat(2), 'connected', false);
    end if;
  else
    for v_seat in 1..v_humans loop
      insert into public.players (room_id, seat_index, user_id, display_name, color, status, is_bot)
      values (v_room_id, v_seat, p_user_ids[v_seat], p_names[v_seat], private.ludo_color_for_seat(v_seat), 'connected', false);
    end loop;
    for v_seat in (v_humans + 1)..(p_player_count - 1) loop
      perform public.fill_bot(v_room_id, v_seat);
    end loop;
  end if;

  perform public.start_match(v_room_id);

  -- Distinct friendly names for the computers, in a random order.
  for v_bot in
    select p.id, row_number() over (order by p.seat_index) as n
    from public.players p where p.room_id = v_room_id and p.is_bot
  loop
    update public.players set display_name = (
      select name from unnest(v_bot_names) with ordinality as t(name, ord)
      order by md5(v_room_id::text || ord::text) offset v_bot.n - 1 limit 1
    ) where id = v_bot.id;
  end loop;
  perform private.ludo_broadcast_state(v_room_id);

  return v_room_id;
end;
$$;
revoke execute on function private.matchmaking_start_room(text, text, int, uuid[], text[]) from public;
