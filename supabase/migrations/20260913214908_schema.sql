-- Ludo Rivals core schema. See docs/IMPLEMENTATION_HANDOFF.md Section 4.
--
-- RLS is enabled on every table below with NO policies yet — that is the
-- correct, safe default: until M2 authors explicit policies, these tables
-- are readable/writable by no one except a role that bypasses RLS (e.g. the
-- Postgres superuser used by migrations, or a future SECURITY DEFINER
-- function owner). Do not treat "no policies yet" as "not secured yet".

create extension if not exists pgcrypto;

create table rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                    -- >=6 char join code (PRD 5.1)
  status text not null default 'lobby'
    check (status in ('lobby', 'in_game', 'summary', 'abandoned')),
  host_player_id uuid,
  turn_player_id uuid,
  turn_phase text not null default 'awaiting_roll'
    check (turn_phase in ('awaiting_roll', 'awaiting_move', 'resolving', 'complete')),
  turn_deadline_at timestamptz,
  rolls_this_turn int not null default 0,
  active_dice_value int,
  consecutive_sixes int not null default 0,
  winner_ids uuid[] not null default '{}',
  match_end_reason text check (match_end_reason in ('completed', 'abandoned')),
  event_sequence bigint not null default 0,
  stake_enabled boolean not null default false,  -- PRD 3.3 feature flag, default off
  created_at timestamptz not null default now()
);

create table players (                           -- a seat, not necessarily a signed-in human
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  seat_index int not null,
  user_id uuid references auth.users(id),        -- null for a bot-only/unfilled seat
  display_name text not null,
  color text not null check (color in ('red', 'green', 'yellow', 'blue')),
  status text not null default 'connected'
    check (status in ('connected', 'disconnected', 'inactive', 'bot')),
  is_bot boolean not null default false,
  missed_decision_count int not null default 0,
  level int not null default 1,                  -- static placeholder, no progression (PRD 5.1)
  test_wallet_balance int not null default 0,     -- only meaningful if rooms.stake_enabled
  live_connection_token uuid,                     -- duplicate-session guard (PRD 5.2)
  unique (room_id, seat_index)
);

alter table rooms
  add constraint rooms_host_player_id_fkey
  foreign key (host_player_id) references players(id),
  add constraint rooms_turn_player_id_fkey
  foreign key (turn_player_id) references players(id);

create table pawns (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  pawn_index int not null check (pawn_index between 0 and 3),
  state text not null default 'nest'
    check (state in ('nest', 'track', 'home_lane', 'finished')),
  path_index int,                                 -- 0-56, null while in nest
  unique (player_id, pawn_index)
);

create table match_events (                       -- append-only; drives replay + analytics (PRD 8.1)
  id bigint generated always as identity primary key,
  room_id uuid not null references rooms(id) on delete cascade,
  sequence bigint not null,
  event_type text not null,
  player_id uuid references players(id),
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (room_id, sequence)
);

create index rooms_code_idx on rooms (code);
create index players_room_id_idx on players (room_id);
create index pawns_room_id_idx on pawns (room_id);
create index match_events_room_id_sequence_idx on match_events (room_id, sequence);

alter table rooms enable row level security;
alter table players enable row level security;
alter table pawns enable row level security;
alter table match_events enable row level security;
