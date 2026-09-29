-- Party Mode, P1: the big screen (docs/COMPETITIVE_ROADMAP.md Section 6;
-- decisions 7-9 and 11).
--
-- A party room's table is shown on a shared screen (a TV or laptop) while
-- everyone plays from their own phone. The screen is an anonymous session
-- with no seat: it can watch its room, nothing else. It is registered in
-- room_displays when it creates the room, and:
--   * receives the room's broadcasts (a realtime policy below) and reads its
--     state through get_party_screen, but can't take a seat, roll, move,
--     chat or signal: every one of those needs a seat;
--   * never needs sign-in or an age answer (decision 8): it can't play.
-- The first person to sit down becomes the VIP (host) who picks the game and
-- starts it. Party rooms have no chat and no voice (P7): everyone is in the
-- same room, and it keeps the screen, which shares the room's channel, from
-- ever receiving chat or call signalling.

alter table public.rooms add column is_party boolean not null default false;

create table public.room_displays (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
alter table public.room_displays enable row level security;
revoke all on public.room_displays from anon, authenticated;

create or replace function private.ludo_is_display_of_room(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.room_displays
    where room_id = p_room_id and user_id = (select auth.uid())
  );
$$;
revoke execute on function private.ludo_is_display_of_room(uuid) from public;
grant execute on function private.ludo_is_display_of_room(uuid) to authenticated;

-- Beside "seated players can receive their room's broadcasts": the screen
-- receives them too. Party rooms broadcast only room state (no chat or
-- signalling, see below).
create policy "party screens can receive their room's broadcasts"
on realtime.messages for select to authenticated
using (
  extension = 'broadcast'
  and private.ludo_room_id_from_topic((select realtime.topic())) is not null
  and (select private.ludo_is_display_of_room(private.ludo_room_id_from_topic((select realtime.topic()))))
);

-- Start a party room from the screen. No sign-in or age check: the caller
-- only ever watches (decision 8).
create or replace function public.create_party_room(p_game_type text default 'ludo')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_code text;
begin
  if (select auth.uid()) is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_game_type is null or p_game_type not in ('ludo', 'snakes_and_ladders') then
    raise exception 'INVALID_GAME_TYPE';
  end if;
  v_code := private.ludo_generate_room_code();
  insert into public.rooms (code, status, max_players, game_type, is_party)
  values (v_code, 'lobby', 4, p_game_type, true)
  returning id into v_room_id;
  insert into public.room_displays (room_id, user_id) values (v_room_id, (select auth.uid()));
  return jsonb_build_object('roomId', v_room_id, 'code', v_code);
end;
$$;
revoke execute on function public.create_party_room(text) from public;
grant execute on function public.create_party_room(text) to authenticated;

-- The screen's view of its room: the same state players get.
create or replace function public.get_party_screen(p_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.ludo_is_display_of_room(p_room_id) then raise exception 'ROOM_NOT_FOUND'; end if;
  return private.ludo_room_state_json(p_room_id);
end;
$$;
revoke execute on function public.get_party_screen(uuid) from public;
grant execute on function public.get_party_screen(uuid) to authenticated;

-- Seating rules for party rooms, as triggers so every way of sitting down
-- (join by code, join by link, and any added later) follows them.
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
  return new;
end;
$$;
revoke execute on function private.party_seat_rules() from public;

create trigger party_seat_rules
before insert on public.players
for each row execute function private.party_seat_rules();

-- The first person (not computer) to sit at a party room becomes its VIP.
-- The update only succeeds while there's no host, so two phones joining at
-- once can't both become it.
create or replace function private.party_first_vip()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not new.is_bot then
    update public.rooms set host_player_id = new.id
    where id = new.room_id and is_party and host_player_id is null;
  end if;
  return new;
end;
$$;
revoke execute on function private.party_first_vip() from public;

create trigger party_first_vip
after insert on public.players
for each row execute function private.party_first_vip();

-- No chat and no voice in party rooms (P7).
create or replace function private.party_no_chat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select is_party from public.rooms where id = new.room_id) then raise exception 'PARTY_ROOM'; end if;
  return new;
end;
$$;
revoke execute on function private.party_no_chat() from public;

create trigger party_no_chat
before insert on public.table_messages
for each row execute function private.party_no_chat();

create or replace function private.party_no_voice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.in_voice and not old.in_voice and (select is_party from public.rooms where id = new.room_id) then
    raise exception 'PARTY_ROOM';
  end if;
  return new;
end;
$$;
revoke execute on function private.party_no_voice() from public;

create trigger party_no_voice
before update of in_voice on public.players
for each row execute function private.party_no_voice();

-- Redefines 20260916230000_voice_calls.sql's version: no call signalling in
-- party rooms, so it never reaches the screen.
CREATE OR REPLACE FUNCTION public.send_webrtc_signal(p_room_id uuid, p_to_player_id uuid, p_signal jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_from uuid;
begin
  v_from := private.ludo_caller_player_id(p_room_id);
  if v_from is null then
    raise exception 'SEAT_NOT_CONTROLLED';
  end if;
  if (select is_party from public.rooms where id = p_room_id) then
    raise exception 'PARTY_ROOM';
  end if;

  if not exists(select 1 from public.players where id = p_to_player_id and room_id = p_room_id) then
    raise exception 'INVALID_SIGNAL_TARGET';
  end if;

  perform realtime.send(
    jsonb_build_object('from', v_from, 'to', p_to_player_id, 'signal', p_signal),
    'webrtc_signal',
    'room:' || p_room_id::text,
    true
  );
end;
$function$;

-- Redefines 20260928070000_verifiable_dice.sql's version: says whether this
-- is a party room.
CREATE OR REPLACE FUNCTION private.ludo_room_state_json(p_room_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'roomId', r.id, 'hostPlayerId', r.host_player_id, 'code', r.code, 'gameType', r.game_type,
    'status', r.status, 'paused', r.paused_at is not null, 'maxPlayers', r.max_players,
    'rules', private.ludo_resolve_rules(r.rules),
    'matchId', r.current_match_id,
    'isParty', r.is_party,
    'diceCommitment', (select m.dice_commitment from public.matches m where m.id = r.current_match_id),
    'players', coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'seatIndex', p.seat_index, 'displayName', p.display_name, 'color', p.color,
      'status', p.status, 'isBot', p.is_bot, 'missedDecisionCount', p.missed_decision_count,
      'level', p.level, 'testWalletBalance', p.test_wallet_balance, 'autoRollEnabled', p.auto_roll_enabled,
      'rematchReady', p.rematch_ready, 'inVoice', p.in_voice,
      'avatarId', coalesce((select u.raw_user_meta_data ->> 'avatar_id' from auth.users u where u.id = p.user_id), (array['fox','panda','owl','frog'])[p.seat_index + 1]),
      'country', coalesce((select u.raw_user_meta_data ->> 'country' from auth.users u where u.id = p.user_id), '')
    ) order by p.seat_index) from public.players p where p.room_id = r.id), '[]'::jsonb),
    'pawns', private.ludo_room_pawns_json(r.id), 'turnPlayerId', r.turn_player_id,
    'turnPhase', r.turn_phase, 'turnDeadlineAt', r.turn_deadline_at, 'rollsThisTurn', r.rolls_this_turn,
    'activeDiceValue', r.active_dice_value, 'consecutiveSixes', r.consecutive_sixes,
    'legalMoves', case when r.game_type = 'ludo' and r.turn_phase = 'awaiting_move' and r.turn_player_id is not null and r.active_dice_value is not null then private.ludo_legal_moves(private.ludo_room_pawns_json(r.id), (select color from public.players where id = r.turn_player_id), r.active_dice_value) else '[]'::jsonb end,
    'winnerIds', coalesce(to_jsonb(r.winner_ids), '[]'::jsonb), 'matchEndReason', r.match_end_reason,
    'eventSequence', r.event_sequence
  ) from public.rooms r where r.id = p_room_id;
$function$;
