-- Team Up is intentionally its own RPC rather than a permissive house-rule
-- toggle: the server admits only the one ruleset whose all-eight semantics
-- are covered by the Team Up engine and fixtures.
create or replace function public.set_team_up(p_room_id uuid, p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_room public.rooms; v_caller uuid; v_rules jsonb;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  v_caller := private.ludo_caller_player_id(p_room_id);
  if v_caller is null or v_caller <> v_room.host_player_id then raise exception 'NOT_HOST'; end if;
  if v_room.status <> 'lobby' then raise exception 'ALREADY_STARTED'; end if;
  if p_enabled and (v_room.game_type <> 'ludo' or v_room.max_players <> 4) then
    raise exception 'TEAM_UP_REQUIRES_FOUR_PLAYER_LUDO';
  end if;
  v_rules := private.ludo_resolve_rules(v_room.rules) || jsonb_build_object('teamUp', p_enabled);
  if p_enabled and (
    (v_rules->>'startOnBoard')::int <> 0
    or (v_rules->>'pawnsToWin')::int <> 4
    or (v_rules->>'captureToEnterHome')::boolean
    or (v_rules->>'blockades')::boolean
    or (v_rules->>'matchMinutes')::int <> 0
    or not (v_rules->>'bonusRollOnFinish')::boolean
    or (v_rules->>'turnSeconds')::int not in (15, 30)
  ) then
    raise exception 'TEAM_UP_INCOMPATIBLE_RULES';
  end if;
  update public.rooms set rules = v_rules where id = p_room_id;
  perform private.ludo_append_event(p_room_id, 'rules_changed', v_caller, jsonb_build_object('rules', v_rules));
  perform private.ludo_broadcast_state(p_room_id);
  return private.ludo_room_state_json(p_room_id);
end;
$$;
revoke execute on function public.set_team_up(uuid, boolean) from public;
grant execute on function public.set_team_up(uuid, boolean) to authenticated;
