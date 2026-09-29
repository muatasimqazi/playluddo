-- Snakes & Ladders: a second printed board (docs/COMPETITIVE_ROADMAP.md
-- F2.6). Adds the `snakesBoard` rule key (0 = the default board, 1 = the
-- second board), off by default so the game is unchanged.
--
-- Like the other two F2.6 keys, snakesBoard sits outside the Ludo allow-list
-- and is accepted purely by being a known key of ludo_default_rules(): the
-- key check and type check in set_room_rules and the whitelist in
-- ludo_resolve_rules pick it up automatically. Any value other than 1 plays
-- the default board, so an out-of-range value is harmless.
--
-- The two jump tables mirror SNAKES_LAYOUTS in lib/board/snakes.ts and the
-- artwork in designs/snake-and-ladder/ (…-board.svg and …-board-2.svg).

create or replace function private.ludo_default_rules()
returns jsonb language sql immutable set search_path = '' as $$
  select '{"bonusRollOnFinish": true, "startOnBoard": 0, "pawnsToWin": 4,
           "captureToEnterHome": false, "snakesAnyRollToStart": false,
           "snakesBounceBack": false, "snakesBoard": 0, "matchMinutes": 0,
           "blockades": false, "turnSeconds": 15, "teamUp": false}'::jsonb;
$$;

-- Redefines 20260928210000_snakes_variants.sql's version: the room's rules
-- decide how a piece gets on the board, what overshooting 100 does, and which
-- of the two boards is in play.
create or replace function private.snakes_move(p_pawns jsonb, p_color text, p_die integer, p_rules jsonb default null)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_pawn jsonb;
  v_landing int;
  v_destination int;
  v_rules jsonb := private.ludo_resolve_rules(p_rules);
  v_board int := coalesce((v_rules->>'snakesBoard')::int, 0);
begin
  if p_die is null or p_die not between 1 and 6 then return null; end if;
  select p into v_pawn from jsonb_array_elements(p_pawns) p
    where p->>'color' = p_color and p->>'state' <> 'finished' limit 1;
  if v_pawn is null then return null; end if;
  if (v_pawn->>'pathIndex') is null and p_die <> 6
    and not (v_rules->>'snakesAnyRollToStart')::boolean then return null; end if;
  v_landing := coalesce((v_pawn->>'pathIndex')::int, 0) + p_die;
  if v_landing > 100 then
    if (v_rules->>'snakesBounceBack')::boolean then
      v_landing := 200 - v_landing; -- bounces back off the end
    else
      return null;
    end if;
  end if;
  v_destination := case when v_board = 1 then
    case v_landing
      -- Board 2 ladders
      when 2 then 23 when 8 then 26 when 20 then 41 when 32 then 51 when 40 then 59
      when 63 then 81 when 74 then 92 when 85 then 95
      -- Board 2 snakes
      when 17 then 7 when 30 then 9 when 43 then 22 when 54 then 34 when 66 then 45
      when 76 then 58 when 89 then 68 when 97 then 79
      else v_landing end
  else
    case v_landing
      -- Board 1 (default) ladders
      when 3 then 23 when 4 then 16 when 7 then 27 when 9 then 30 when 17 then 37
      when 28 then 54 when 36 then 65 when 50 then 73 when 71 then 91 when 77 then 84
      -- Board 1 (default) snakes
      when 22 then 2 when 26 then 6 when 59 then 40 when 64 then 44 when 82 then 62
      when 87 then 46 when 93 then 72 when 95 then 75 when 98 then 38
      else v_landing end
  end;
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
revoke execute on function private.snakes_move(jsonb, text, integer, jsonb) from public;
