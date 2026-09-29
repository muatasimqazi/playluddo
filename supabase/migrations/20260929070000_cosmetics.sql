-- Earned cosmetics (docs/COMPETITIVE_ROADMAP.md F3.5, Section 15 R8, R10).
--
-- A catalog of cosmetics unlocked by playing — through levels (F3.2),
-- achievements (F3.4) and streaks (F3.3). Nothing is sold; every cosmetic is
-- earned (decided, Section 12, question 3). Each account owns a set and
-- equips one per type; the equipped loadout rides in the room state so it is
-- visible to everyone at the table.
--
-- Rendering reuses what already exists: a board cosmetic maps to the board
-- style the scene already draws (which carries its matching pieces). Dice
-- skins, separate piece styles, room themes and reaction packs are catalogued
-- and earnable now; rendering them is a follow-up (new art, and colour-
-- dependent items must pass F5.5's colour-blind checks first).

create table public.cosmetics (
  id text primary key,
  type text not null check (type in ('board', 'piece', 'dice', 'room', 'reaction')),
  name text not null,
  description text not null,
  sort int not null,
  -- Unlock rule: all null means a free default everyone owns. Otherwise the
  -- account must meet the level, hold the achievement, or reach the streak.
  unlock_level int,
  unlock_achievement text references public.achievements(id) on delete set null,
  unlock_streak int
);

alter table public.cosmetics enable row level security;
grant select on public.cosmetics to authenticated, anon;

create table public.player_cosmetics (
  user_id uuid not null references auth.users(id) on delete cascade,
  cosmetic_id text not null references public.cosmetics(id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, cosmetic_id)
);

create index player_cosmetics_user_id_idx on public.player_cosmetics(user_id);
alter table public.player_cosmetics enable row level security;
revoke all on public.player_cosmetics from anon, authenticated;

-- One equipped cosmetic per type per account.
create table public.player_loadout (
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  cosmetic_id text not null references public.cosmetics(id) on delete cascade,
  primary key (user_id, type)
);

alter table public.player_loadout enable row level security;
revoke all on public.player_loadout from anon, authenticated;

insert into public.cosmetics (id, type, name, description, sort, unlock_level, unlock_achievement, unlock_streak) values
  -- Board designs (map to the scene's existing board styles).
  ('board_signature', 'board', 'Signature',   'The house board.',                  10, null, null,          null),
  ('board_classic',   'board', 'Classic',      'The traditional cross board.',      20, 3,    null,          null),
  ('board_geometric', 'board', 'Geometric',    'A clean, modern board.',            30, 8,    null,          null),
  ('board_aladdin',   'board', 'Bazaar',       'A warm, ornate board.',             40, null, 'both_games',  null),
  -- Piece styles.
  ('piece_glass',     'piece', 'Glass',        'Glossy glass pieces.',              50, null, null,          null),
  ('piece_wood',      'piece', 'Wood',         'Turned wooden pieces.',             60, 5,    null,          null),
  ('piece_marble',    'piece', 'Marble',       'Polished marble pieces.',           70, 20,   null,          null),
  -- Dice skins.
  ('dice_classic',    'dice',  'Classic Dice', 'The standard die.',                 80, null, null,          null),
  ('dice_glass',      'dice',  'Glass Dice',   'A glass die.',                      90, 2,    null,          null),
  ('dice_wood',       'dice',  'Wood Dice',    'A wooden die.',                    100, 10,   null,          null),
  ('dice_marble',     'dice',  'Marble Dice',  'A marble die.',                    110, null, null,          7),
  -- Room themes (our 3D advantage).
  ('room_apartment',  'room',  'Apartment',    'The cosy living room.',            120, null, null,          null),
  ('room_cafe',       'room',  'Café',         'A corner café table.',             130, 12,   null,          null),
  ('room_rooftop',    'room',  'Rooftop',      'A rooftop at dusk.',               140, null, 'wins_50',     null),
  ('room_lake',       'room',  'Lake Cabin',   'A cabin by the lake.',             150, null, null,          30),
  -- Reaction packs.
  ('react_basic',     'reaction', 'Basic',     'The starter reactions.',           160, null, null,          null),
  ('react_party',     'reaction', 'Party',     'Livelier reactions.',              170, 6,    null,          null),
  ('react_gg',        'reaction', 'Good Game', 'Sporting reactions.',              180, null, 'games_50',    null);

-- Does the account own this cosmetic — a free default, or one it has unlocked.
create or replace function private.player_has_cosmetic(p_user_id uuid, p_cosmetic_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.cosmetics c
    where c.id = p_cosmetic_id
      and c.unlock_level is null and c.unlock_achievement is null and c.unlock_streak is null
  ) or exists (
    select 1 from public.player_cosmetics pc
    where pc.user_id = p_user_id and pc.cosmetic_id = p_cosmetic_id
  );
$$;

revoke execute on function private.player_has_cosmetic(uuid, text) from public;

-- Grants any non-default cosmetic the account has now earned. Idempotent.
create or replace function private.evaluate_cosmetics(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_level int := coalesce((select level from public.player_progression where user_id = p_user_id), 1);
  v_streak int := coalesce((select longest_streak from public.player_streaks where user_id = p_user_id), 0);
begin
  insert into public.player_cosmetics (user_id, cosmetic_id)
  select p_user_id, c.id
  from public.cosmetics c
  where (c.unlock_level is not null or c.unlock_achievement is not null or c.unlock_streak is not null)
    and (c.unlock_level is null or v_level >= c.unlock_level)
    and (c.unlock_streak is null or v_streak >= c.unlock_streak)
    and (c.unlock_achievement is null or exists (
      select 1 from public.player_achievements pa
      where pa.user_id = p_user_id and pa.achievement_id = c.unlock_achievement
    ))
  on conflict (user_id, cosmetic_id) do nothing;
end;
$$;

revoke execute on function private.evaluate_cosmetics(uuid) from public;

-- Post-match crediting is now done here in order, so each step sees the last
-- one's result: XP/level, then the streak, then achievements (which depend on
-- level and streak), then cosmetics (which depend on all three). This
-- replaces the streak_on_award and achievements_on_award triggers, which ran
-- on the xp_awards insert — before level had even been updated.
drop trigger if exists streak_on_award on public.xp_awards;
drop trigger if exists achievements_on_award on public.xp_awards;

-- Redefines 20260929040000_xp_and_levels.sql's version: after recording the
-- award and updating the level, run the streak, achievement and cosmetic
-- evaluations in dependency order.
create or replace function private.award_match_xp(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg jsonb := private.xp_config();
  v_rule_credit numeric;
  v_day date;
  r record;
  v_other_humans int;
  v_repeats int;
  v_first_win_today boolean;
  v_daily_bonus int;
  v_human_factor numeric;
  v_repeat_factor numeric;
  v_xp int;
  v_inserted int;
begin
  select private.ludo_rule_credit(m.rules), m.ended_at::date
  into v_rule_credit, v_day
  from public.matches m
  where m.id = p_match_id and m.end_reason = 'completed';
  if not found then return; end if;

  for r in
    select user_id, player_id, placement
    from public.match_results
    where match_id = p_match_id
      and account_kind = 'account'
      and user_id is not null
      and placement is not null
      and ended_under_takeover = false
  loop
    select count(*) into v_other_humans
    from public.match_results o
    where o.match_id = p_match_id
      and o.player_id <> r.player_id
      and o.account_kind in ('account', 'guest')
      and o.ended_under_takeover = false;
    v_human_factor := case when v_other_humans = 0
      then (v_cfg->>'computerOnlyFactor')::numeric else 1 end;

    select count(distinct m2.id) into v_repeats
    from public.matches m2
    join public.match_results r2
      on r2.match_id = m2.id and r2.user_id = r.user_id and r2.account_kind = 'account'
    where m2.end_reason = 'completed'
      and m2.id <> p_match_id
      and m2.ended_at::date = v_day
      and exists (
        select 1
        from public.match_results here
        join public.match_results there
          on there.match_id = m2.id and there.user_id = here.user_id
        where here.match_id = p_match_id
          and here.user_id is not null
          and here.user_id <> r.user_id
      );
    v_repeat_factor := greatest(
      (v_cfg->>'minRepeatFactor')::numeric,
      1 - (v_cfg->>'repeatStep')::numeric * v_repeats
    );

    v_first_win_today := false;
    if r.placement = 1 then
      v_first_win_today := not exists (
        select 1
        from public.match_results r3
        join public.matches m3 on m3.id = r3.match_id
        where r3.user_id = r.user_id
          and r3.account_kind = 'account'
          and r3.placement = 1
          and m3.end_reason = 'completed'
          and m3.id <> p_match_id
          and m3.ended_at::date = v_day
      );
    end if;
    v_daily_bonus := case when v_first_win_today
      then (v_cfg->>'dailyFirstWinBonus')::int else 0 end;

    v_xp := round(
      ((v_cfg->>'baseFinish')::numeric
        + case when r.placement = 1 then (v_cfg->>'winBonus')::numeric else 0 end)
      * v_human_factor
      * v_rule_credit
      * v_repeat_factor
      * 1
    )::int + v_daily_bonus;

    insert into public.xp_awards (match_id, user_id, xp, breakdown)
    values (p_match_id, r.user_id, v_xp, jsonb_build_object(
      'placement', r.placement,
      'otherHumans', v_other_humans,
      'humanFactor', v_human_factor,
      'ruleCredit', v_rule_credit,
      'repeats', v_repeats,
      'repeatFactor', v_repeat_factor,
      'dailyFirstWinBonus', v_daily_bonus
    ))
    on conflict (match_id, user_id) do nothing;

    get diagnostics v_inserted = row_count;
    if v_inserted = 1 then
      insert into public.player_progression (user_id, xp, level)
      values (r.user_id, v_xp, private.xp_level_for(v_xp))
      on conflict (user_id) do update
        set xp = public.player_progression.xp + excluded.xp,
            level = private.xp_level_for(public.player_progression.xp + excluded.xp),
            updated_at = now();

      perform private.touch_streak(r.user_id, v_day);
      perform private.evaluate_achievements(r.user_id);
      perform private.evaluate_cosmetics(r.user_id);
    end if;
  end loop;
end;
$$;

revoke execute on function private.award_match_xp(uuid) from public;

-- The full catalog for the signed-in player, with owned/equipped flags and a
-- readable unlock requirement for locked items.
create or replace function public.get_my_cosmetics()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'type', c.type,
    'name', c.name,
    'description', c.description,
    'owned', private.player_has_cosmetic((select auth.uid()), c.id),
    'equipped', exists (
      select 1 from public.player_loadout pl
      where pl.user_id = (select auth.uid()) and pl.cosmetic_id = c.id
    ),
    'requirement', case
      when c.unlock_level is not null then 'Reach level ' || c.unlock_level
      when c.unlock_streak is not null then c.unlock_streak || '-day streak'
      when c.unlock_achievement is not null then
        'Earn “' || (select name from public.achievements a where a.id = c.unlock_achievement) || '”'
      else null
    end
  ) order by c.sort), '[]'::jsonb)
  from public.cosmetics c;
