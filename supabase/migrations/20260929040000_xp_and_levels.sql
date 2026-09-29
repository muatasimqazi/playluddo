-- XP and levels (docs/COMPETITIVE_ROADMAP.md F3.2, Section 15 R1, R10).
--
-- XP is earned only on the server, only from completed online matches the
-- server recorded (match_results, F0.3). It follows the phase's "What counts"
-- rules: a seat played mostly by the takeover computer or that quit earns
-- nothing (those rows have a null placement or ended_under_takeover); games
-- against only computers earn reduced credit; trivially short rule sets earn
-- reduced credit; and credit tails off across repeat games with the same
-- opponents in a day. A daily first-win bonus rewards coming back.
--
-- Every award is keyed on (match_id, user_id), so a retried or duplicated
-- match completion never pays twice. The tuning constants below live in one
-- place (xp_config, ludo_rule_credit) so R10 can adjust them from data.
--
-- "More for playing with friends" waits on the friend graph (F3.6): the
-- friend factor is a hook that stays 1.0 until then.

create table public.player_progression (
  user_id uuid primary key references auth.users(id) on delete cascade,
  xp bigint not null default 0,
  level int not null default 1,
  updated_at timestamptz not null default now()
);

alter table public.player_progression enable row level security;
revoke all on public.player_progression from anon, authenticated;

-- One row per account per match it earned from — the idempotency key and an
-- audit trail of how the number was reached.
create table public.xp_awards (
  match_id uuid not null references public.matches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  xp int not null,
  breakdown jsonb not null,
  created_at timestamptz not null default now(),
  primary key (match_id, user_id)
);

create index xp_awards_user_id_idx on public.xp_awards(user_id);
alter table public.xp_awards enable row level security;
revoke all on public.xp_awards from anon, authenticated;

-- Tunable constants (R10). Kept as data so the numbers can move without a
-- code change to the award logic.
create or replace function private.xp_config()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'baseFinish', 50,          -- for completing a game
    'winBonus', 100,           -- added on top for first place
    'dailyFirstWinBonus', 100, -- once a day, on the day's first win
    'computerOnlyFactor', 0.25,-- games with no other human at the table
    'repeatStep', 0.2,         -- credit lost per prior same-opponent game today
    'minRepeatFactor', 0.2     -- floor the repeat tail-off can't go below
  );
$$;
revoke execute on function private.xp_config() from public;

-- Credit multiplier for a match's (already resolved) rules. Shorter games
-- earn less: fewer pawns to win, or pieces that start on the board. Lives
-- beside the F2.4 presets/allow-list, as decided. Snakes & Ladders has no
-- pawnsToWin, so it defaults to full credit.
create or replace function private.ludo_rule_credit(p_rules jsonb)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select greatest(0.4, least(1.0,
    coalesce((p_rules->>'pawnsToWin')::numeric, 4) / 4
  )) * case when coalesce((p_rules->>'startOnBoard')::int, 0) > 0 then 0.85 else 1 end;
$$;
revoke execute on function private.ludo_rule_credit(jsonb) from public;

-- A triangular curve: level L is reached at 100 * L*(L-1)/2 XP, so level 2 at
-- 100, level 3 at 300, level 4 at 600, and so on.
create or replace function private.xp_level_for(p_xp bigint)
returns int
language sql
immutable
set search_path = ''
as $$
  select greatest(1, floor((1 + sqrt(1 + 8 * (p_xp::numeric / 100))) / 2))::int;
$$;
revoke execute on function private.xp_level_for(bigint) from public;

-- Awards XP for one finished match, once per eligible seat. Called from
-- finalize_match after the results are written. Only 'account' seats that
-- actually finished the match under their own control earn.
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
  -- Only completed matches pay. Abandoned matches leave null placements.
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
    -- Was there another human (account or guest) at the table who saw the
    -- game through, rather than only computers?
    select count(*) into v_other_humans
    from public.match_results o
    where o.match_id = p_match_id
      and o.player_id <> r.player_id
      and o.account_kind in ('account', 'guest')
      and o.ended_under_takeover = false;
    v_human_factor := case when v_other_humans = 0
      then (v_cfg->>'computerOnlyFactor')::numeric else 1 end;

    -- How many earlier games today shared an opponent with this one.
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

    -- The day's first win earns a flat bonus on top.
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
      -- Friend factor (F3.6) goes here; 1.0 until the friend graph exists.
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
    end if;
  end loop;
end;
$$;

revoke execute on function private.award_match_xp(uuid) from public;

-- Redefines 20260928050000_match_stats.sql's version: award XP once the
-- match's results have been written.
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

  perform private.award_match_xp(new.current_match_id);

  return new;
end;
$$;

revoke execute on function private.finalize_match() from public;

-- Redefines 20260928240100_turn_timer_source.sql's version: a seat's level
-- now comes from the account's progression, not the static players.level
-- placeholder. Falls back to 1 for guests, bots and new accounts.
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
      'country', coalesce((select u.raw_user_meta_data ->> 'country' from auth.users u where u.id = p.user_id), '')
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

-- Expose the account's own XP and level, and level for the profile stats.
-- Redefines 20260929030000_player_profile.sql's profile_stats to add them.
create or replace function private.profile_stats(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select r.match_id, r.color, r.placement, r.stats, m.game_type
    from public.match_results r
    join public.matches m on m.id = r.match_id and m.end_reason = 'completed'
    where r.user_id = p_user_id
      and r.account_kind = 'account'
      and r.placement is not null
  ),
  by_mode as (
    select game_type,
      count(*) as games,
      count(*) filter (where placement = 1) as wins
    from mine group by game_type
  ),
  rivals as (
    select o.user_id,
      count(*) as games,
      count(*) filter (where me.placement < o.placement) as wins
    from mine me
    join public.match_results o
      on o.match_id = me.match_id
      and o.user_id is not null
      and o.user_id <> p_user_id
      and o.account_kind = 'account'
      and o.placement is not null
    group by o.user_id
    order by games desc, wins desc
    limit 5
  )
  select jsonb_build_object(
    'xp', coalesce((select xp from public.player_progression where user_id = p_user_id), 0),
    'level', coalesce((select level from public.player_progression where user_id = p_user_id), 1),
    'gamesPlayed', (select count(*) from mine),
    'wins', (select count(*) filter (where placement = 1) from mine),
    'winRateByMode', coalesce((
      select jsonb_agg(jsonb_build_object('mode', game_type, 'games', games, 'wins', wins)
        order by games desc)
      from by_mode
    ), '[]'::jsonb),
    'totalCaptures', (select coalesce(sum((stats->>'capturesMade')::int), 0) from mine),
    'totalSixes', (select coalesce(sum((stats->>'sixes')::int), 0) from mine),
    'favouriteColour', (select mode() within group (order by color) from mine),
    'bestComeback', (
      select coalesce(max((stats->>'longestRunWithoutSix')::int), 0)
      from mine where placement = 1
    ),
    'headToHead', coalesce((
      select jsonb_agg(jsonb_build_object(
        'displayName', coalesce(u.raw_user_meta_data ->> 'display_name', 'Player'),
        'avatarId', u.raw_user_meta_data ->> 'avatar_id',
        'games', rv.games,
        'wins', rv.wins
      ) order by rv.games desc, rv.wins desc)
      from rivals rv
      join auth.users u on u.id = rv.user_id
    ), '[]'::jsonb)
  );
$$;

revoke execute on function private.profile_stats(uuid) from public;
