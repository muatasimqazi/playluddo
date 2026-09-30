-- F5.2 — 5 and 6 players on a hexagonal board.
--
-- The 4-arm square cross (2-4 players) and the 6-arm hexagon (5-6 players)
-- are the same structure at different sizes: arms * 13 track cells, entries
-- every 13, home lane 5, 4 pawns. This makes the plpgsql geometry engine
-- parametric on an arm count, exactly mirroring lib/board/boardSpec.ts, so
-- the same functions serve both boards and tests/parity stays byte-for-byte.
--
--   4 arms -> 52 cells, LAST_TRACK_CELL 50, HOME_LANE_START 51, FINISHED 56
--   6 arms -> 78 cells, LAST_TRACK_CELL 76, HOME_LANE_START 77, FINISHED 82
--
-- The low-level geometry helpers take `p_arms int default 4`, so every
-- existing 2-arg/1-arg caller (and the pgTAP fixtures) keeps 4-arm behaviour
-- untouched. The move-level functions derive the arm count from the pawns
-- they already receive: orange/black pawns exist ONLY on the hex board, so
-- their presence means 6 arms — no new parameter has to thread through the
-- RPC layer. See docs/IMPLEMENTATION_HANDOFF.md Section 2.

-- ---------------------------------------------------------------------------
-- Constraints: widen colours and seat count.
-- ---------------------------------------------------------------------------

alter table public.players drop constraint if exists players_color_check;
alter table public.players add constraint players_color_check
  check (color in ('red', 'green', 'yellow', 'blue', 'orange', 'black'));

alter table public.rooms drop constraint if exists rooms_max_players_check;
alter table public.rooms add constraint rooms_max_players_check
  check (max_players between 2 and 6);

-- ---------------------------------------------------------------------------
-- Geometry helpers (mirror lib/board/geometry.ts + boardSpec.ts)
-- ---------------------------------------------------------------------------

-- Entry offsets are absolute per colour (seat index * 13), the same on both
-- boards; orange/black simply extend the sequence.
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
    when 'orange' then 52
    when 'black' then 65
    else null
  end;
$$;

-- A cell is safe iff it is an arm's entry (offset 0) or its star (offset 8).
-- Every reachable global cell is < arms*13, so the modulo characterises the
-- 8 (cross) / 12 (hex) safe cells identically to boardSpec's safeCells set.
create or replace function private.ludo_is_safe_cell(p_global_cell int)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_global_cell % 13) in (0, 8);
$$;

-- How many arms the board has, inferred from the pawns: orange or black can
-- only occur on the 6-arm hexagon (mirrors boardSpecForPlayers).
create or replace function private.ludo_board_arms(p_pawns jsonb)
returns int
language sql
immutable
set search_path = ''
as $$
  select case when exists (
    select 1 from jsonb_array_elements(p_pawns) pawn
    where pawn->>'color' in ('orange', 'black')
  ) then 6 else 4 end;
$$;

-- The originals took no arm count. Adding a defaulted `p_arms` creates a new
-- overload rather than replacing them, which would make every existing 2-arg
-- call ambiguous — so drop the old arities first. All existing callers pass 2
-- args and now resolve to the defaulted versions (p_arms => 4, unchanged).
drop function if exists private.ludo_path_index_to_global_cell(text, int);
drop function if exists private.ludo_path_index_to_tile_id(text, int);
drop function if exists private.ludo_tile_id_to_path_index(text, text);
drop function if exists private.ludo_derive_state(int);

create or replace function private.ludo_path_index_to_global_cell(
  p_color text, p_path_index int, p_arms int default 4
)
returns int
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_track_length int := p_arms * 13;
begin
  if p_path_index is null or p_path_index < 0 or p_path_index > v_track_length - 2 then
    raise exception 'ludo_path_index_to_global_cell: pathIndex % is not on the shared track (0-%)', p_path_index, v_track_length - 2;
  end if;
  return (private.ludo_entry_offset(p_color) + p_path_index) % v_track_length;
end;
$$;

