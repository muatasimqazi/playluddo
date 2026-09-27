-- Move Snakes & Ladders onto the new board artwork
-- (designs/snake-and-ladder/snakes-and-ladders-board.svg): 10 ladders and 9
-- snakes in new positions. Same function body as
-- 20260921010000_snakes_six_to_enter_and_two_player_win.sql with only the
-- jump table changed. Mirrors LADDERS/SNAKES in lib/board/snakes.ts.
create or replace function private.snakes_move(p_pawns jsonb, p_color text, p_die int)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_pawn jsonb; v_landing int; v_destination int;
begin
  if p_die is null or p_die not between 1 and 6 then return null; end if;
  select p into v_pawn from jsonb_array_elements(p_pawns) p
    where p->>'color' = p_color and p->>'state' <> 'finished' limit 1;
  if v_pawn is null then return null; end if;
  if (v_pawn->>'pathIndex') is null and p_die <> 6 then return null; end if;
  v_landing := coalesce((v_pawn->>'pathIndex')::int, 0) + p_die;
  if v_landing > 100 then return null; end if;
  v_destination := case v_landing
    -- Ladders
    when 3 then 23 when 4 then 16 when 7 then 27 when 9 then 30 when 17 then 37
    when 28 then 54 when 36 then 65 when 50 then 73 when 71 then 91 when 77 then 84
    -- Snakes
    when 22 then 2 when 26 then 6 when 59 then 40 when 64 then 44 when 82 then 62
    when 87 then 46 when 93 then 72 when 95 then 75 when 98 then 38
    else v_landing end;
  return jsonb_build_object(
    'pawnId', v_pawn->>'id',
    'fromTileId', case when v_pawn->>'pathIndex' is null then null else 'snakes:' || (v_pawn->>'pathIndex') end,
    'toTileId', 'snakes:' || v_destination,
    'capturesPawnIds', '[]'::jsonb,
    'finishesPawn', v_destination = 100,
    'landingSquare', v_landing
  );
end;
$$;
revoke execute on function private.snakes_move(jsonb, text, int) from public;
