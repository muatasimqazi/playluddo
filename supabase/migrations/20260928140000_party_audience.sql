-- Party Mode's audience (docs/COMPETITIVE_ROADMAP.md Section 6, P6): once
-- the seats are full or the game has started, more phones can join a party
-- room as audience. They send reactions to the screen, predict the winner
-- before the start, and vote for the moment of the match at the end. The
-- audience never affects the rules or the dice.
--
-- A role of its own, separate from the screen (R4): audience phones are
-- 13+ like players (decided, question 15), while the screen is exempt and
-- can only watch. Predictions are bragging rights only: no stakes, no
-- rewards of value.

create table public.party_audience (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 24),
  -- The lobby's pick for the next game; locked into party_predictions at the start.
  predicted_player_id uuid references public.players(id) on delete set null,
  -- One reaction, prediction or vote a second.
  last_action_at timestamptz not null default '-infinity',
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
alter table public.party_audience enable row level security;
revoke all on public.party_audience from anon, authenticated;

create table public.party_predictions (
  match_id uuid not null references public.matches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  display_name text not null,
  primary key (match_id, user_id)
);
alter table public.party_predictions enable row level security;
revoke all on public.party_predictions from anon, authenticated;

create table public.party_votes (
  match_id uuid not null references public.matches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  sequence bigint not null,
  primary key (match_id, user_id)
);
alter table public.party_votes enable row level security;
revoke all on public.party_votes from anon, authenticated;

create or replace function private.party_is_audience(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.party_audience
    where room_id = p_room_id and user_id = (select auth.uid())
  );
$$;
revoke execute on function private.party_is_audience(uuid) from public;
grant execute on function private.party_is_audience(uuid) to authenticated;

-- Beside the seated-player and screen policies: audience phones receive
-- their room's broadcasts. Party rooms carry no chat or call signalling.
create policy "party audience can receive their room's broadcasts"
on realtime.messages for select to authenticated
using (
  extension = 'broadcast'
  and private.ludo_room_id_from_topic((select realtime.topic())) is not null
  and (select private.party_is_audience(private.ludo_room_id_from_topic((select realtime.topic()))))
);

