-- Keep the server rules aligned with the custom SVG board artwork.
create or replace function private.snakes_move(p_pawns jsonb, p_color text, p_die int)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_pawn jsonb; v_landing int; v_destination int;
begin
  if p_die is null or p_die not between 1 and 6 then return null; end if;
  select p into v_pawn from jsonb_array_elements(p_pawns) p
    where p->>'color' = p_color and p->>'state' <> 'finished' limit 1;
  if v_pawn is null then return null; end if;
  v_landing := coalesce((v_pawn->>'pathIndex')::int, 0) + p_die;
  if v_landing > 100 then return null; end if;
  v_destination := case v_landing
    when 4 then 16 when 9 then 30 when 18 then 44 when 28 then 54 when 50 then 73 when 71 then 91
    when 14 then 6 when 59 then 40 when 87 then 45 when 93 then 72 when 95 then 75 when 98 then 38
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
