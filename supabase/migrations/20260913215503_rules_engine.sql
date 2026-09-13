-- Authoritative Ludo rules engine (plpgsql), mirrored byte-for-byte in
-- behavior from lib/board/{geometry,rules,bot}.ts. This is the copy the
-- server actually trusts (docs/PRD.md Section 6.2) — the TypeScript copy is
-- client-side display/highlighting only. See docs/IMPLEMENTATION_HANDOFF.md
-- Section 2 on why two implementations exist and how tests/parity plus
-- supabase/tests/ (pgTAP) keep them honest.
--
-- These functions are pure: they take and return jsonb, touch no tables,
-- and are safe to call directly in pgTAP tests without the schema wired up.
-- Wiring them into request_roll/request_move/etc. against real tables is M2.
--
-- Lives in the `private` schema (not `public`) because `public` is the
-- exposed Data API schema (supabase/config.toml) — a function here would
-- otherwise be callable directly over REST by anyone, since Postgres grants
-- EXECUTE on new functions to PUBLIC by default. These are internal building
-- blocks the M2 RPC functions call, not part of the deliberate client API
-- surface. `set search_path = ''` on every function is the same hardening
-- Supabase's own RLS-helper-function docs recommend: it forces every name
-- inside to be schema-qualified, so a malicious search_path can't hijack an
-- unqualified call.
--
-- Shared jsonb shapes (byte-identical field names to the TS side, so parity
-- fixtures are literally the same JSON fed to both engines):
--   pawn:  {"id": text, "color": text, "index": int, "state": text, "pathIndex": int|null}
--   move:  {"pawnId": text, "fromTileId": text|null, "toTileId": text,
--           "capturesPawnIds": text[], "finishesPawn": boolean}

create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------------
-- Geometry (mirrors lib/board/geometry.ts)
-- ---------------------------------------------------------------------------

create or replace function private.ludo_entry_offset(p_color text)
returns int
language sql
immutable
set search_path = ''
as $$
  select case p_color
    when 'red' then 0
    when 'green' then 13
    when 'yellow' then 26
    when 'blue' then 39
    else null
  end;
$$;

create or replace function private.ludo_is_safe_cell(p_global_cell int)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_global_cell in (0, 8, 13, 21, 26, 34, 39, 47);
$$;

create or replace function private.ludo_path_index_to_global_cell(p_color text, p_path_index int)
returns int
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_path_index is null or p_path_index < 0 or p_path_index > 50 then
    raise exception 'ludo_path_index_to_global_cell: pathIndex % is not on the shared track (0-50)', p_path_index;
  end if;
  return (private.ludo_entry_offset(p_color) + p_path_index) % 52;
end;
$$;

create or replace function private.ludo_path_index_to_tile_id(p_color text, p_path_index int)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_path_index is null then
    return 'nest:' || p_color;
  elsif p_path_index >= 0 and p_path_index <= 50 then
    return 'track:' || private.ludo_path_index_to_global_cell(p_color, p_path_index);
  elsif p_path_index > 50 and p_path_index <= 56 then
    return 'home:' || p_color || ':' || (p_path_index - 51);
  else
    raise exception 'ludo_path_index_to_tile_id: pathIndex % out of range', p_path_index;
  end if;
end;
$$;

create or replace function private.ludo_tile_id_to_path_index(p_color text, p_tile_id text)
returns int
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_global_cell int;
  v_home_index int;
begin
  if p_tile_id = 'nest:' || p_color then
    return null;
  elsif p_tile_id like 'track:%' then
    v_global_cell := substring(p_tile_id from 7)::int;
    return (v_global_cell - private.ludo_entry_offset(p_color) + 52) % 52;
  elsif p_tile_id like ('home:' || p_color || ':%') then
    v_home_index := substring(p_tile_id from length('home:' || p_color || ':') + 1)::int;
    return 51 + v_home_index;
  else
    raise exception 'ludo_tile_id_to_path_index: tileId % is not valid for color %', p_tile_id, p_color;
  end if;
end;
$$;