-- Tells the screen and phones to fetch get_party_extras again.
create or replace function private.party_extras_changed(p_room_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  select realtime.send('{}'::jsonb, 'party_extras', 'room:' || p_room_id::text, true);
$$;
revoke execute on function private.party_extras_changed(uuid) from public;

-- Locks the caller's audience row and applies the one-a-second limit.
create or replace function private.party_audience_action(p_room_id uuid)
returns public.party_audience
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.party_audience;
begin
  if (select auth.uid()) is null then raise exception 'UNAUTHENTICATED'; end if;
  select * into v_member from public.party_audience
  where room_id = p_room_id and user_id = (select auth.uid()) for update;
  if not found then raise exception 'NOT_AUDIENCE'; end if;
  if v_member.last_action_at > now() - interval '1 second' then
    raise exception 'Please wait a moment before sending another.';
  end if;
  update public.party_audience set last_action_at = now()
  where room_id = p_room_id and user_id = v_member.user_id;
  return v_member;
end;
$$;
revoke execute on function private.party_audience_action(uuid) from public;

-- Join a party room's audience. Only once the seats are full or the game
-- has started; otherwise take a seat.
create or replace function public.join_party_audience(p_room_id uuid, p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_name text := btrim(coalesce(p_display_name, ''));
begin
  perform private.require_online_eligibility();
  if (select auth.uid()) is null then raise exception 'UNAUTHENTICATED'; end if;
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found or v_room.status = 'abandoned' then raise exception 'ROOM_NOT_FOUND'; end if;
  if not v_room.is_party then raise exception 'NOT_PARTY_ROOM'; end if;
  if exists (select 1 from public.room_displays where room_id = p_room_id and user_id = (select auth.uid())) then
    raise exception 'DISPLAY_CANNOT_SIT';
  end if;
  if exists (select 1 from public.players where room_id = p_room_id and user_id = (select auth.uid())) then
    raise exception 'ALREADY_SEATED';
  end if;
  if v_room.status = 'lobby'
    and (select count(*) from public.players where room_id = p_room_id) < v_room.max_players then
    raise exception 'SEATS_OPEN';
  end if;
  if char_length(v_name) not between 1 and 24 then raise exception 'INVALID_NAME'; end if;
  if not exists (select 1 from public.party_audience where room_id = p_room_id and user_id = (select auth.uid()))
    and (select count(*) from public.party_audience where room_id = p_room_id) >= 30 then
    raise exception 'AUDIENCE_FULL';
  end if;
  insert into public.party_audience (room_id, user_id, display_name)
  values (p_room_id, (select auth.uid()), v_name)
  on conflict (room_id, user_id) do update set display_name = excluded.display_name;
  perform private.party_extras_changed(p_room_id);
  return jsonb_build_object('roomId', p_room_id);
end;
$$;
revoke execute on function public.join_party_audience(uuid, text) from public;
grant execute on function public.join_party_audience(uuid, text) to authenticated;

-- The table as an audience phone sees it: the same public view as the screen.
create or replace function public.get_audience_state(p_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.party_is_audience(p_room_id) then raise exception 'NOT_AUDIENCE'; end if;
  return private.ludo_room_state_json(p_room_id);
end;
$$;
revoke execute on function public.get_audience_state(uuid) from public;
grant execute on function public.get_audience_state(uuid) to authenticated;

-- A reaction from the audience, shown on the screen with the sender's
-- name. Nothing is stored.
create or replace function public.audience_react(p_room_id uuid, p_text text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.party_audience;
begin
  if p_text is null or not (p_text = any(private.allowed_reactions())) then raise exception 'INVALID_MESSAGE'; end if;
  v_member := private.party_audience_action(p_room_id);
  perform realtime.send(
    jsonb_build_object('id', gen_random_uuid(), 'name', v_member.display_name, 'text', p_text),
    'audience_reaction',
    'room:' || p_room_id::text,
    true
  );
end;
$$;
revoke execute on function public.audience_react(uuid, text) from public;
grant execute on function public.audience_react(uuid, text) to authenticated;

-- Pick a winner before the game starts. Bragging rights only.
create or replace function public.predict_winner(p_room_id uuid, p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.party_audience;
begin
  v_member := private.party_audience_action(p_room_id);
  if (select status from public.rooms where id = p_room_id) <> 'lobby' then raise exception 'INVALID_PHASE'; end if;
  if not exists (select 1 from public.players where id = p_player_id and room_id = p_room_id) then
    raise exception 'PLAYER_NOT_FOUND';
  end if;
  update public.party_audience set predicted_player_id = p_player_id
  where room_id = p_room_id and user_id = v_member.user_id;
  perform private.party_extras_changed(p_room_id);
end;
$$;
revoke execute on function public.predict_winner(uuid, uuid) from public;
grant execute on function public.predict_winner(uuid, uuid) to authenticated;

-- A new match locks in the lobby's predictions and clears them for next time.
create or replace function private.party_lock_predictions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.party_predictions (match_id, user_id, player_id, display_name)
  select new.current_match_id, a.user_id, a.predicted_player_id, a.display_name
  from public.party_audience a
  where a.room_id = new.id and a.predicted_player_id is not null
  on conflict do nothing;
  update public.party_audience set predicted_player_id = null where room_id = new.id;
  return null;
end;
$$;
revoke execute on function private.party_lock_predictions() from public;

create trigger party_lock_predictions
after update of current_match_id on public.rooms
for each row
when (new.is_party and new.current_match_id is not null and new.current_match_id is distinct from old.current_match_id)
execute function private.party_lock_predictions();

-- The match's candidates for moment of the match: captures, players
-- finishing, and (Snakes & Ladders) long ladders and snakes. The last 8.
create or replace function private.party_moments(p_match_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(m.moment order by m.sequence), '[]'::jsonb)
  from (
    select * from (
      select e.sequence, jsonb_build_object(
        'sequence', e.sequence,
        'playerId', e.player_id,
        'kind', case
          when e.event_type = 'player_finished' then 'finished'
          when jsonb_array_length(coalesce(e.payload->'capturesPawnIds', '[]'::jsonb)) > 0 then 'capture'
          when split_part(e.payload->>'toTileId', ':', 2)::int > (e.payload->>'landingSquare')::int then 'ladder'
          else 'snake' end,
        'place', (e.payload->>'place')::int,
        'capturedPlayerIds', (
          select coalesce(jsonb_agg(distinct pw.player_id), '[]'::jsonb) from public.pawns pw
          where pw.id::text in (select jsonb_array_elements_text(coalesce(e.payload->'capturesPawnIds', '[]'::jsonb)))
        ),
        'from', (e.payload->>'landingSquare')::int,
        'to', case when e.payload->>'toTileId' like 'snakes:%' then split_part(e.payload->>'toTileId', ':', 2)::int end
      ) as moment
      from public.match_events e
      where e.match_id = p_match_id
        and (
          e.event_type = 'player_finished'
          or (e.event_type = 'legal_move_selected' and (
            jsonb_array_length(coalesce(e.payload->'capturesPawnIds', '[]'::jsonb)) > 0
            -- CASE, not AND: only a Snakes tile id is safe to read as a number.
            or case when e.payload->>'toTileId' like 'snakes:%' and e.payload ? 'landingSquare'
                then abs(split_part(e.payload->>'toTileId', ':', 2)::int - (e.payload->>'landingSquare')::int) >= 10
                else false end
          ))
        )
      order by e.sequence desc
      limit 8
    ) latest
  ) m;
$$;
revoke execute on function private.party_moments(uuid) from public;

-- Vote for the moment of the match, once the game has ended and until the
-- next one starts. A vote can be changed.
create or replace function public.vote_moment(p_room_id uuid, p_sequence bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.party_audience;
  v_room public.rooms;
begin
  v_member := private.party_audience_action(p_room_id);
  select * into v_room from public.rooms where id = p_room_id;
  if v_room.status <> 'summary' or v_room.current_match_id is null then raise exception 'INVALID_PHASE'; end if;
  if not exists (
    select 1 from jsonb_array_elements(private.party_moments(v_room.current_match_id)) m
    where (m->>'sequence')::bigint = p_sequence
  ) then
    raise exception 'MOMENT_NOT_FOUND';
  end if;
  insert into public.party_votes (match_id, user_id, sequence)
  values (v_room.current_match_id, v_member.user_id, p_sequence)
  on conflict (match_id, user_id) do update set sequence = excluded.sequence;
  perform private.party_extras_changed(p_room_id);
end;
$$;
revoke execute on function public.vote_moment(uuid, bigint) from public;
grant execute on function public.vote_moment(uuid, bigint) to authenticated;

-- Everything the audience adds, for the screen, audience phones and
-- seated players: who's watching, the lobby's picks, and once the game
-- has ended, who called it and the moment votes. Names only, no ids for
-- audience members.
create or replace function public.get_party_extras(p_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
    'myVote', (select sequence from public.party_votes where match_id = v_room.current_match_id and user_id = v_uid)
  );
end;
$$;
revoke execute on function public.get_party_extras(uuid) from public;
grant execute on function public.get_party_extras(uuid) to authenticated;

-- Redefines 20260928090000_party_screen.sql's version: an audience phone
-- that takes a seat (one opened up in the lobby) leaves the audience.
create or replace function private.party_seat_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is not null and exists (
    select 1 from public.room_displays where room_id = new.room_id and user_id = new.user_id
  ) then
    raise exception 'DISPLAY_CANNOT_SIT';
  end if;
  if new.user_id is not null then
    delete from public.party_audience where room_id = new.room_id and user_id = new.user_id;
  end if;
  return new;
end;
$$;

-- Redefines 20260927050000_join_by_link.sql's version: a shared party link
-- also says whether it's a party room and whether this phone is in its
-- audience, so the page can offer the audience once the seats are full.
create or replace function public.room_invite(p_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_room public.rooms;
begin
  if (select auth.uid()) is null then raise exception 'UNAUTHENTICATED'; end if;
  select * into v_room from public.rooms where id = p_room_id;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  return jsonb_build_object(
    'status', v_room.status,
    'gameType', v_room.game_type,
    'maxPlayers', v_room.max_players,
    'seatsTaken', (select count(*) from public.players where room_id = p_room_id),
    'hostName', (select display_name from public.players where id = v_room.host_player_id),
    'isSeated', exists (select 1 from public.players where room_id = p_room_id and user_id = (select auth.uid())),
    'isParty', v_room.is_party,
    'isAudience', private.party_is_audience(p_room_id)
  );
end;
$$;
