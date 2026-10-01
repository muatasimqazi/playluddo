-- Cast to TV: a seated player shows their table on a TV (a Chromecast or any
-- display their browser can present to) while they keep playing from their
-- own device.
--
-- The TV opens `/screen?id=<room>&cast=<token>` in a browser of its own, so it
-- arrives as a fresh anonymous session that belongs to nobody at the table.
-- The token is how a seat vouches for it:
--   * create_cast_link: a seated player gets a token for their room. It
--     expires after a day, and only ever goes to the display their browser
--     presents to; it is never shown.
--   * claim_cast: the TV trades the token for read-only access.
--       - A party room: the TV becomes one of the room's displays
--         (room_displays, 20260928090000_party_screen.sql), exactly like the
--         screen that opened the room. Party rooms carry no chat, and call
--         signalling there goes to per-seat topics (20260928170000), so the
--         room topic is safe for a display.
--       - An ordinary room: its room topic carries chat and call signalling,
--         which a TV must never receive. So, like watchers (F4.4,
--         20260929110000_watch_tables.sql), the TV gets a private topic
--         `cast:<id>` that the server sends only game state to.
-- A TV keeps its access for as long as the room exists (it can only ever see
-- what the players see). It can't take a seat, roll, move, chat or react;
-- every one of those needs a seat.
-- No sign-in or age answer is asked of the TV: it can't play (decision 8).

create table public.room_cast_links (
  token text primary key default encode(extensions.gen_random_bytes(24), 'hex'),
  room_id uuid not null references public.rooms(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '24 hours'
);
create index room_cast_links_player_idx on public.room_cast_links (player_id);
alter table public.room_cast_links enable row level security;
revoke all on public.room_cast_links from anon, authenticated;

create table public.room_casts (
  -- Suffix of this TV's private delivery topic (`cast:<id>`).
  id uuid not null default gen_random_uuid() unique,
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- The seat that cast it.
  player_id uuid not null references public.players(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
alter table public.room_casts enable row level security;
revoke all on public.room_casts from anon, authenticated;

create or replace function private.ludo_is_cast_of_room(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.room_casts
    where room_id = p_room_id and user_id = (select auth.uid())
  );
$$;
revoke execute on function private.ludo_is_cast_of_room(uuid) from public;
grant execute on function private.ludo_is_cast_of_room(uuid) to authenticated;

-- A TV may receive broadcasts only on its own `cast:<id>` topic, which carries
-- game state alone: never chat, reactions or call signalling.
create or replace function private.cast_topic_allowed(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.room_casts
    where user_id = (select auth.uid()) and 'cast:' || id::text = p_topic
  );
$$;
revoke execute on function private.cast_topic_allowed(text) from public;
grant execute on function private.cast_topic_allowed(text) to authenticated;

create policy "cast TVs receive their own read-only broadcasts"
on realtime.messages for select to authenticated
using (
  extension = 'broadcast'
  and (select private.cast_topic_allowed((select realtime.topic())))
);

-- The TV animates rolls and moves from the event log, like the Party screen
-- and watchers. Events hold no secrets (the dice seed stays in
-- private.match_dice until the match ends).
create policy "cast TVs can read events in their room" on public.match_events
for select to authenticated
using ( (select private.ludo_is_cast_of_room(room_id)) );

-- Redefines 20260929110000_watch_tables.sql's version: state also fans out to
-- each cast TV's private topic.
create or replace function private.ludo_broadcast_state(p_room_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_payload jsonb;
begin
  v_payload := private.ludo_room_state_json(p_room_id);
  perform realtime.send(v_payload, 'state_updated', 'room:' || p_room_id::text, true);
  for v_id in select id from public.party_audience where room_id = p_room_id loop
    perform realtime.send(v_payload, 'state_updated', 'audience:' || v_id::text, true);
  end loop;
  for v_id in select id from public.room_watchers where room_id = p_room_id loop
    perform realtime.send(v_payload, 'state_updated', 'watch:' || v_id::text, true);
  end loop;
  for v_id in select id from public.room_casts where room_id = p_room_id loop
    perform realtime.send(v_payload, 'state_updated', 'cast:' || v_id::text, true);
  end loop;
end;
$$;
revoke execute on function private.ludo_broadcast_state(uuid) from public;

-- A seated player's cast token for their room. Reuses the seat's live token,
-- so opening the lobby or the table again doesn't pile up new ones.
create or replace function public.create_cast_link(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_token text;
begin
  if (select auth.uid()) is null then raise exception 'UNAUTHENTICATED'; end if;
  if not exists (select 1 from public.rooms where id = p_room_id and status <> 'abandoned') then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  v_player := private.ludo_caller_player_id(p_room_id);
  if v_player is null then raise exception 'SEAT_NOT_CONTROLLED'; end if;

  delete from public.room_cast_links where player_id = v_player and expires_at <= now();
  select token into v_token from public.room_cast_links
  where player_id = v_player and room_id = p_room_id and expires_at > now() + interval '1 hour'
  order by expires_at desc limit 1;
  if v_token is null then
    insert into public.room_cast_links (room_id, player_id)
    values (p_room_id, v_player)
    returning token into v_token;
  end if;
  return jsonb_build_object('token', v_token);
end;
$$;
revoke execute on function public.create_cast_link(uuid) from public;
grant execute on function public.create_cast_link(uuid) to authenticated;

-- The TV trades a token for read-only access to the room. Calling it again
-- (the TV reloading) is harmless.
create or replace function public.claim_cast(p_room_id uuid, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.room_cast_links;
  v_room public.rooms;
  v_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'UNAUTHENTICATED'; end if;
  select * into v_link from public.room_cast_links
  where token = p_token and room_id = p_room_id and expires_at > now();
  if not found then raise exception 'CAST_LINK_INVALID'; end if;
  select * into v_room from public.rooms where id = p_room_id;
  if not found or v_room.status = 'abandoned' then raise exception 'ROOM_NOT_FOUND'; end if;
  -- A TV is never also a seat (and the trigger on players keeps a display
  -- from sitting down later).
  if exists (select 1 from public.players where room_id = p_room_id and user_id = (select auth.uid())) then
    raise exception 'ALREADY_SEATED';
  end if;

  if v_room.is_party then
    insert into public.room_displays (room_id, user_id)
    values (p_room_id, (select auth.uid()))
    on conflict (room_id, user_id) do nothing;
    return jsonb_build_object('roomId', p_room_id, 'isParty', true);
  end if;

  insert into public.room_casts (room_id, user_id, player_id)
  values (p_room_id, (select auth.uid()), v_link.player_id)
  on conflict (room_id, user_id) do update set player_id = excluded.player_id
  returning id into v_id;
  return jsonb_build_object('roomId', p_room_id, 'isParty', false, 'castTopic', 'cast:' || v_id::text);
end;
$$;
revoke execute on function public.claim_cast(uuid, text) from public;
grant execute on function public.claim_cast(uuid, text) to authenticated;

-- A cast TV's read-only view of an ordinary table: the same public state
-- players get.
create or replace function public.get_cast_state(p_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.ludo_is_cast_of_room(p_room_id) then raise exception 'ROOM_NOT_FOUND'; end if;
  return private.ludo_room_state_json(p_room_id);
end;
$$;
revoke execute on function public.get_cast_state(uuid) from public;
grant execute on function public.get_cast_state(uuid) to authenticated;