create or replace function private.ludo_path_index_to_tile_id(
  p_color text, p_path_index int, p_arms int default 4
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_last int := p_arms * 13 - 2;
  v_home_start int := p_arms * 13 - 1;
  v_finished int := p_arms * 13 + 4;
begin
  if p_path_index is null then
    return 'nest:' || p_color;
  elsif p_path_index >= 0 and p_path_index <= v_last then
    return 'track:' || private.ludo_path_index_to_global_cell(p_color, p_path_index, p_arms);
  elsif p_path_index > v_last and p_path_index <= v_finished then
    return 'home:' || p_color || ':' || (p_path_index - v_home_start);
  else
    raise exception 'ludo_path_index_to_tile_id: pathIndex % out of range', p_path_index;
  end if;
end;
$$;

create or replace function private.ludo_tile_id_to_path_index(
  p_color text, p_tile_id text, p_arms int default 4
)
returns int
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_track_length int := p_arms * 13;
  v_home_start int := p_arms * 13 - 1;
  v_global_cell int;
  v_home_index int;
begin
  if p_tile_id = 'nest:' || p_color then
    return null;
  elsif p_tile_id like 'track:%' then
    v_global_cell := substring(p_tile_id from 7)::int;
    return (v_global_cell - private.ludo_entry_offset(p_color) + v_track_length) % v_track_length;
  elsif p_tile_id like ('home:' || p_color || ':%') then
    v_home_index := substring(p_tile_id from length('home:' || p_color || ':') + 1)::int;
    return v_home_start + v_home_index;
  else
    raise exception 'ludo_tile_id_to_path_index: tileId % is not valid for color %', p_tile_id, p_color;
  end if;
end;
$$;

create or replace function private.ludo_derive_state(p_path_index int, p_arms int default 4)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_path_index is null then 'nest'
    when p_path_index <= p_arms * 13 - 2 then 'track'
    when p_path_index < p_arms * 13 + 4 then 'home_lane'
    else 'finished'
  end;
$$;

-- ---------------------------------------------------------------------------
-- Move-level functions: derive the arm count from the pawns and thread it in.
-- These redefine the live versions (latest create-or-replace wins at runtime).
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
  v_arms int := private.ludo_board_arms(p_pawns);
begin
  v_global_cell := private.ludo_path_index_to_global_cell(p_moving_color, p_target_path_index, v_arms);
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
    if private.ludo_path_index_to_global_cell(v_pawn->>'color', (v_pawn->>'pathIndex')::int, v_arms) = v_global_cell then
      v_result := v_result || to_jsonb(v_pawn->>'id');
    end if;
  end loop;

  return v_result;
end;
$$;

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
  v_arms int := private.ludo_board_arms(p_pawns);
begin
  for v_step in (p_from_path_index + 1)..least(p_to_path_index, v_arms * 13 - 2) loop
    v_cell := private.ludo_path_index_to_global_cell(p_color, v_step, v_arms);
    if private.ludo_is_safe_cell(v_cell) then
      continue;
    end if;
    if exists (
      select 1
      from jsonb_array_elements(p_pawns) pawn
      where pawn->>'color' <> p_color
        and pawn->>'state' = 'track'
        and private.ludo_path_index_to_global_cell(pawn->>'color', (pawn->>'pathIndex')::int, v_arms) = v_cell
      group by pawn->>'color'
      having count(*) >= 2
    ) then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

-- The five-argument function remains the sole legality source; now board-size
-- aware. Mirrors lib/board/rules.ts getLegalMoves with a BoardSpec.
create or replace function private.ludo_legal_moves(
  p_pawns jsonb, p_color text, p_die_value integer,
  p_rules jsonb default null, p_has_captured boolean default false
)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_rules jsonb := private.ludo_resolve_rules(p_rules);
  v_team boolean := coalesce((private.ludo_resolve_rules(p_rules)->>'teamUp')::boolean, false);
  v_allies text[];
  v_controls text[];
  v_pawn jsonb;
  v_color text;
  v_state text;
  v_from int;
  v_to int;
  v_cell int;
  v_captures jsonb;
  v_moves jsonb := '[]'::jsonb;
  v_arms int := private.ludo_board_arms(p_pawns);
  v_last int := v_arms * 13 - 2;
  v_finished int := v_arms * 13 + 4;
begin
  v_allies := case when not v_team then array[p_color]
    when p_color in ('red', 'yellow') then array['red','yellow']
    else array['green','blue'] end;
  v_controls := array[p_color];
  if v_team and (select count(*) from jsonb_array_elements(p_pawns) pawn
    where pawn->>'color' = p_color and pawn->>'state' = 'finished') = 4 then
    v_controls := v_allies;
  end if;

  for v_pawn in select value from jsonb_array_elements(p_pawns) loop
    v_color := v_pawn->>'color';
    if not (v_color = any(v_controls)) then continue; end if;
    v_state := v_pawn->>'state';
    if v_state = 'finished' then continue; end if;
    v_from := (v_pawn->>'pathIndex')::int;
    if v_state = 'nest' then
      if p_die_value <> 6 then continue; end if;
      v_to := 0;
    else
      v_to := v_from + p_die_value;
      if (v_rules->>'captureToEnterHome')::boolean and not coalesce(p_has_captured,false)
        and v_from <= v_last and v_to > v_last then v_to := v_last; end if;
      if v_to > v_finished or v_to = v_from then continue; end if;
      if (v_rules->>'blockades')::boolean
        and private.ludo_blocked_between(p_pawns,v_color,v_from,v_to) then continue; end if;
    end if;
    v_captures := '[]'::jsonb;
    if v_to <= v_last then
      v_cell := private.ludo_path_index_to_global_cell(v_color,v_to,v_arms);
      if not private.ludo_is_safe_cell(v_cell) then
        select coalesce(jsonb_agg(other->>'id'), '[]'::jsonb) into v_captures
        from jsonb_array_elements(p_pawns) other
        where not (other->>'color' = any(v_allies)) and other->>'state' = 'track'
          and private.ludo_path_index_to_global_cell(other->>'color',(other->>'pathIndex')::int,v_arms) = v_cell;
      end if;
    end if;
    v_moves := v_moves || jsonb_build_object(
      'pawnId',v_pawn->>'id',
      'fromTileId',private.ludo_path_index_to_tile_id(v_color,v_from,v_arms),
      'toTileId',private.ludo_path_index_to_tile_id(v_color,v_to,v_arms),
      'capturesPawnIds',v_captures,'finishesPawn',v_to = v_finished
    );
  end loop;
  return v_moves;
end;
$$;
revoke execute on function private.ludo_legal_moves(jsonb,text,integer,jsonb,boolean) from public;

-- 20260928200100_master_mode_roll.sql already dropped the 3-argument overload
-- so every 3-arg call (e.g. ludo_room_state_json's display hint) resolves to
-- the 5-arg version above via its defaults — which is now board-size aware.
-- Keep it dropped: re-creating a 3-arg overload would make those calls
-- ambiguous again.
drop function if exists private.ludo_legal_moves(jsonb, text, integer);

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
  v_arms int := private.ludo_board_arms(p_pawns);
begin
  select pawn->>'color' into v_moving_color
  from jsonb_array_elements(p_pawns) as pawn
  where pawn->>'id' = v_moving_pawn_id;

  if v_moving_color is null then
    raise exception 'ludo_apply_move: unknown pawnId %', v_moving_pawn_id;
  end if;

  v_new_path_index := private.ludo_tile_id_to_path_index(v_moving_color, p_move->>'toTileId', v_arms);
  v_new_state := private.ludo_derive_state(v_new_path_index, v_arms);

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
  v_arms int := private.ludo_board_arms(p_pawns);
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
    v_result_path_index := coalesce(private.ludo_tile_id_to_path_index(v_pawn_color, v_move->>'toTileId', v_arms), -1);

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

-- ---------------------------------------------------------------------------
-- Seats & colours: seats 4 and 5 are orange and black.
-- ---------------------------------------------------------------------------

create or replace function private.ludo_color_for_seat(p_seat_index int)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_seat_index
    when 0 then 'red'
    when 1 then 'green'
    when 2 then 'yellow'
    when 3 then 'blue'
    when 4 then 'orange'
    when 5 then 'black'
    else null
  end;
$$;
revoke execute on function private.ludo_color_for_seat(int) from public;

-- Seats 0-5 are valid; 3-6 player rooms just fill clockwise (seat <
-- max_players). A 2-player room keeps the diagonal-pair rule on the 4-arm
-- cross, so only seats 0-3: orange and black would put two players on the
-- hexagon (the board follows those colours) with no diagonal partner.
create or replace function private.ludo_valid_seat(p_room_id uuid, p_seat_index int, p_ignore_player_id uuid default null)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_max int; v_other_seat int;
begin
  if p_seat_index < 0 or p_seat_index > 5 then return false; end if;
  select max_players into v_max from public.rooms where id = p_room_id;
  if v_max <> 2 then return p_seat_index < v_max; end if;
  if p_seat_index > 3 then return false; end if;
  select seat_index into v_other_seat from public.players
    where room_id = p_room_id and (p_ignore_player_id is null or id <> p_ignore_player_id)
    limit 1;
  if v_other_seat is null then return true; end if;
  return p_seat_index = (v_other_seat + 2) % 4;
end;
$$;
revoke execute on function private.ludo_valid_seat(uuid, int, uuid) from public;

-- ---------------------------------------------------------------------------
-- RPC guards: accept 5-6 seats and the two new colours.
-- join_room / fill_bot / start_match already parameterise on max_players, so
-- they need no change once ludo_valid_seat and ludo_color_for_seat allow 5-6.
-- ---------------------------------------------------------------------------

create or replace function public.create_room(p_display_name text, p_team_id uuid default null, p_max_players int default 4)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_code text;
  v_player_id uuid;
  v_team_id uuid;
begin
  -- Preserve the online-age gate added in 20260928060000_online_age_check.sql;
  -- this redefinition only widens the seat count.
  perform private.require_online_eligibility();
  if (select auth.uid()) is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  if p_max_players not in (2, 3, 4, 5, 6) then
    raise exception 'INVALID_PLAYER_COUNT';
  end if;

  if p_team_id is not null then
    select t.id into v_team_id
    from public.teams t
    join public.team_members tm on tm.team_id = t.id
    where t.id = p_team_id and tm.user_id = (select auth.uid());
    if v_team_id is null then
      raise exception 'NOT_TEAM_MEMBER';
    end if;
  end if;

  v_code := private.ludo_generate_room_code();

  insert into public.rooms (code, status, team_id, max_players)
  values (v_code, 'lobby', v_team_id, p_max_players)
  returning id into v_room_id;

  insert into public.players (room_id, seat_index, user_id, display_name, color, status, is_bot)
  values (v_room_id, 0, (select auth.uid()), p_display_name, private.ludo_color_for_seat(0), 'connected', false)
  returning id into v_player_id;

  update public.rooms set host_player_id = v_player_id where id = v_room_id;

  perform private.ludo_broadcast_state(v_room_id);

  return jsonb_build_object('roomId', v_room_id, 'code', v_code, 'playerId', v_player_id);
end;
$$;
revoke execute on function public.create_room(text, uuid, int) from public;
grant execute on function public.create_room(text, uuid, int) to authenticated;
revoke execute on function public.create_room(text, uuid, int) from anon;

create or replace function public.set_room_max_players(p_room_id uuid, p_max_players int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_room public.rooms; v_caller uuid; v_seated int;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  v_caller := private.ludo_caller_player_id(p_room_id);
  if v_caller is null or v_caller <> v_room.host_player_id then raise exception 'NOT_HOST'; end if;
  if v_room.status <> 'lobby' then raise exception 'ALREADY_STARTED'; end if;
  if p_max_players not in (2, 3, 4, 5, 6) then raise exception 'INVALID_PLAYER_COUNT'; end if;
  select count(*) into v_seated from public.players where room_id = p_room_id;
  if p_max_players < v_seated then raise exception 'TOO_MANY_SEATED'; end if;
  if v_room.max_players <> p_max_players then
    update public.rooms set max_players = p_max_players where id = p_room_id;
    perform private.ludo_broadcast_state(p_room_id);
  end if;
  return private.ludo_room_state_json(p_room_id);
end;
$$;
revoke execute on function public.set_room_max_players(uuid, int) from public;
grant execute on function public.set_room_max_players(uuid, int) to authenticated;

create or replace function public.set_player_color(p_room_id uuid, p_color text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_room public.rooms; v_player_id uuid; v_seat_index int;
begin
  if p_color not in ('red', 'green', 'yellow', 'blue', 'orange', 'black') then raise exception 'INVALID_COLOR'; end if;
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if v_room.status <> 'lobby' then raise exception 'ALREADY_STARTED'; end if;
  v_player_id := private.ludo_caller_player_id(p_room_id);
  if v_player_id is null then raise exception 'UNAUTHENTICATED'; end if;
  v_seat_index := case p_color when 'red' then 0 when 'green' then 1
    when 'yellow' then 2 when 'blue' then 3 when 'orange' then 4 when 'black' then 5 end;
  if not private.ludo_valid_seat(p_room_id, v_seat_index, v_player_id) then raise exception 'INVALID_SEAT'; end if;
  if exists (
    select 1 from public.players
    where room_id = p_room_id and color = p_color and id <> v_player_id
  ) then raise exception 'COLOR_TAKEN'; end if;
  update public.players set color = p_color, seat_index = v_seat_index
    where id = v_player_id;
  perform private.ludo_broadcast_state(p_room_id);
  return private.ludo_room_state_json(p_room_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Snakes & Ladders stays 2-4 players: its board, seat labels and finish rows
-- are laid out for four. Enforced on the table, like Team Up's room check
-- (20260929010200_team_up_moves.sql), so every path that sets a room's game
-- or size — lobby, party, matchmaking — is covered by one rule.
-- ---------------------------------------------------------------------------

create or replace function private.ludo_validate_board_size()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.game_type = 'snakes_and_ladders' and new.max_players > 4 then
    raise exception 'SNAKES_MAX_FOUR_PLAYERS';
  end if;
  return new;
end;
$$;
revoke execute on function private.ludo_validate_board_size() from public;

create trigger validate_board_size before insert or update of game_type, max_players
on public.rooms for each row execute function private.ludo_validate_board_size();