create or replace function private.ludo_derive_state(p_path_index int)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_path_index is null then 'nest'
    when p_path_index <= 50 then 'track'
    when p_path_index < 56 then 'home_lane'
    else 'finished'
  end;
$$;

-- ---------------------------------------------------------------------------
-- Rules (mirrors lib/board/rules.ts)
-- ---------------------------------------------------------------------------

create or replace function private.ludo_captures_at(p_pawns jsonb, p_moving_color text, p_target_path_index int)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_global_cell int;
  v_pawn jsonb;
  v_result jsonb := '[]'::jsonb;
begin
  v_global_cell := private.ludo_path_index_to_global_cell(p_moving_color, p_target_path_index);
  if private.ludo_is_safe_cell(v_global_cell) then
    return v_result;
  end if;

  for v_pawn in select * from jsonb_array_elements(p_pawns)
  loop
    if v_pawn->>'color' = p_moving_color then
      continue;
    end if;
    if v_pawn->>'state' <> 'track' then
      continue;
    end if;
    if private.ludo_path_index_to_global_cell(v_pawn->>'color', (v_pawn->>'pathIndex')::int) = v_global_cell then
      v_result := v_result || to_jsonb(v_pawn->>'id');
    end if;
  end loop;

  return v_result;
end;
$$;

-- Legal moves for one color given a die roll. See PRD 4.2-4.3 and the
-- TS docstring on getLegalMoves for the rule text this implements.
create or replace function private.ludo_legal_moves(p_pawns jsonb, p_color text, p_die_value int)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_pawn jsonb;
  v_state text;
  v_path_index int;
  v_target int;
  v_moves jsonb := '[]'::jsonb;
  v_captures jsonb;
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
    if v_target > 56 then
      continue; -- overshoot — illegal, excluded (not "moved and bounced")
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
$$;

