-- Quick match: a player asks for a game against anyone online, for the game
-- and table size (2-4 seats) they picked. As soon as enough other searchers
-- for the same game and size are found, they're all seated together. If the
-- table hasn't filled after 45 seconds, it starts with whoever has turned up
-- and computer players take the empty seats.
--
-- The client polls public.matchmake() every ~2s while it waits. Every
-- decision (grouping, the 45s fallback) is made server-side under row
-- locks: each call locks the caller's own queue row, and claims other
-- searchers' rows with FOR UPDATE SKIP LOCKED, so two players polling at the
-- same instant can never both claim each other, and nobody is seated at two
-- tables.
--
-- Leaving mid-game needs nothing new here: the existing turn-timer sweep
-- (20260913225951_m3_timers_bots_reconnect.sql) plays a missed turn, and
-- hands the seat to a computer after 3 misses or 45s away — which also
-- covers a matched player who never opens the table. They can reclaim it.

create table public.matchmaking_queue (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  game_type text not null check (game_type in ('ludo', 'snakes_and_ladders')),
  player_count int not null check (player_count between 2 and 4),
  enqueued_at timestamptz not null default now(),
  -- Bumped on every poll; a player who stopped polling (closed the tab)
  -- stops being offered a seat.
  last_seen_at timestamptz not null default now(),
  -- Set when someone else seated this player at a table; their next poll
  -- picks it up and clears the row.
  room_id uuid references public.rooms(id) on delete set null
);
create index matchmaking_queue_waiting_idx
  on public.matchmaking_queue (game_type, player_count, enqueued_at)
  where room_id is null;

-- Only the security definer RPCs below touch the queue.
alter table public.matchmaking_queue enable row level security;

