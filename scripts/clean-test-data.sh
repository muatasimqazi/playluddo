#!/bin/bash
# Deletes the accounts the integration tests create, and every table they sat
# at, without touching what the game runs on. With --everything, deletes every
# account and every table instead: a fresh start.
#
#   npm run db:clean-test-data                          # preview, local database
#   npm run db:clean-test-data -- --apply               # delete, local database
#   npm run db:clean-test-data -- --everything          # preview a fresh start
#   DATABASE_URL=postgresql://… npm run db:clean-test-data -- --everything --apply
#
# A test account is one with a test email: @test.local, @example.test, or
# test@test.com. Deleting its rooms takes their seats, pieces, matches, events,
# results, chat, casts and watchers with them; deleting the account takes its
# progress, streaks, cosmetics, friends and teams. Rooms go first: an account's
# seats outlive it (players.user_id is ON DELETE SET NULL), which would leave
# tables with nobody behind them.
#
# The catalog the migrations create (achievements, cosmetics, feature flags,
# the push dispatcher's state) is never touched, in either mode. Without
# --everything, guest (anonymous) accounts are never deleted: real players are
# guests too, and nothing tells a test guest from a real one. A real player
# who shared a table with a test account loses that match.
#
# --everything also checks that nothing but the catalog is left, and deletes
# nothing if anything is. Uploaded avatar photos are files, which Supabase
# only lets the Storage API delete: remove them in the dashboard (Storage →
# avatar-photos).
#
# Without --apply it runs everything in a transaction, reports what it would
# delete, and rolls back.
set -euo pipefail

APPLY=false
EVERYTHING=false
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=true ;;
    --everything) EVERYTHING=true ;;
    *) echo "Unknown option: $arg (supported: --apply, --everything)" >&2; exit 2 ;;
  esac
done

DB_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
host=$(sed -E 's#^[a-z]+://([^@/]*@)?([^:/?]+).*#\2#' <<<"$DB_URL")
if [[ "$host" == *@* ]]; then
  echo "DATABASE_URL has more than one @. If the password contains @, write it as %40." >&2
  exit 2
fi
echo "Database: $host"
if $APPLY && $EVERYTHING; then
  read -r -p "This deletes every account and every game. Type DELETE EVERYTHING to go on: " answer
  [[ "$answer" == "DELETE EVERYTHING" ]] || { echo "Cancelled." >&2; exit 1; }
fi
if $APPLY && [[ "$host" != "127.0.0.1" && "$host" != "localhost" ]]; then
  read -r -p "This is not a local database. Type the host name to delete data there: " answer
  [[ "$answer" == "$host" ]] || { echo "Cancelled." >&2; exit 1; }
fi

psql "$DB_URL" -v ON_ERROR_STOP=1 -q \
  -v finish="$($APPLY && echo commit || echo rollback)" \
  -v everything="$EVERYTHING" <<'SQL'
begin;
create temp table doomed_users on commit drop as
  select id from auth.users
  where :everything
    or email like '%@test.local' or email like '%@example.test' or email = 'test@test.com';
create temp table doomed_rooms on commit drop as
  select id from public.rooms r
  where :everything or exists (
    select 1 from public.players p where p.room_id = r.id and p.user_id in (select id from doomed_users));

select (select count(*) from doomed_users) as accounts,
  (select count(*) from doomed_rooms) as rooms,
  (select count(*) from public.matches where room_id in (select id from doomed_rooms)) as matches,
  (select count(*) from public.match_events where room_id in (select id from doomed_rooms)) as match_events;

delete from public.tournaments where :everything or created_by_user_id in (select id from doomed_users);
delete from public.rooms where id in (select id from doomed_rooms);
\if :everything
-- What outlives its account or room (ON DELETE SET NULL), or belongs to no one.
delete from public.teams;
delete from public.player_reports;
delete from public.team_season_champions;
delete from public.matches;
\endif
delete from auth.users where id in (select id from doomed_users);

\if :everything
do $$
declare
  t record;
  n bigint;
  leftovers text := '';
begin
  for t in
    select ns.nspname as schema_name, c.relname as table_name
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname in ('public', 'private') and c.relkind in ('r', 'p') and not c.relispartition
      and (ns.nspname, c.relname) not in (
        ('public', 'achievements'), ('public', 'cosmetics'),
        ('private', 'feature_flags'), ('private', 'push_dispatch_state'))
  loop
    execute format('select count(*) from %I.%I', t.schema_name, t.table_name) into n;
    if n > 0 then leftovers := leftovers || format(' %s.%s (%s)', t.schema_name, t.table_name, n); end if;
  end loop;
  if leftovers <> '' then
    raise exception 'Player data would be left behind, so nothing was deleted:%', leftovers;
  end if;
end $$;
select count(*) as avatar_photos_to_delete_in_dashboard
from storage.objects where bucket_id = 'avatar-photos';
\endif

:finish;
SQL

if $APPLY; then echo "Deleted the above."; else echo "Preview only, nothing deleted. Run again with --apply to delete."; fi
