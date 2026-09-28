-- Match identity and stats (docs/COMPETITIVE_ROADMAP.md F0.3, with the
-- match-identity groundwork from Section 15, R1).
--
-- A room hosts many matches (rematches reuse it), but until now its event
-- log ran straight through them. Each start_match now creates a matches
-- row, tags that match's events with its id, and records a starting
-- snapshot. When a match ends, however it ends, a trigger derives each
-- seat's stats from the tagged events and stores them in match_results.
--
-- Matches that were already running when this deploys have no matches row,
-- so they get no results: stats are never guessed from untagged history.

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  game_type text not null,
  -- The resolved rules the match was played under (rooms.match_rules).
  rules jsonb not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  end_reason text check (end_reason in ('completed', 'abandoned'))
);

create index matches_room_id_idx on public.matches(room_id);
alter table public.matches enable row level security;
revoke all on public.matches from anon, authenticated;

alter table public.rooms
  add column current_match_id uuid references public.matches(id) on delete set null;

alter table public.match_events
  add column match_id uuid references public.matches(id) on delete cascade;

create index match_events_match_id_idx on public.match_events(match_id, sequence);

-- One row per seat per match. player_id is the seat (players.id), which a
-- rematch keeps, so the pair is unique; user_id is the account behind it at
-- the end of the match, if any.
create table public.match_results (
  match_id uuid not null references public.matches(id) on delete cascade,
  player_id uuid not null,
  user_id uuid references auth.users(id) on delete set null,
  account_kind text not null check (account_kind in ('account', 'guest', 'bot')),
  -- A human seat a computer was covering when the match ended.
  ended_under_takeover boolean not null default false,
  seat_index int not null,
  color text not null,
  -- 1 = first. Null when the match was abandoned.
  placement int,
  stats jsonb not null,
  created_at timestamptz not null default now(),
  primary key (match_id, player_id)
);

create index match_results_user_id_idx on public.match_results(user_id);
alter table public.match_results enable row level security;
revoke all on public.match_results from anon, authenticated;