-- Creates a started room for p_player_count seats hosted by the caller
-- (seat 0), seats the given queued humans, and lets computers take every
-- other seat. Reuses the public room RPCs — which all check the caller is
-- the host — so seating, pawns and turn setup stay in one place.
--   2 seats: the opponent (human or computer) goes in the diagonal seat 2,
--            the same pairing a private 2-player room uses.
--   3-4:     humans fill seats 1.., and start_match bot-fills the rest.
-- Computers get friendly names instead of start_match's "Bot N".
create or replace function private.matchmaking_start_room(
  p_display_name text,
  p_game_type text,
  p_player_count int,
  p_user_ids uuid[],
  p_names text[]
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_room_id uuid;
  v_humans int := coalesce(array_length(p_user_ids, 1), 0);
  v_bot_names text[] := array['Rowan', 'Sage', 'Jules', 'Avery', 'Kai', 'Maya', 'Theo', 'Nia'];
  v_bot record;
  i int;
begin
  v_room_id := (public.create_room(p_display_name, null, p_player_count) ->> 'roomId')::uuid;
  update public.rooms set game_type = p_game_type where id = v_room_id;

  if p_player_count = 2 then
    if v_humans = 0 then
      perform public.fill_bot(v_room_id, 2);
    else
      insert into public.players (room_id, seat_index, user_id, display_name, color, status, is_bot)
      values (v_room_id, 2, p_user_ids[1], p_names[1], private.ludo_color_for_seat(2), 'connected', false);
    end if;
  else
    for i in 1..v_humans loop
      insert into public.players (room_id, seat_index, user_id, display_name, color, status, is_bot)
      values (v_room_id, i, p_user_ids[i], p_names[i], private.ludo_color_for_seat(i), 'connected', false);
    end loop;
  end if;

  perform public.start_match(v_room_id);

  -- Distinct friendly names for the computers, in a random order.
  for v_bot in
    select p.id, row_number() over (order by p.seat_index) as n
    from public.players p where p.room_id = v_room_id and p.is_bot
  loop
    update public.players set display_name = (
      select name from unnest(v_bot_names) with ordinality as t(name, ord)
      order by md5(v_room_id::text || ord::text) offset v_bot.n - 1 limit 1
    ) where id = v_bot.id;
  end loop;
  perform private.ludo_broadcast_state(v_room_id);

  return v_room_id;
end;
$$;
revoke execute on function private.matchmaking_start_room(text, text, int, uuid[], text[]) from public;

-- The "matched" reply: the room, plus how many of its seats are computers
-- so the waiting screen can say who the player is up against.
create or replace function private.matchmaking_matched(p_room_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'status', 'matched',
    'roomId', p_room_id,
    'players', (select count(*) from public.players where room_id = p_room_id),
    'computers', (select count(*) from public.players where room_id = p_room_id and is_bot)
  );
$$;
revoke execute on function private.matchmaking_matched(uuid) from public;

create or replace function public.matchmake(
  p_game_type text,
  p_display_name text,
  p_player_count int default 2
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text := coalesce(nullif(btrim(p_display_name), ''), 'Player');
  v_me public.matchmaking_queue;
  v_found_ids uuid[];
  v_found_names text[];
  v_found int;
  v_room_id uuid;
  v_waited numeric;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_game_type is null or p_game_type not in ('ludo', 'snakes_and_ladders') then
    raise exception 'INVALID_GAME_TYPE';
  end if;
  if p_player_count is null or p_player_count not between 2 and 4 then
    raise exception 'INVALID_PLAYER_COUNT';
  end if;

  select * into v_me from public.matchmaking_queue where user_id = v_uid for update;

  -- Someone else already seated us: hand over the room and leave the queue.
  if found and v_me.room_id is not null then
    delete from public.matchmaking_queue where user_id = v_uid;
    return private.matchmaking_matched(v_me.room_id);
  end if;

  -- First poll, or switched game/table size: (re)start the wait.
  if not found or v_me.game_type <> p_game_type or v_me.player_count <> p_player_count then
    insert into public.matchmaking_queue (user_id, display_name, game_type, player_count)
    values (v_uid, v_name, p_game_type, p_player_count)
    on conflict (user_id) do update
      set display_name = excluded.display_name, game_type = excluded.game_type,
          player_count = excluded.player_count,
          enqueued_at = now(), last_seen_at = now(), room_id = null
    returning * into v_me;
  else
    update public.matchmaking_queue set last_seen_at = now(), display_name = v_name
      where user_id = v_uid returning * into v_me;
  end if;

  -- Claim up to (seats - 1) other searchers for the same game and table
  -- size who are still polling, longest-waiting first.
  select coalesce(array_agg(q.user_id order by q.enqueued_at), '{}'),
         coalesce(array_agg(q.display_name order by q.enqueued_at), '{}')
    into v_found_ids, v_found_names
  from (
    select user_id, display_name, enqueued_at from public.matchmaking_queue
    where user_id <> v_uid
      and game_type = p_game_type
      and player_count = p_player_count
      and room_id is null
      and last_seen_at > now() - interval '8 seconds'
    order by enqueued_at
    limit p_player_count - 1
    for update skip locked
  ) q;
  v_found := coalesce(array_length(v_found_ids, 1), 0);
  v_waited := extract(epoch from now() - v_me.enqueued_at);

  -- Seat everyone once the table is full — or, after 45s, with whoever is
  -- here, computers taking the rest.
  if v_found = p_player_count - 1 or v_waited >= 45 then
    v_room_id := private.matchmaking_start_room(v_name, p_game_type, p_player_count, v_found_ids, v_found_names);
    update public.matchmaking_queue set room_id = v_room_id where user_id = any(v_found_ids);
    delete from public.matchmaking_queue where user_id = v_uid;
    return private.matchmaking_matched(v_room_id);
  end if;

  return jsonb_build_object(
    'status', 'waiting',
    'waitedSeconds', floor(v_waited),
    'timeoutSeconds', 45,
    'found', v_found,
    'needed', p_player_count - 1
  );
end;
$$;
revoke execute on function public.matchmake(text, text, int) from public;
revoke execute on function public.matchmake(text, text, int) from anon;
grant execute on function public.matchmake(text, text, int) to authenticated;

-- Leave the queue. If a table was formed first, returns that room instead
-- so the client can still take the player there rather than leave a seat
-- to be taken over.
create or replace function public.cancel_matchmaking()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_room_id uuid;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  delete from public.matchmaking_queue where user_id = v_uid returning room_id into v_room_id;
  if v_room_id is not null then
    return private.matchmaking_matched(v_room_id);
  end if;
  return jsonb_build_object('status', 'cancelled');
end;
$$;
revoke execute on function public.cancel_matchmaking() from public;
revoke execute on function public.cancel_matchmaking() from anon;
grant execute on function public.cancel_matchmaking() to authenticated;
