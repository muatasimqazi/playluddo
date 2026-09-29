-- Team seasons (docs/COMPETITIVE_ROADMAP.md F4.2). Weekly standings for each
-- private team, built from match_results, plus a persisted champion per closed
-- week so profiles can show champion badges.
--
-- A "season" is an ISO week (Monday-Sunday) in UTC. Standings are derived live
-- from match_results (immutable once written), so any past week is
-- reproducible; we still persist each closed week's champion so a member's
-- titles survive team membership changes and are cheap to look up. Champions
-- are recorded lazily -- the first time a closed week is read -- so no
-- scheduler is required.

create table public.team_season_champions (
  team_id uuid not null references public.teams(id) on delete cascade,
  -- Monday (UTC) of the champion's ISO week.
  season_start date not null,
  -- The account behind the title, kept for the badge if they later leave.
  user_id uuid references auth.users(id) on delete set null,
  display_name text not null,
  avatar_id text,
  wins int not null,
  played int not null,
  decided_at timestamptz not null default now(),
  primary key (team_id, season_start)
);

create index team_season_champions_user_id_idx on public.team_season_champions(user_id);

alter table public.team_season_champions enable row level security;
revoke all on public.team_season_champions from anon, authenticated;

-- Monday (UTC) of the current ISO week, as a date.
create or replace function private.team_current_week()
returns date
language sql
stable
set search_path = ''
as $$
  select (date_trunc('week', (now() at time zone 'UTC')))::date;
$$;

revoke execute on function private.team_current_week() from public;

-- Every team member who played a completed match in a team room during the
-- given week, ranked by wins (then by win rate, i.e. fewer games for the same
-- wins). Only real accounts count; guests and computers at the table do not.
create or replace function private.team_season_standings(p_team_id uuid, p_week_start date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select
      (p_week_start::timestamp at time zone 'UTC') as starts_at,
      ((p_week_start + 7)::timestamp at time zone 'UTC') as ends_at
  ),
  tallies as (
    select
      r.user_id,
      count(*) as played,
      count(*) filter (where r.placement = 1) as wins
    from public.match_results r
    join public.matches m on m.id = r.match_id
    join public.rooms ro on ro.id = m.room_id
    join public.team_members tm on tm.team_id = p_team_id and tm.user_id = r.user_id
    cross join bounds b
    where ro.team_id = p_team_id
      and m.end_reason = 'completed'
      and m.ended_at >= b.starts_at
      and m.ended_at < b.ends_at
      and r.account_kind = 'account'
      and r.placement is not null
    group by r.user_id
  ),
  ranked as (
    select
      t.user_id, t.wins, t.played,
      row_number() over (order by t.wins desc, t.played asc, t.user_id) as rank
    from tallies t
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'rank', ranked.rank,
    'userId', ranked.user_id,
    'displayName', private.clean_text(
      coalesce(u.raw_user_meta_data ->> 'display_name', tm.display_name, 'Player')),
    'avatarId', coalesce(u.raw_user_meta_data ->> 'avatar_id', tm.avatar_id),
    'wins', ranked.wins,
    'played', ranked.played
  ) order by ranked.rank), '[]'::jsonb)
  from ranked
  join public.team_members tm on tm.team_id = p_team_id and tm.user_id = ranked.user_id
  join auth.users u on u.id = ranked.user_id;
$$;

revoke execute on function private.team_season_standings(uuid, date) from public;

-- Records the champion of a closed week, once. A no-op for the current (open)
-- week, for an already-recorded week, or for a week with no completed matches.
create or replace function private.team_season_finalize(p_team_id uuid, p_week_start date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_top jsonb;
begin
  if p_week_start >= private.team_current_week() then return; end if;
  if exists (
    select 1 from public.team_season_champions
    where team_id = p_team_id and season_start = p_week_start
  ) then return; end if;

  v_top := private.team_season_standings(p_team_id, p_week_start) -> 0;
  if v_top is null or coalesce((v_top ->> 'wins')::int, 0) = 0 then return; end if;

  insert into public.team_season_champions
    (team_id, season_start, user_id, display_name, avatar_id, wins, played)
  values (
    p_team_id, p_week_start,
    (v_top ->> 'userId')::uuid,
    v_top ->> 'displayName',
    v_top ->> 'avatarId',
    (v_top ->> 'wins')::int,
    (v_top ->> 'played')::int
  )
  on conflict (team_id, season_start) do nothing;
end;
$$;

revoke execute on function private.team_season_finalize(uuid, date) from public;

-- A team's season for a given week: 0 = the current week, 1 = last week, and so
-- on. Reading a closed week records its champion. Team members only.
create or replace function public.get_team_season(p_team_id uuid, p_weeks_ago int default 0)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_week_start date;
  v_champion jsonb;
begin
  if v_user_id is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_weeks_ago is null or p_weeks_ago < 0 or p_weeks_ago > 520 then
    raise exception 'INVALID_WEEK';
  end if;
  if not exists (
    select 1 from public.team_members where team_id = p_team_id and user_id = v_user_id
  ) then raise exception 'NOT_TEAM_MEMBER'; end if;

  v_week_start := private.team_current_week() - (p_weeks_ago * 7);

  if p_weeks_ago > 0 then
    perform private.team_season_finalize(p_team_id, v_week_start);
    select jsonb_build_object(
      'userId', c.user_id,
      'displayName', c.display_name,
      'avatarId', c.avatar_id,
      'wins', c.wins,
      'played', c.played
    ) into v_champion
    from public.team_season_champions c
    where c.team_id = p_team_id and c.season_start = v_week_start;
  end if;

  return jsonb_build_object(
    'seasonStart', v_week_start,
    'seasonEnd', v_week_start + 6,
    'isCurrent', p_weeks_ago = 0,
    'standings', private.team_season_standings(p_team_id, v_week_start),
    'champion', v_champion
  );
end;
$$;

revoke execute on function public.get_team_season(uuid, int) from public, anon;
grant execute on function public.get_team_season(uuid, int) to authenticated;

-- The caller's own champion titles, newest first, for profile badges.
create or replace function public.get_my_season_titles()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'teamId', c.team_id,
    'teamName', t.name,
    'seasonStart', c.season_start,
    'wins', c.wins,
    'played', c.played
  ) order by c.season_start desc), '[]'::jsonb)
  from public.team_season_champions c
  join public.teams t on t.id = c.team_id
  where c.user_id = (select auth.uid());
$$;

revoke execute on function public.get_my_season_titles() from public, anon;
grant execute on function public.get_my_season_titles() to authenticated;
