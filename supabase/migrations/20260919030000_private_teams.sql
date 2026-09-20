create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 32),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  invite_code text not null unique default upper(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 10)),
  created_at timestamptz not null default now()
);

create table public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  display_name text not null,
  avatar_id text,
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create index team_members_user_id_idx on public.team_members(user_id);

alter table public.teams enable row level security;
alter table public.team_members enable row level security;

revoke all on public.teams, public.team_members from anon, authenticated;

create or replace function private.luddo_my_teams_json(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id,
    'name', t.name,
    'inviteCode', t.invite_code,
    'ownerUserId', t.owner_user_id,
    'createdAt', t.created_at,
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', tm.user_id,
        'role', tm.role,
        'displayName', tm.display_name,
        'avatarId', tm.avatar_id,
        'joinedAt', tm.joined_at
      ) order by case when tm.role = 'owner' then 0 else 1 end, tm.joined_at)
      from public.team_members tm where tm.team_id = t.id
    ), '[]'::jsonb)
  ) order by t.created_at), '[]'::jsonb)
  from public.teams t
  join public.team_members mine on mine.team_id = t.id
  where mine.user_id = p_user_id;
$$;

revoke execute on function private.luddo_my_teams_json(uuid) from public;

create or replace function public.get_my_teams()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'UNAUTHENTICATED'; end if;
  return private.luddo_my_teams_json((select auth.uid()));
end;
$$;

create or replace function public.create_team(
  p_name text,
  p_display_name text,
  p_avatar_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_team_id uuid; v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then raise exception 'UNAUTHENTICATED'; end if;
  if char_length(btrim(p_name)) not between 2 and 32 then raise exception 'INVALID_TEAM_NAME'; end if;
  insert into public.teams(name, owner_user_id)
  values (btrim(p_name), v_user_id) returning id into v_team_id;
  insert into public.team_members(team_id, user_id, role, display_name, avatar_id)
  values (v_team_id, v_user_id, 'owner', left(coalesce(nullif(btrim(p_display_name), ''), 'Player'), 24), nullif(p_avatar_id, ''));
  return private.luddo_my_teams_json(v_user_id);
end;
$$;

create or replace function public.join_team(
  p_invite_code text,
  p_display_name text,
  p_avatar_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_team_id uuid; v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then raise exception 'UNAUTHENTICATED'; end if;
  select id into v_team_id from public.teams where invite_code = upper(btrim(p_invite_code));
  if v_team_id is null then raise exception 'TEAM_NOT_FOUND'; end if;
  insert into public.team_members(team_id, user_id, role, display_name, avatar_id)
  values (v_team_id, v_user_id, 'member', left(coalesce(nullif(btrim(p_display_name), ''), 'Player'), 24), nullif(p_avatar_id, ''))
  on conflict (team_id, user_id) do update
    set display_name = excluded.display_name, avatar_id = excluded.avatar_id;
  return private.luddo_my_teams_json(v_user_id);
end;
$$;

create or replace function public.leave_team(p_team_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid := (select auth.uid()); v_owner_id uuid;
begin
  if v_user_id is null then raise exception 'UNAUTHENTICATED'; end if;
  select owner_user_id into v_owner_id from public.teams where id = p_team_id;
  if v_owner_id is null or not exists (
    select 1 from public.team_members where team_id = p_team_id and user_id = v_user_id
  ) then raise exception 'TEAM_NOT_FOUND'; end if;
  if v_owner_id = v_user_id then
    delete from public.teams where id = p_team_id;
  else
    delete from public.team_members where team_id = p_team_id and user_id = v_user_id;
  end if;
  return private.luddo_my_teams_json(v_user_id);
end;
$$;

revoke execute on function public.get_my_teams() from public, anon;
revoke execute on function public.create_team(text,text,text) from public, anon;
revoke execute on function public.join_team(text,text,text) from public, anon;
revoke execute on function public.leave_team(uuid) from public, anon;
grant execute on function public.get_my_teams() to authenticated;
grant execute on function public.create_team(text,text,text) to authenticated;
grant execute on function public.join_team(text,text,text) to authenticated;
grant execute on function public.leave_team(uuid) to authenticated;
