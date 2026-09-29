-- The between-game round (docs/COMPETITIVE_ROADMAP.md P8): while the TV
-- shows the podium, everyone's phone gets one question about the game that
-- just finished, with a minute to answer. Closest wins the bragging rights.
-- Purely social: no stakes, and nothing of value is awarded.
--
-- The question is asked about a match that has already ended, so the answer
-- is settled before anyone guesses and no one can play to it.

create table public.party_rounds (
  match_id uuid primary key references public.matches(id) on delete cascade,
  question text not null,
  answer integer not null,
  opened_at timestamptz not null default now()
);
alter table public.party_rounds enable row level security;
revoke all on public.party_rounds from anon, authenticated;

create table public.party_guesses (
  match_id uuid not null references public.party_rounds(match_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  guess integer not null check (guess between 0 and 999),
  primary key (match_id, user_id)
);
alter table public.party_guesses enable row level security;
revoke all on public.party_guesses from anon, authenticated;

/** How long a round stays open. */
create or replace function private.party_round_seconds()
returns integer language sql immutable set search_path = '' as $$ select 60 $$;
revoke execute on function private.party_round_seconds() from public;

-- One question about the finished match, chosen from the match id so it is
-- the same every time this match is asked about. Every answer is a total
-- across the table, derived from the same events the summary already uses.
create or replace function private.party_round_question(p_match_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_stats jsonb := private.match_stats(p_match_id);
  v_snakes boolean := (select game_type = 'snakes_and_ladders' from public.matches where id = p_match_id);
  v_totals jsonb;
  v_choices jsonb;
begin
  select jsonb_build_object(
    'sixes', coalesce(sum((s.value->>'sixes')::int), 0),
    'turns', coalesce(sum((s.value->>'turns')::int), 0),
    'rolls', coalesce(sum((s.value->>'rolls')::int), 0),
    'captures', coalesce(sum((s.value->>'capturesMade')::int), 0)
  ) into v_totals
  from jsonb_each(v_stats) s;

  v_choices := jsonb_build_array(
    jsonb_build_object('question', 'How many sixes did everyone roll altogether?', 'answer', v_totals->'sixes'),
    jsonb_build_object('question', 'How many turns did that game take?', 'answer', v_totals->'turns'),
    jsonb_build_object('question', 'How many times was the die rolled?', 'answer', v_totals->'rolls')
  );
  if not v_snakes then
    v_choices := v_choices || jsonb_build_array(
      jsonb_build_object('question', 'How many pieces were captured?', 'answer', v_totals->'captures')
    );
  end if;
  return v_choices -> (abs(hashtext(p_match_id::text)) % jsonb_array_length(v_choices));
end;
$$;
revoke execute on function private.party_round_question(uuid) from public;

-- Opened by the screen, as the podium goes up. A management action, like
-- locking the room (R4).
create or replace function public.open_party_round(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_pick jsonb;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found or not v_room.is_party or not private.ludo_is_display_of_room(p_room_id) then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  if v_room.status <> 'summary' or v_room.current_match_id is null then raise exception 'INVALID_PHASE'; end if;
  if exists (select 1 from public.party_rounds where match_id = v_room.current_match_id) then return; end if;
  v_pick := private.party_round_question(v_room.current_match_id);
  insert into public.party_rounds (match_id, question, answer)
  values (v_room.current_match_id, v_pick->>'question', (v_pick->>'answer')::int)
  on conflict (match_id) do nothing;
  perform private.party_extras_changed(p_room_id);
end;
$$;
revoke execute on function public.open_party_round(uuid) from public;
grant execute on function public.open_party_round(uuid) to authenticated;

-- A guess from anyone at the table: a player or someone in the audience.
-- It can be changed until the minute is up.
create or replace function public.guess_party_round(p_room_id uuid, p_guess integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_name text;
  v_opened timestamptz;
begin
  if (select auth.uid()) is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_guess is null or p_guess < 0 or p_guess > 999 then raise exception 'INVALID_GUESS'; end if;
  select * into v_room from public.rooms where id = p_room_id;
  if not found or not v_room.is_party then raise exception 'ROOM_NOT_FOUND'; end if;
  select display_name into v_name from public.players
  where room_id = p_room_id and user_id = (select auth.uid()) and not is_bot;
  if v_name is null then
    select display_name into v_name from public.party_audience
    where room_id = p_room_id and user_id = (select auth.uid());
  end if;
  if v_name is null then raise exception 'ROOM_NOT_FOUND'; end if;
  select opened_at into v_opened from public.party_rounds where match_id = v_room.current_match_id;
  if v_opened is null then raise exception 'NO_ROUND'; end if;
  if now() > v_opened + make_interval(secs => private.party_round_seconds()) then raise exception 'ROUND_CLOSED'; end if;
  insert into public.party_guesses (match_id, user_id, display_name, guess)
  values (v_room.current_match_id, (select auth.uid()), v_name, p_guess)
  on conflict (match_id, user_id) do update set guess = excluded.guess, display_name = excluded.display_name;
  perform private.party_extras_changed(p_room_id);
end;
$$;
revoke execute on function public.guess_party_round(uuid, integer) from public;
grant execute on function public.guess_party_round(uuid, integer) to authenticated;

-- The round as everyone at the table sees it. The answer and the guesses
-- stay hidden until the minute is up, so nobody can follow the leader.
create or replace function private.party_round_json(p_match_id uuid, p_uid uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_round public.party_rounds;
  v_closed boolean;
begin
  select * into v_round from public.party_rounds where match_id = p_match_id;
  if not found then return null; end if;
  v_closed := now() > v_round.opened_at + make_interval(secs => private.party_round_seconds());
  return jsonb_build_object(
    'question', v_round.question,
    'closesAt', v_round.opened_at + make_interval(secs => private.party_round_seconds()),
    'closed', v_closed,
    'guessCount', (select count(*) from public.party_guesses where match_id = p_match_id),
    'myGuess', (select guess from public.party_guesses where match_id = p_match_id and user_id = p_uid),
    'answer', case when v_closed then v_round.answer end,
    -- Everyone who came closest, and by how much.
    'closest', case when v_closed then coalesce((
      select jsonb_agg(jsonb_build_object('name', display_name, 'guess', guess) order by display_name)
      from public.party_guesses g
      where g.match_id = p_match_id
        and abs(g.guess - v_round.answer) = (
          select min(abs(g2.guess - v_round.answer)) from public.party_guesses g2 where g2.match_id = p_match_id
        )
    ), '[]'::jsonb) end
  );
end;
$$;
revoke execute on function private.party_round_json(uuid, uuid) from public;

-- Redefines 20260928150000_party_defaults.sql's version: adds the round.
CREATE OR REPLACE FUNCTION public.get_party_extras(p_room_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_room public.rooms;
  v_uid uuid := (select auth.uid());
  v_ended boolean;
begin
  select * into v_room from public.rooms where id = p_room_id;
  if not found or not v_room.is_party
    or not (private.ludo_is_display_of_room(p_room_id) or private.party_is_audience(p_room_id)
            or private.ludo_is_seated_in_room(p_room_id)) then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  v_ended := v_room.status = 'summary' and v_room.current_match_id is not null;
  return jsonb_build_object(
    'isAudience', private.party_is_audience(p_room_id),
    'audienceTopic', (select 'audience:' || id::text from public.party_audience where room_id = p_room_id and user_id = v_uid),
    'audienceMembers', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', display_name, 'isMe', user_id = v_uid) order by joined_at) from public.party_audience where room_id = p_room_id), '[]'::jsonb),
    'audience', coalesce((select jsonb_agg(display_name order by joined_at) from public.party_audience where room_id = p_room_id), '[]'::jsonb),
    'predictions', coalesce((
      select jsonb_agg(jsonb_build_object('playerId', predicted_player_id, 'count', n))
      from (select predicted_player_id, count(*) n from public.party_audience
            where room_id = p_room_id and predicted_player_id is not null group by predicted_player_id) t
    ), '[]'::jsonb),
    'myPrediction', (select predicted_player_id from public.party_audience where room_id = p_room_id and user_id = v_uid),
    'lockedPrediction', (select player_id from public.party_predictions where match_id = v_room.current_match_id and user_id = v_uid),
    'calledIt', case when v_ended and cardinality(v_room.winner_ids) > 0 then coalesce((
      select jsonb_agg(display_name order by display_name) from public.party_predictions
      where match_id = v_room.current_match_id and player_id = v_room.winner_ids[1]
    ), '[]'::jsonb) end,
    'predictionCount', (select count(*) from public.party_predictions where match_id = v_room.current_match_id),
    'moments', case when v_ended then private.party_moments(v_room.current_match_id) else '[]'::jsonb end,
    'votes', case when v_ended then coalesce((
      select jsonb_agg(jsonb_build_object('sequence', sequence, 'count', n))
      from (select sequence, count(*) n from public.party_votes where match_id = v_room.current_match_id group by sequence) t
    ), '[]'::jsonb) else '[]'::jsonb end,
    'myVote', (select sequence from public.party_votes where match_id = v_room.current_match_id and user_id = v_uid),
    'round', case when v_room.current_match_id is not null then private.party_round_json(v_room.current_match_id, v_uid) end
  );
end;
$function$;