$$;

revoke execute on function public.get_my_cosmetics() from public, anon;
grant execute on function public.get_my_cosmetics() to authenticated;

-- Equips an owned cosmetic (one per type). Rejects anything not yet earned.
create or replace function public.equip_cosmetic(p_cosmetic_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_type text;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select type into v_type from public.cosmetics where id = p_cosmetic_id;
  if v_type is null then raise exception 'NO_SUCH_COSMETIC'; end if;
  if not private.player_has_cosmetic(v_uid, p_cosmetic_id) then
    raise exception 'COSMETIC_LOCKED';
  end if;
  insert into public.player_loadout (user_id, type, cosmetic_id)
  values (v_uid, v_type, p_cosmetic_id)
  on conflict (user_id, type) do update set cosmetic_id = excluded.cosmetic_id;
end;
$$;

revoke execute on function public.equip_cosmetic(text) from public, anon;
grant execute on function public.equip_cosmetic(text) to authenticated;

-- Redefines 20260929040000_xp_and_levels.sql's version: adds each seat's
-- equipped cosmetics (the ids the account has explicitly equipped, or none),
-- so everyone at the table sees them.
CREATE OR REPLACE FUNCTION private.ludo_room_state_json(p_room_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'roomId', r.id, 'hostPlayerId', r.host_player_id, 'code', r.code, 'gameType', r.game_type,
    'status', r.status, 'paused', r.paused_at is not null, 'maxPlayers', r.max_players,
    'pausedForPlayerId', r.paused_for_player_id, 'pausedAt', r.paused_at,
    'rules', private.ludo_resolve_rules(r.rules),
    'matchId', r.current_match_id,
    'isParty', r.is_party, 'partyLocked', r.party_locked,
    'partyTurnSeconds', (private.ludo_resolve_rules(coalesce(nullif(r.match_rules, '{}'::jsonb), r.rules))->>'turnSeconds')::int,
    'matchEndsAt', r.match_ends_at,
    'diceCommitment', (select m.dice_commitment from public.matches m where m.id = r.current_match_id),
    'players', coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'seatIndex', p.seat_index, 'displayName', p.display_name, 'color', p.color,
      'status', p.status, 'isBot', p.is_bot, 'missedDecisionCount', p.missed_decision_count,
      'level', coalesce((select pr.level from public.player_progression pr where pr.user_id = p.user_id), 1),
      'testWalletBalance', p.test_wallet_balance, 'autoRollEnabled', p.auto_roll_enabled,
      'rematchReady', p.rematch_ready, 'inVoice', p.in_voice, 'partyRemote', p.party_remote,
      'hasCaptured', p.has_captured,
      'avatarId', coalesce((select u.raw_user_meta_data ->> 'avatar_id' from auth.users u where u.id = p.user_id), (array['fox','panda','owl','frog'])[p.seat_index + 1]),
      'country', coalesce((select u.raw_user_meta_data ->> 'country' from auth.users u where u.id = p.user_id), ''),
      'cosmetics', coalesce((select jsonb_object_agg(pl.type, pl.cosmetic_id)
        from public.player_loadout pl where pl.user_id = p.user_id), '{}'::jsonb)
    ) order by p.seat_index) from public.players p where p.room_id = r.id), '[]'::jsonb),
    'pawns', private.ludo_room_pawns_json(r.id), 'turnPlayerId', r.turn_player_id,
    'turnPhase', r.turn_phase, 'turnDeadlineAt', r.turn_deadline_at, 'rollsThisTurn', r.rolls_this_turn,
    'activeDiceValue', r.active_dice_value, 'consecutiveSixes', r.consecutive_sixes,
    'legalMoves', case when r.game_type = 'ludo' and r.turn_phase = 'awaiting_move' and r.turn_player_id is not null and r.active_dice_value is not null then private.ludo_legal_moves(private.ludo_room_pawns_json(r.id), (select color from public.players where id = r.turn_player_id), r.active_dice_value, r.match_rules, (select has_captured from public.players where id = r.turn_player_id)) else '[]'::jsonb end,
    'winnerIds', coalesce(to_jsonb(r.winner_ids), '[]'::jsonb), 'matchEndReason', r.match_end_reason,
    'eventSequence', r.event_sequence
  ) from public.rooms r where r.id = p_room_id;
$function$;
revoke execute on function private.ludo_room_state_json(uuid) from public;
