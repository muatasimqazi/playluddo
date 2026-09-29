-- Every mutation path (including generic rule, board and seat-count RPCs)
-- passes this room constraint.  A started team match has exactly four seats
-- and sixteen pawns, so its two sides always have eight pawns each.
create or replace function private.ludo_validate_team_room()
returns trigger language plpgsql set search_path = '' as $$
declare v_rules jsonb;
begin
  v_rules := private.ludo_resolve_rules(new.rules);
  if coalesce((v_rules->>'teamUp')::boolean, false) then
    if new.game_type <> 'ludo' or new.max_players <> 4 then
      raise exception 'TEAM_UP_REQUIRES_FOUR_PLAYER_LUDO';
    end if;
    if (v_rules->>'startOnBoard')::int <> 0 or (v_rules->>'pawnsToWin')::int <> 4
      or (v_rules->>'captureToEnterHome')::boolean or (v_rules->>'blockades')::boolean
      or (v_rules->>'matchMinutes')::int <> 0 or not (v_rules->>'bonusRollOnFinish')::boolean
      or (v_rules->>'turnSeconds')::int not in (15, 30) then
      raise exception 'TEAM_UP_INCOMPATIBLE_RULES';
    end if;
    if new.status = 'in_game' and old.status = 'lobby' and (
      (select count(*) from public.players where room_id = new.id) <> 4
      or (select count(*) from public.pawns where room_id = new.id) <> 16
    ) then raise exception 'TEAM_UP_REQUIRES_EIGHT_PAWNS_PER_SIDE'; end if;
  end if;
  return new;
end;
$$;
revoke execute on function private.ludo_validate_team_room() from public;
create trigger validate_team_room before update of rules, game_type, max_players, status
on public.rooms for each row execute function private.ludo_validate_team_room();

-- The five-argument function remains the sole legality source for roll,
-- timeout/bot, snapshot and move validation.  Team Up uses the pawn's own
-- color for geometry, and lets a finished seat control only its partner.
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
        and v_from <= 50 and v_to > 50 then v_to := 50; end if;
      if v_to > 56 or v_to = v_from then continue; end if;
      if (v_rules->>'blockades')::boolean
        and private.ludo_blocked_between(p_pawns,v_color,v_from,v_to) then continue; end if;
    end if;
    v_captures := '[]'::jsonb;
    if v_to <= 50 then
      v_cell := private.ludo_path_index_to_global_cell(v_color,v_to);
      if not private.ludo_is_safe_cell(v_cell) then
        select coalesce(jsonb_agg(other->>'id'), '[]'::jsonb) into v_captures
        from jsonb_array_elements(p_pawns) other
        where not (other->>'color' = any(v_allies)) and other->>'state' = 'track'
          and private.ludo_path_index_to_global_cell(other->>'color',(other->>'pathIndex')::int) = v_cell;
      end if;
    end if;
    v_moves := v_moves || jsonb_build_object(
      'pawnId',v_pawn->>'id',
      'fromTileId',private.ludo_path_index_to_tile_id(v_color,v_from),
      'toTileId',private.ludo_path_index_to_tile_id(v_color,v_to),
      'capturesPawnIds',v_captures,'finishesPawn',v_to = 56
    );
  end loop;
  return v_moves;
end;
$$;
revoke execute on function private.ludo_legal_moves(jsonb,text,integer,jsonb,boolean) from public;
