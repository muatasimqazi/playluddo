-- Team Up (F2.5): opposite seats form persistent sides.  The generated
-- value makes the seat layout authoritative: red/yellow are side 0 and
-- green/blue are side 1, even for bot-filled and reconnected seats.

alter table public.players
  add column side smallint generated always as (seat_index % 2) stored;

create or replace function private.ludo_default_rules()
returns jsonb language sql immutable set search_path = '' as $$
  select '{"bonusRollOnFinish": true, "startOnBoard": 0, "pawnsToWin": 4,
           "captureToEnterHome": false, "snakesAnyRollToStart": false,
           "snakesBounceBack": false, "matchMinutes": 0, "blockades": false,
           "turnSeconds": 15, "teamUp": false}'::jsonb;
$$;

-- A Team Up side wins only when every pawn belonging to both partner colors
-- is finished.  This deliberately ignores pawnsToWin: Team Up is always 8.
create or replace function private.ludo_team_up_won(p_pawns jsonb, p_color text)
returns boolean language sql immutable set search_path = '' as $$
  select count(*) = 8 and bool_and(pawn->>'state' = 'finished')
  from jsonb_array_elements(p_pawns) pawn
  where pawn->>'color' = any(case when p_color in ('red', 'yellow')
    then array['red', 'yellow'] else array['green', 'blue'] end);
$$;
revoke execute on function private.ludo_team_up_won(jsonb, text) from public;