-- Redefines 20260913222115_rpcs.sql's version: events logged while a match
-- is running or has just ended carry its id. Lobby events between matches
-- (rules, board, colors, rematch votes) carry none.
create or replace function private.ludo_append_event(p_room_id uuid, p_event_type text, p_player_id uuid, p_payload jsonb default '{}'::jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sequence bigint;
  v_match_id uuid;
begin
  update public.rooms set event_sequence = event_sequence + 1
  where id = p_room_id
  returning event_sequence,
    case when status in ('in_game', 'summary', 'abandoned') then current_match_id end
  into v_sequence, v_match_id;

  insert into public.match_events (room_id, sequence, event_type, player_id, payload, match_id)
  values (p_room_id, v_sequence, p_event_type, p_player_id, p_payload, v_match_id);

  return v_sequence;
end;
$$;

-- Each seat's stats, derived only from the match's own events:
--   rolls, sixes, faces (how often each face 1-6 came up), turns (turns in
--   which the seat rolled), capturesMade, pawnsLost, pawnsFinished,
--   missedDecisions, longestRunWithoutSix. Returns { playerId: stats } for
--   every seat in the match_started snapshot.
create or replace function private.match_stats(p_match_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with events as (
    select sequence, event_type, player_id, payload
    from public.match_events
    where match_id = p_match_id
  ),
  started as (
    select payload from events where event_type = 'match_started' order by sequence limit 1
  ),
  seats as (
    select (s->>'playerId')::uuid as player_id
    from started cross join lateral jsonb_array_elements(started.payload->'seats') s
  ),
  pawn_owners as (
    select p->>'pawnId' as pawn_id, (p->>'playerId')::uuid as player_id
    from started cross join lateral jsonb_array_elements(started.payload->'pawns') p
  ),
  rolls as (
    select sequence, player_id, (payload->>'dieValue')::int as die,
      lag(player_id) over (order by sequence) as previous_roller
    from events where event_type = 'dice_rolled'
  ),
  roll_runs as (
    -- Each six starts a new run; within a run, count the rolls that weren't.
    select player_id, die,
      sum(case when die = 6 then 1 else 0 end) over (partition by player_id order by sequence) as run
    from rolls
  ),
  moves as (
    select player_id,
      jsonb_array_length(coalesce(payload->'capturesPawnIds', '[]'::jsonb)) as captures,
      coalesce((payload->>'finishesPawn')::boolean, false) as finishes
    from events where event_type = 'legal_move_selected'
  ),
  captured as (
    select o.player_id
    from events e
    cross join lateral jsonb_array_elements_text(coalesce(e.payload->'capturesPawnIds', '[]'::jsonb)) c(pawn_id)
    join pawn_owners o on o.pawn_id = c.pawn_id
    where e.event_type = 'legal_move_selected'
  )
  select coalesce(jsonb_object_agg(s.player_id, jsonb_build_object(
    'rolls', (select count(*) from rolls r where r.player_id = s.player_id),
    'sixes', (select count(*) from rolls r where r.player_id = s.player_id and r.die = 6),
    'faces', (select jsonb_agg((select count(*) from rolls r where r.player_id = s.player_id and r.die = f) order by f)
              from generate_series(1, 6) f),
    'turns', (select count(*) from rolls r where r.player_id = s.player_id
              and r.previous_roller is distinct from r.player_id),
    'capturesMade', (select coalesce(sum(m.captures), 0) from moves m where m.player_id = s.player_id),
    'pawnsLost', (select count(*) from captured c where c.player_id = s.player_id),
    'pawnsFinished', (select count(*) from moves m where m.player_id = s.player_id and m.finishes),
    'missedDecisions', (select count(*) from events e where e.player_id = s.player_id
                        and e.event_type = 'decision_timed_out'),
    'longestRunWithoutSix', (select coalesce(max(n), 0) from (
        select count(*) filter (where rr.die <> 6) as n
        from roll_runs rr where rr.player_id = s.player_id group by rr.run) runs)
  )), '{}'::jsonb)
  from seats s;
$$;

revoke execute on function private.match_stats(uuid) from public;

-- Records a match's end and each seat's result, once, whichever path ended
-- it (a Ludo or Snakes & Ladders win, or abandonment): every one of them
-- sets match_end_reason. Safe to run twice: the matches update only fills
-- an open match, and results insert on conflict do nothing.
create or replace function private.finalize_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stats jsonb;
begin
  update public.matches
  set ended_at = now(), end_reason = new.match_end_reason
  where id = new.current_match_id and ended_at is null;

  v_stats := private.match_stats(new.current_match_id);

  insert into public.match_results
    (match_id, player_id, user_id, account_kind, ended_under_takeover, seat_index, color, placement, stats)
  select
    new.current_match_id,
    p.id,
    p.user_id,
    case
      when p.is_bot or p.user_id is null then 'bot'
      when coalesce(u.is_anonymous, false) then 'guest'
      else 'account'
    end,
    not p.is_bot and p.status = 'bot',
    p.seat_index,
    p.color,
    case
      when new.match_end_reason <> 'completed' then null
      when p.id = any(new.winner_ids) then array_position(new.winner_ids, p.id)
      -- Unfinished seats in a completed match (the loser of a 2-player
      -- game) place after every finisher, by pawns home, then seat order.
      else coalesce(array_length(new.winner_ids, 1), 0) + (
        select count(*)::int + 1 from public.players o
        where o.room_id = new.id
          and not (o.id = any(new.winner_ids))
          and o.id <> p.id
          and (
            coalesce((v_stats->(o.id::text)->>'pawnsFinished')::int, 0)
              > coalesce((v_stats->(p.id::text)->>'pawnsFinished')::int, 0)
            or (
              coalesce((v_stats->(o.id::text)->>'pawnsFinished')::int, 0)
                = coalesce((v_stats->(p.id::text)->>'pawnsFinished')::int, 0)
              and o.seat_index < p.seat_index
            )
          )
      )
    end,
    v_stats->(p.id::text)
  from public.players p
  left join auth.users u on u.id = p.user_id
  where p.room_id = new.id
    and v_stats ? (p.id::text)
  on conflict (match_id, player_id) do nothing;

  return new;
end;
$$;

revoke execute on function private.finalize_match() from public;

create trigger finalize_match
after update on public.rooms
for each row
when (
  old.match_end_reason is null
  and new.match_end_reason is not null
  and new.current_match_id is not null
)
execute function private.finalize_match();

-- The latest match's results for the players at the table (F1.1 reads
-- these for the end-of-game summary). Account ids are never returned.
create or replace function public.get_match_results(p_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_match_id uuid;
begin
  if not private.ludo_is_seated_in_room(p_room_id) then raise exception 'ROOM_NOT_FOUND'; end if;
  select current_match_id into v_match_id from public.rooms where id = p_room_id;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'playerId', r.player_id,
      'seatIndex', r.seat_index,
      'color', r.color,
      'isBot', r.account_kind = 'bot',
      'placement', r.placement,
      'stats', r.stats
    ) order by r.placement nulls last, r.seat_index)
    from public.match_results r
    where r.match_id = v_match_id
  ), '[]'::jsonb);