-- Applies an already-legal move: relocates the moving pawn, sends captured pawns to nest.
create or replace function private.ludo_apply_move(p_pawns jsonb, p_move jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_pawn jsonb;
  v_result jsonb := '[]'::jsonb;
  v_moving_pawn_id text := p_move->>'pawnId';
  v_captured_ids jsonb := coalesce(p_move->'capturesPawnIds', '[]'::jsonb);
  v_moving_color text;
  v_new_path_index int;
  v_new_state text;
begin
  select pawn->>'color' into v_moving_color
  from jsonb_array_elements(p_pawns) as pawn
  where pawn->>'id' = v_moving_pawn_id;

  if v_moving_color is null then
    raise exception 'ludo_apply_move: unknown pawnId %', v_moving_pawn_id;
  end if;

  v_new_path_index := private.ludo_tile_id_to_path_index(v_moving_color, p_move->>'toTileId');
  v_new_state := private.ludo_derive_state(v_new_path_index);

  for v_pawn in select * from jsonb_array_elements(p_pawns)
  loop
    if v_pawn->>'id' = v_moving_pawn_id then
      v_result := v_result || jsonb_build_object(
        'id', v_pawn->>'id',
        'color', v_pawn->'color',
        'index', v_pawn->'index',
        'state', v_new_state,
        'pathIndex', v_new_path_index
      );
    elsif v_captured_ids ? (v_pawn->>'id') then
      v_result := v_result || jsonb_build_object(
        'id', v_pawn->>'id',
        'color', v_pawn->'color',
        'index', v_pawn->'index',
        'state', 'nest',
        'pathIndex', null
      );
    else
      v_result := v_result || v_pawn;
    end if;
  end loop;

  return v_result;
end;
$$;

-- PRD 4.2: bonus roll on a six OR a capture — NOT on finishing a pawn alone
-- (confirmed), and never stacked (this returns a boolean, not a count).
create or replace function private.ludo_earns_bonus_roll(p_die_value int, p_move jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_die_value = 6 or jsonb_array_length(coalesce(p_move->'capturesPawnIds', '[]'::jsonb)) > 0;
$$;

-- PRD 4.2: three consecutive sixes cancels that roll's move and ends the turn.
create or replace function private.ludo_evaluate_six_roll(p_consecutive_sixes_before int, p_die_value int)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_after int;
  v_cancel boolean;
begin
  if p_die_value <> 6 then
    v_after := 0;
    v_cancel := false;
  else
    v_after := p_consecutive_sixes_before + 1;
    v_cancel := (v_after = 3);
  end if;

  return jsonb_build_object('consecutiveSixesAfter', v_after, 'cancelMove', v_cancel);
end;
$$;

-- PRD 4.4: a color wins the instant all 4 of its pawns are finished.
create or replace function private.ludo_is_match_won(p_pawns jsonb, p_color text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select count(*) = 4
  from jsonb_array_elements(p_pawns) as pawn
  where pawn->>'color' = p_color and pawn->>'state' = 'finished';
$$;

-- PRD 4.4 ranking: pawns finished desc, then total progress desc, then
-- earlier turn order (lower turnOrder) wins the tie. Input: jsonb array of
-- {"id", "pawnsFinished", "totalProgress", "turnOrder"}. Output: jsonb array
-- of ids in rank order (index 0 = 1st place).
create or replace function private.ludo_rank_players(p_players jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(id order by pawns_finished desc, total_progress desc, turn_order asc), '[]'::jsonb)
  from (
    select
      p->>'id' as id,
      (p->>'pawnsFinished')::int as pawns_finished,
      (p->>'totalProgress')::int as total_progress,
      (p->>'turnOrder')::int as turn_order
    from jsonb_array_elements(p_players) as p
  ) ranked;
$$;

-- ---------------------------------------------------------------------------
-- Bot priority (mirrors lib/board/bot.ts) — PRD 6.8
-- ---------------------------------------------------------------------------

create or replace function private.ludo_choose_bot_move(p_legal_moves jsonb, p_pawns jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_move jsonb;
  v_best jsonb;
  v_pawn_color text;
  v_pawn_index int;
  v_is_finish boolean;
  v_capture_count int;
  v_is_nest_exit boolean;
  v_result_path_index int;
  v_best_finish boolean;
  v_best_capture_count int;
  v_best_nest_exit boolean;
  v_best_result_path_index int;
  v_best_pawn_index int;
  v_first boolean := true;
begin
  for v_move in select * from jsonb_array_elements(p_legal_moves)
  loop
    select pawn->>'color', (pawn->>'index')::int
      into v_pawn_color, v_pawn_index
    from jsonb_array_elements(p_pawns) as pawn
    where pawn->>'id' = v_move->>'pawnId';

    v_is_finish := (v_move->>'finishesPawn')::boolean;
    v_capture_count := jsonb_array_length(coalesce(v_move->'capturesPawnIds', '[]'::jsonb));
    v_is_nest_exit := (v_move->>'fromTileId') like 'nest:%';
    v_result_path_index := coalesce(private.ludo_tile_id_to_path_index(v_pawn_color, v_move->>'toTileId'), -1);

    if v_first
      or (v_is_finish and not v_best_finish)
      or (v_is_finish = v_best_finish and v_capture_count > v_best_capture_count)
      or (v_is_finish = v_best_finish and v_capture_count = v_best_capture_count
          and v_is_nest_exit and not v_best_nest_exit)
      or (v_is_finish = v_best_finish and v_capture_count = v_best_capture_count
          and v_is_nest_exit = v_best_nest_exit and v_result_path_index > v_best_result_path_index)
      or (v_is_finish = v_best_finish and v_capture_count = v_best_capture_count
          and v_is_nest_exit = v_best_nest_exit and v_result_path_index = v_best_result_path_index
          and v_pawn_index < v_best_pawn_index)
    then
      v_best := v_move;
      v_best_finish := v_is_finish;
      v_best_capture_count := v_capture_count;
      v_best_nest_exit := v_is_nest_exit;
      v_best_result_path_index := v_result_path_index;
      v_best_pawn_index := v_pawn_index;
      v_first := false;
    end if;
  end loop;

  return v_best; -- null if p_legal_moves was empty
end;
$$;
