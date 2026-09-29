-- Blockades (docs/COMPETITIVE_ROADMAP.md F2.4): two pieces of the same
-- colour on one unsafe square stop every other colour, both from passing
-- that square and from landing on it. Their owner passes freely, and a
-- blockade never forms on a star: those are safe squares already.
--
-- Off by default, like every other house rule.

create or replace function private.ludo_default_rules()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select '{"bonusRollOnFinish": true, "startOnBoard": 0, "pawnsToWin": 4,
           "captureToEnterHome": false, "snakesAnyRollToStart": false, "snakesBounceBack": false,
           "matchMinutes": 0, "blockades": false}'::jsonb;
$$;

-- True if another colour holds a blockade on any shared square this move
-- would cross or land on. Only squares on the shared track can block: the
-- home column is private.
create or replace function private.ludo_blocked_between(
  p_pawns jsonb,
  p_color text,
  p_from_path_index int,
  p_to_path_index int
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_step int;
  v_cell int;
begin
  for v_step in (p_from_path_index + 1)..least(p_to_path_index, 50) loop
    v_cell := private.ludo_path_index_to_global_cell(p_color, v_step);
    if private.ludo_is_safe_cell(v_cell) then
      continue;
    end if;
    if exists (
      select 1
      from jsonb_array_elements(p_pawns) pawn
      where pawn->>'color' <> p_color
        and pawn->>'state' = 'track'
        and private.ludo_path_index_to_global_cell(pawn->>'color', (pawn->>'pathIndex')::int) = v_cell
      group by pawn->>'color'
      having count(*) >= 2
    ) then
      return true;
    end if;
  end loop;
  return false;
end;
$$;
revoke execute on function private.ludo_blocked_between(jsonb, text, int, int) from public;

-- Redefines the live version: a move may not cross or land on a blockade.
CREATE OR REPLACE FUNCTION private.ludo_legal_moves(p_pawns jsonb, p_color text, p_die_value integer, p_rules jsonb DEFAULT NULL::jsonb, p_has_captured boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare
  v_pawn jsonb;
  v_state text;
  v_path_index int;
  v_target int;
  v_moves jsonb := '[]'::jsonb;
  v_captures jsonb;
  -- Master mode: this player has to capture before any piece goes home.
  v_held_back boolean := (private.ludo_resolve_rules(p_rules)->>'captureToEnterHome')::boolean
    and not coalesce(p_has_captured, false);
  v_blockades boolean := (private.ludo_resolve_rules(p_rules)->>'blockades')::boolean;
begin
  for v_pawn in select * from jsonb_array_elements(p_pawns)
  loop
    if v_pawn->>'color' <> p_color then
      continue;
    end if;

    v_state := v_pawn->>'state';

    if v_state = 'nest' then
      if p_die_value <> 6 then
        continue;
      end if;
      v_captures := private.ludo_captures_at(p_pawns, p_color, 0);
      v_moves := v_moves || jsonb_build_object(
        'pawnId', v_pawn->>'id',
        'fromTileId', private.ludo_path_index_to_tile_id(p_color, null),
        'toTileId', private.ludo_path_index_to_tile_id(p_color, 0),
        'capturesPawnIds', v_captures,
        'finishesPawn', false
      );
      continue;
    end if;

    if v_state = 'finished' then
      continue;
    end if;

    v_path_index := (v_pawn->>'pathIndex')::int;
    v_target := v_path_index + p_die_value;
    -- Only a piece still on the shared track is held back. One already in
    -- the home column has passed that point and carries on.
    if v_held_back and v_path_index <= 50 and v_target > 50 then
      v_target := 50; -- stops at the last shared square
    end if;
    if v_target > 56 then
      continue; -- overshoot — illegal, excluded (not "moved and bounced")
    end if;
    -- Blockades (F2.4): two pieces of one colour on an unsafe square stop
    -- everyone else, both from passing it and from landing on it.
    if v_blockades and private.ludo_blocked_between(p_pawns, p_color, v_path_index, v_target) then
      continue;
    end if;
    if v_target = v_path_index then
      continue; -- held back with nowhere to go
    end if;

    if v_target <= 50 then
      v_captures := private.ludo_captures_at(p_pawns, p_color, v_target);
    else
      v_captures := '[]'::jsonb;
    end if;

    v_moves := v_moves || jsonb_build_object(
      'pawnId', v_pawn->>'id',
      'fromTileId', private.ludo_path_index_to_tile_id(p_color, v_path_index),
      'toTileId', private.ludo_path_index_to_tile_id(p_color, v_target),
      'capturesPawnIds', v_captures,
      'finishesPawn', (v_target = 56)
    );
  end loop;

  return v_moves;
end;
$function$;
revoke execute on function private.ludo_legal_moves(jsonb, text, integer, jsonb, boolean) from public;