end;
$$;

revoke execute on function public.get_match_results(uuid) from public;
grant execute on function public.get_match_results(uuid) to authenticated;

-- Redefines 20260928040000_room_rules.sql's version: creates the match and
-- records its starting snapshot.
CREATE OR REPLACE FUNCTION public.start_match(p_room_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_room public.rooms;
  v_caller_player_id uuid;
  v_seat int;
  v_seat_count int;
  v_first_player_id uuid;
  v_player record;
  v_match_id uuid;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  if v_room.status <> 'lobby' then
    raise exception 'ALREADY_STARTED';
  end if;

  v_caller_player_id := private.ludo_caller_player_id(p_room_id);
  if v_caller_player_id is null or v_caller_player_id <> v_room.host_player_id then
    raise exception 'NOT_HOST';
  end if;

  select count(*) into v_seat_count from public.players where room_id = p_room_id;
  if v_seat_count < 2 then
    raise exception 'NOT_ENOUGH_PLAYERS';
  end if;

  -- For a 2-player room, join_room/fill_bot only ever seat the diagonal
  -- pair, so the v_seat_count >= 2 check above already means both of
  -- those (possibly non-{0,1}) seats are filled — nothing to bot-fill.
  -- Running the seat-range loop below unconditionally would be a real
  -- bug here: for a room actually seated at {1,3}, it would insert a
  -- phantom third bot at seat 0 (or 1), since that range still assumes
  -- every 2-player room uses seats {0,1}.
  if v_room.max_players <> 2 then
    for v_seat in 0..(v_room.max_players - 1) loop
      if not exists (select 1 from public.players where room_id = p_room_id and seat_index = v_seat) then
        insert into public.players (room_id, seat_index, user_id, display_name, color, status, is_bot)
        values (p_room_id, v_seat, null, 'Bot ' || (v_seat + 1), private.ludo_color_for_seat(v_seat), 'bot', true);
      end if;
    end loop;
  end if;

  for v_player in select * from public.players where room_id = p_room_id loop
    insert into public.pawns (room_id, player_id, pawn_index, state, path_index)
    select p_room_id, v_player.id, gs, 'nest', null
    from generate_series(0, case when v_room.game_type = 'ludo' then 3 else 0 end) as gs;
  end loop;

  select id into v_first_player_id from public.players where room_id = p_room_id order by seat_index asc limit 1;

  insert into public.matches (room_id, game_type, rules)
  values (p_room_id, v_room.game_type, private.ludo_resolve_rules(v_room.rules))
  returning id into v_match_id;

  update public.rooms
  set status = 'in_game',
      turn_player_id = v_first_player_id,
      turn_phase = 'awaiting_roll',
      turn_deadline_at = private.ludo_next_turn_deadline(v_first_player_id),
      rolls_this_turn = 0,
      consecutive_sixes = 0,
      match_rules = private.ludo_resolve_rules(v_room.rules),
      current_match_id = v_match_id
  where id = p_room_id;

  -- The match's starting point, so its history can be read from events
  -- alone: who sat where, and which pawn belongs to whom.
  perform private.ludo_append_event(p_room_id, 'match_started', null, jsonb_build_object(
    'matchId', v_match_id,
    'rules', private.ludo_resolve_rules(v_room.rules),
    'seats', (select jsonb_agg(jsonb_build_object(
        'playerId', p.id, 'seatIndex', p.seat_index, 'color', p.color, 'isBot', p.is_bot
      ) order by p.seat_index) from public.players p where p.room_id = p_room_id),
    'pawns', (select jsonb_agg(jsonb_build_object(
        'pawnId', pw.id, 'playerId', pw.player_id, 'index', pw.pawn_index
      ) order by pw.player_id, pw.pawn_index) from public.pawns pw where pw.room_id = p_room_id)
  ));
  perform private.ludo_broadcast_state(p_room_id);

  return jsonb_build_object('roomId', p_room_id);
end;
$function$;

-- Redefines 20260913225951_m3_timers_bots_reconnect.sql's version: a missed
-- decision is recorded as an event, so stats can count it.
CREATE OR REPLACE FUNCTION private.ludo_resolve_turn_timeout(p_room_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_room public.rooms;
  v_player public.players;
  v_is_bot_controlled boolean;
  v_new_miss_count int;
  v_pawns_json jsonb;
  v_legal_moves jsonb;
  v_chosen_move jsonb;
begin
  select * into v_room from public.rooms where id = p_room_id;
  if v_room.turn_player_id is null then
    return;
  end if;

  select * into v_player from public.players where id = v_room.turn_player_id;
  v_is_bot_controlled := v_player.is_bot or v_player.status = 'bot' or v_player.auto_roll_enabled;

  if not v_is_bot_controlled then
    -- A genuine miss: count it, and escalate on the documented thresholds
    -- (PRD 5.2). "OR a continuous disconnect longer than 45 seconds" is
    -- evaluated here, on top of the miss itself — see the file header for
    -- why this can only fire on an already-missed decision, not ambiently.
    update public.players
    set missed_decision_count = missed_decision_count + 1
    where id = v_player.id
    returning missed_decision_count into v_new_miss_count;

    perform private.ludo_append_event(p_room_id, 'decision_timed_out', v_player.id, jsonb_build_object(
      'phase', v_room.turn_phase,
      'missedDecisions', v_new_miss_count
    ));

    if v_new_miss_count = 2 then
      update public.players set status = 'inactive' where id = v_player.id;
    end if;

    if v_new_miss_count >= 3 or (now() - v_player.last_seen_at) > interval '45 seconds' then
      update public.players set status = 'bot' where id = v_player.id;
      v_is_bot_controlled := true;
    end if;
  end if;

  if v_room.turn_phase = 'awaiting_roll' then
    perform private.ludo_perform_roll(p_room_id, v_room.turn_player_id);
  elsif v_room.turn_phase = 'awaiting_move' then
    v_pawns_json := private.ludo_room_pawns_json(p_room_id);
    v_legal_moves := private.ludo_legal_moves(v_pawns_json, v_player.color, v_room.active_dice_value);
    v_chosen_move := private.ludo_choose_bot_move(v_legal_moves, v_pawns_json);

    if v_chosen_move is null then
      -- Defensive only: awaiting_move implies legal_moves was non-empty
      -- when the roll was made. Advance rather than leave the room stuck.
      perform private.ludo_advance_to_next_player(p_room_id);
    else
      perform private.ludo_perform_move(p_room_id, v_room.turn_player_id, (v_chosen_move->>'pawnId')::uuid);
    end if;
  end if;
  -- Any other turn_phase ('resolving', 'complete') has nothing to time out —
  -- those are resolved synchronously within a single transaction elsewhere.
end;
$function$;
