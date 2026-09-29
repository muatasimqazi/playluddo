-- Tournaments (docs/COMPETITIVE_ROADMAP.md F4.1; decision 16).
--
-- Private, team-based knockouts of 8 or 16 players, played as ordinary online
-- rooms: 4-player tables where the top two advance (8 -> final 4; 16 -> 8 ->
-- final 4). Placement within a table is the one finalize_match already records.
-- A scheduled start seeds round 1 from the check-in roster; a no-show's seat is
-- theirs, covered by a computer until they reclaim it (the existing takeover
-- model). Computers may advance but never earn the trophy: it is awarded only
-- when the winning seat finished under a real account, not under takeover.
--
-- Reuses: match_results/finalize_match (placement, account_kind,
-- ended_under_takeover), reclaim_seat + takeover, achievements/cosmetics unlock
-- chain (trophy + badge), the F4.4 watch path, teams (roster) and pg_cron.

-- ---------------------------------------------------------------------------
-- Let the engine start a table without a seated host. public.start_match keeps
-- its host check and delegates the actual work to private.ludo_start_match, so
-- the tournament seeder (which has no caller seat) can start bracket tables.
create or replace function private.ludo_start_match(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_start_on_board int := (private.ludo_resolve_rules((select rules from public.rooms where id = p_room_id))->>'startOnBoard')::int;
  v_room public.rooms;
  v_seat int;
  v_seat_count int;
  v_first_player_id uuid;
  v_player record;
  v_match_id uuid;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if v_room.status <> 'lobby' then raise exception 'ALREADY_STARTED'; end if;

  select count(*) into v_seat_count from public.players where room_id = p_room_id;
  if v_seat_count < 2 then raise exception 'NOT_ENOUGH_PLAYERS'; end if;

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
    select p_room_id, v_player.id, gs,
      case when v_room.game_type = 'ludo' and gs < v_start_on_board then 'track' else 'nest' end,
      case when v_room.game_type = 'ludo' and gs < v_start_on_board then 0 end
    from generate_series(0, case when v_room.game_type = 'ludo' then 3 else 0 end) as gs;
  end loop;

  select id into v_first_player_id from public.players where room_id = p_room_id order by seat_index asc limit 1;

  update public.rooms set match_ends_at = case
      when (private.ludo_resolve_rules(v_room.rules)->>'matchMinutes')::int > 0
      then now() + make_interval(mins => (private.ludo_resolve_rules(v_room.rules)->>'matchMinutes')::int)
    end
  where id = p_room_id;

  insert into public.matches (room_id, game_type, rules)
  values (p_room_id, v_room.game_type, private.ludo_resolve_rules(v_room.rules))
  returning id into v_match_id;

  insert into private.match_dice (match_id, seed)
  values (v_match_id, extensions.gen_random_bytes(32));
  update public.matches
  set dice_commitment = (select encode(extensions.digest(seed, 'sha256'), 'hex')
                         from private.match_dice where match_id = v_match_id)
  where id = v_match_id;

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

  perform private.ludo_append_event(p_room_id, 'match_started', null, jsonb_build_object(
    'matchId', v_match_id,
    'rules', private.ludo_resolve_rules(v_room.rules),
    'diceProtocol', 'luddo-dice-v1',
    'diceCommitment', (select dice_commitment from public.matches where id = v_match_id),
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
revoke execute on function private.ludo_start_match(uuid) from public;

-- Redefines 20260928220100_rush_mode_clock.sql's version: unchanged behaviour,
-- now a thin host-checked wrapper over private.ludo_start_match.
CREATE OR REPLACE FUNCTION public.start_match(p_room_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_room public.rooms;
  v_caller_player_id uuid;
begin
  select * into v_room from public.rooms where id = p_room_id;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if v_room.status <> 'lobby' then raise exception 'ALREADY_STARTED'; end if;
  v_caller_player_id := private.ludo_caller_player_id(p_room_id);
  if v_caller_player_id is null or v_caller_player_id <> v_room.host_player_id then
    raise exception 'NOT_HOST';
  end if;
  return private.ludo_start_match(p_room_id);
end;
$function$;

-- ---------------------------------------------------------------------------
-- Catalog: the champion badge and the trophy cosmetic it unlocks.
insert into public.achievements (id, name, description, sort, gc_id) values
  ('tournament_win', 'Tournament Champion', 'Win a private tournament.', 250, null)
on conflict (id) do nothing;

insert into public.cosmetics (id, type, name, description, sort, unlock_level, unlock_achievement, unlock_streak) values
  ('room_trophy', 'room', 'Trophy Room', 'A champion''s trophy room.', 155, null, 'tournament_win', null)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Schema.
create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 40),
  size int not null check (size in (8, 16)),
  game_type text not null default 'ludo' check (game_type in ('ludo', 'snakes_and_ladders')),
  status text not null default 'scheduled' check (status in ('scheduled', 'active', 'complete', 'cancelled')),
  check_in_opens_at timestamptz not null,
  starts_at timestamptz not null,
  created_by_user_id uuid references auth.users(id) on delete set null,
  winner_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (starts_at > check_in_opens_at)
);
create index tournaments_team_id_idx on public.tournaments(team_id);
alter table public.tournaments enable row level security;
revoke all on public.tournaments from anon, authenticated;

create table public.tournament_entrants (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  seed int not null,
  checked_in boolean not null default false,
  eliminated boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (tournament_id, user_id)
);
alter table public.tournament_entrants enable row level security;
revoke all on public.tournament_entrants from anon, authenticated;

create table public.tournament_tables (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  round int not null,
  table_index int not null,
  room_id uuid references public.rooms(id) on delete set null,
  status text not null default 'in_progress' check (status in ('in_progress', 'done')),
  unique (tournament_id, round, table_index)
);
create index tournament_tables_room_id_idx on public.tournament_tables(room_id);
alter table public.tournament_tables enable row level security;
revoke all on public.tournament_tables from anon, authenticated;

-- A bracket table's room, so the advancement trigger can recognise it and so
-- these rooms stay out of quick-match / team-room discovery.
alter table public.rooms add column tournament_table_id uuid references public.tournament_tables(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Bracket engine.

-- Seat and start every 4-player table of a round. p_slots holds one entry per
-- bracket seat, in table-then-seat order: a user_id seats that entrant with a
-- computer covering (status 'bot', reclaimable); a null is a pure computer.
create or replace function private.tournament_seed_round(p_tournament_id uuid, p_round int, p_slots uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t public.tournaments;
  v_tables int := coalesce(array_length(p_slots, 1), 0) / 4;
  v_i int;
  v_seat int;
  v_occupant uuid;
  v_room_id uuid;
  v_table_id uuid;
  v_host uuid;
  v_name text;
  v_bot_names text[] := array['Rowan', 'Sage', 'Jules', 'Avery', 'Kai', 'Maya', 'Theo', 'Nia'];
begin
  select * into v_t from public.tournaments where id = p_tournament_id;
  for v_i in 0..(v_tables - 1) loop
    insert into public.rooms (code, status, max_players, game_type, watching_enabled)
    values (private.ludo_generate_room_code(), 'lobby', 4, v_t.game_type, true)
    returning id into v_room_id;

    insert into public.tournament_tables (tournament_id, round, table_index, room_id, status)
    values (p_tournament_id, p_round, v_i, v_room_id, 'in_progress')
    returning id into v_table_id;
    update public.rooms set tournament_table_id = v_table_id where id = v_room_id;

    for v_seat in 0..3 loop
      v_occupant := p_slots[v_i * 4 + v_seat + 1];
      if v_occupant is not null then
        v_name := coalesce(
          (select display_name from public.tournament_entrants where tournament_id = p_tournament_id and user_id = v_occupant),
          'Player');
        insert into public.players (room_id, seat_index, user_id, display_name, color, status, is_bot)
        values (v_room_id, v_seat, v_occupant, left(v_name, 24), private.ludo_color_for_seat(v_seat), 'bot', false);
      else
        insert into public.players (room_id, seat_index, user_id, display_name, color, status, is_bot)
        values (v_room_id, v_seat, null, v_bot_names[((v_i * 4 + v_seat) % 8) + 1], private.ludo_color_for_seat(v_seat), 'bot', true);
      end if;
    end loop;

    -- Host is the first real entrant's seat (so they can pause / manage on
    -- arrival), else the first seat.
    select id into v_host from public.players where room_id = v_room_id and user_id is not null order by seat_index limit 1;
    if v_host is null then
      select id into v_host from public.players where room_id = v_room_id order by seat_index limit 1;
    end if;
    update public.rooms set host_player_id = v_host where id = v_room_id;

    perform private.ludo_start_match(v_room_id);
  end loop;
end;
$$;
revoke execute on function private.tournament_seed_round(uuid, int, uuid[]) from public;

-- Seeds round 1 for every scheduled tournament whose start time has come.
-- Fewer than two entrants: cancel rather than run a table of computers.
create or replace function private.start_due_tournaments()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t record;
  v_slots uuid[];
  v_n int;
  v_started int := 0;
begin
  for v_t in
    select * from public.tournaments
    where status = 'scheduled' and starts_at <= now()
    for update skip locked
  loop
    select array_agg(user_id order by seed) into v_slots
    from public.tournament_entrants where tournament_id = v_t.id;
    v_n := coalesce(array_length(v_slots, 1), 0);
    if v_n < 2 then
      update public.tournaments set status = 'cancelled' where id = v_t.id;
      continue;
    end if;
    while v_n < v_t.size loop
      v_slots := v_slots || null::uuid;
      v_n := v_n + 1;
    end loop;
    update public.tournaments set status = 'active' where id = v_t.id;
    perform private.tournament_seed_round(v_t.id, 1, v_slots[1:v_t.size]);
    v_started := v_started + 1;
  end loop;
  return v_started;
end;
$$;
revoke execute on function private.start_due_tournaments() from public;

select cron.schedule('start-due-tournaments', '* * * * *', $$select private.start_due_tournaments()$$);

-- When a bracket table's match ends, mark it done, eliminate non-advancers, and
-- once every table in the round is done, seed the next round or crown a
-- champion. Mirrors the finalize_match / leaderboard_on_match_completed
-- triggers on public.rooms.
create or replace function private.tournament_on_table_complete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table public.tournament_tables;
  v_t public.tournaments;
  v_round_tables int;
  v_all_done boolean;
  v_advancers uuid[];
  v_winner record;
begin
  select * into v_table from public.tournament_tables where room_id = new.id and status <> 'done';
  if not found then return new; end if;

  update public.tournament_tables set status = 'done' where id = v_table.id;

  update public.tournament_entrants e set eliminated = true
  from public.match_results r
  where r.match_id = new.current_match_id
    and r.user_id = e.user_id
    and e.tournament_id = v_table.tournament_id
    and (r.placement is null or r.placement > 2);

  select * into v_t from public.tournaments where id = v_table.tournament_id for update;

  select count(*), bool_and(status = 'done')
    into v_round_tables, v_all_done
  from public.tournament_tables
  where tournament_id = v_t.id and round = v_table.round;
  if not v_all_done then return new; end if;

  if v_round_tables > 1 then
    -- More than one table this round: the top two of each advance.
    select array_agg(user_id order by table_index, placement) into v_advancers
    from (
      select tt.table_index, r.placement, r.user_id
      from public.tournament_tables tt
      join public.rooms rm on rm.id = tt.room_id
      join public.match_results r on r.match_id = rm.current_match_id
      where tt.tournament_id = v_t.id and tt.round = v_table.round and r.placement in (1, 2)
    ) adv;
    perform private.tournament_seed_round(v_t.id, v_table.round + 1, v_advancers);
  else
    -- The final: first place is the champion. A trophy only for a real account
    -- that played its own seat to the end (not a computer covering a no-show).
    select r.user_id, r.account_kind, r.ended_under_takeover into v_winner
    from public.rooms rm
    join public.match_results r on r.match_id = rm.current_match_id
    where rm.tournament_table_id = v_table.id and r.placement = 1;

    if v_winner.user_id is not null and v_winner.account_kind = 'account'
       and not v_winner.ended_under_takeover then
      insert into public.player_achievements (user_id, achievement_id)
      values (v_winner.user_id, 'tournament_win') on conflict do nothing;
      update public.tournaments set status = 'complete', winner_user_id = v_winner.user_id where id = v_t.id;
    else
      update public.tournaments set status = 'complete' where id = v_t.id;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function private.tournament_on_table_complete() from public;

create trigger tournament_on_table_complete
after update on public.rooms
for each row
when (
  old.match_end_reason is null
  and new.match_end_reason is not null
  and new.tournament_table_id is not null
)
execute function private.tournament_on_table_complete();

-- ---------------------------------------------------------------------------
-- Creation / entry / check-in (team members only).

create or replace function public.create_tournament(
  p_team_id uuid,
  p_name text,
  p_size int,
  p_game_type text,
  p_check_in_opens_at timestamptz,
  p_starts_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
  v_name text;
begin
  perform private.require_online_eligibility();
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not exists (select 1 from public.team_members where team_id = p_team_id and user_id = v_uid) then
    raise exception 'NOT_TEAM_MEMBER';
  end if;
  if p_size not in (8, 16) then raise exception 'INVALID_SIZE'; end if;
  if p_game_type not in ('ludo', 'snakes_and_ladders') then raise exception 'INVALID_GAME_TYPE'; end if;
  if char_length(btrim(p_name)) not between 2 and 40 then raise exception 'INVALID_NAME'; end if;
  if p_check_in_opens_at is null or p_starts_at is null or p_starts_at <= p_check_in_opens_at
     or p_starts_at <= now() then
    raise exception 'INVALID_SCHEDULE';
  end if;

  insert into public.tournaments (team_id, name, size, game_type, check_in_opens_at, starts_at, created_by_user_id)
  values (p_team_id, btrim(p_name), p_size, p_game_type, p_check_in_opens_at, p_starts_at, v_uid)
  returning id into v_id;

  select display_name into v_name from public.team_members where team_id = p_team_id and user_id = v_uid;
  insert into public.tournament_entrants (tournament_id, user_id, display_name, seed)
  values (v_id, v_uid, left(coalesce(v_name, 'Player'), 24), 1);

  return jsonb_build_object('tournamentId', v_id);
end;
$$;
revoke execute on function public.create_tournament(uuid, text, int, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.create_tournament(uuid, text, int, text, timestamptz, timestamptz) to authenticated;

create or replace function public.join_tournament(p_tournament_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_t public.tournaments;
  v_name text;
  v_count int;
begin
  perform private.require_online_eligibility();
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select * into v_t from public.tournaments where id = p_tournament_id for update;
  if not found then raise exception 'TOURNAMENT_NOT_FOUND'; end if;
  if v_t.status <> 'scheduled' then raise exception 'ALREADY_STARTED'; end if;
  select display_name into v_name from public.team_members where team_id = v_t.team_id and user_id = v_uid;
  if v_name is null then raise exception 'NOT_TEAM_MEMBER'; end if;
  if exists (select 1 from public.tournament_entrants where tournament_id = p_tournament_id and user_id = v_uid) then
    return;
  end if;
  select count(*) into v_count from public.tournament_entrants where tournament_id = p_tournament_id;
  if v_count >= v_t.size then raise exception 'TOURNAMENT_FULL'; end if;
  insert into public.tournament_entrants (tournament_id, user_id, display_name, seed)
  values (p_tournament_id, v_uid, left(v_name, 24), v_count + 1);
end;
$$;
revoke execute on function public.join_tournament(uuid) from public, anon;
grant execute on function public.join_tournament(uuid) to authenticated;

create or replace function public.leave_tournament(p_tournament_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_status text;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select status into v_status from public.tournaments where id = p_tournament_id;
  if v_status is null then raise exception 'TOURNAMENT_NOT_FOUND'; end if;
  if v_status <> 'scheduled' then raise exception 'ALREADY_STARTED'; end if;
  delete from public.tournament_entrants where tournament_id = p_tournament_id and user_id = v_uid;
end;
$$;
revoke execute on function public.leave_tournament(uuid) from public, anon;
grant execute on function public.leave_tournament(uuid) to authenticated;

create or replace function public.check_in_tournament(p_tournament_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_t public.tournaments;
begin
  perform private.require_online_eligibility();
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select * into v_t from public.tournaments where id = p_tournament_id;
  if not found then raise exception 'TOURNAMENT_NOT_FOUND'; end if;
  if v_t.status <> 'scheduled' then raise exception 'ALREADY_STARTED'; end if;
  if now() < v_t.check_in_opens_at or now() > v_t.starts_at then raise exception 'CHECK_IN_CLOSED'; end if;
  update public.tournament_entrants set checked_in = true
  where tournament_id = p_tournament_id and user_id = v_uid;
  if not found then raise exception 'NOT_ENTERED'; end if;
end;
$$;
revoke execute on function public.check_in_tournament(uuid) from public, anon;
grant execute on function public.check_in_tournament(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Reads (team members only).

create or replace function public.get_tournament(p_tournament_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_t public.tournaments;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select * into v_t from public.tournaments where id = p_tournament_id;
  if not found then raise exception 'TOURNAMENT_NOT_FOUND'; end if;
  if not exists (select 1 from public.team_members where team_id = v_t.team_id and user_id = v_uid) then
    raise exception 'NOT_TEAM_MEMBER';
  end if;

  return jsonb_build_object(
    'id', v_t.id,
    'name', v_t.name,
    'teamId', v_t.team_id,
    'size', v_t.size,
    'gameType', v_t.game_type,
    'status', v_t.status,
    'checkInOpensAt', v_t.check_in_opens_at,
    'startsAt', v_t.starts_at,
    'winnerUserId', v_t.winner_user_id,
    'myUserId', v_uid,
    'entrants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', e.user_id,
        'displayName', private.clean_text(e.display_name),
        'seed', e.seed,
        'checkedIn', e.checked_in,
        'eliminated', e.eliminated
      ) order by e.seed)
      from public.tournament_entrants e where e.tournament_id = v_t.id), '[]'::jsonb),
    'tables', coalesce((
      select jsonb_agg(jsonb_build_object(
        'round', tt.round,
        'tableIndex', tt.table_index,
        'roomId', tt.room_id,
        'status', tt.status,
        'mine', exists (
          select 1 from public.players p
          where p.room_id = tt.room_id and p.user_id = v_uid),
        'seats', coalesce((
          select jsonb_agg(jsonb_build_object(
            'displayName', p.display_name,
            'color', p.color,
            'isBot', p.is_bot,
            'placement', (select r.placement from public.match_results r
              join public.rooms rm on rm.id = tt.room_id
              where r.match_id = rm.current_match_id and r.player_id = p.id)
          ) order by p.seat_index)
          from public.players p where p.room_id = tt.room_id), '[]'::jsonb)
      ) order by tt.round, tt.table_index)
      from public.tournament_tables tt where tt.tournament_id = v_t.id), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.get_tournament(uuid) from public, anon;
grant execute on function public.get_tournament(uuid) to authenticated;

create or replace function public.get_my_tournaments()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id,
    'name', t.name,
    'teamId', t.team_id,
    'teamName', tm2.name,
    'size', t.size,
    'gameType', t.game_type,
    'status', t.status,
    'startsAt', t.starts_at,
    'checkInOpensAt', t.check_in_opens_at,
    'entrantCount', (select count(*) from public.tournament_entrants e where e.tournament_id = t.id),
    'entered', exists (select 1 from public.tournament_entrants e where e.tournament_id = t.id and e.user_id = (select auth.uid()))
  ) order by t.starts_at desc), '[]'::jsonb)
  from public.tournaments t
  join public.teams tm2 on tm2.id = t.team_id
  where t.team_id in (
    select team_id from public.team_members where user_id = (select auth.uid())
  )
  and t.status in ('scheduled', 'active');
$$;
revoke execute on function public.get_my_tournaments() from public, anon;
grant execute on function public.get_my_tournaments() to authenticated;
