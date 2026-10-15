#!/bin/sh
# Statement statistics for the deployment's database (pg_stat_statements).
#
#   deploy/query-stats.sh status                 what is loaded, installed and tracked
#   deploy/query-stats.sh enable                 load it (restarts postgres once) and install it
#   deploy/query-stats.sh install                install it where it is loaded; never restarts
#   deploy/query-stats.sh planning on|off        count planning separately, or stop; no restart
#   deploy/query-stats.sh report [plan|exec|calls] [limit]
#   deploy/query-stats.sh window <seconds> [plan|exec|calls] [limit]
#
# The setting lives in the cluster, not in compose.yaml: upgrade.sh runs
# `up -d postgres` with each release's compose file, so a changed postgres
# command would recreate the database in the middle of an upgrade, while the
# old color serves. ALTER SYSTEM writes postgresql.auto.conf in the data
# volume, which every release's container reads and none rewrites; a restore
# into the same volume keeps it, and the extension travels in the dump.
#
# `enable` appends to shared_preload_libraries (it never replaces what is
# there), refuses when the command line sets that list (ALTER SYSTEM would be
# overridden there), restarts the postgres service alone - not the colors, not
# the project - and installs the extension in a schema of its own, monitoring,
# outside the application's. Planning is counted too
# (pg_stat_statements.track_planning): today's slow queries were slow to plan,
# not to run, and only the server can tell the two apart. It costs something
# when many connections plan the same statement at once; `planning off` stops
# it on a reload and leaves the rest running.
#
# `install` is the half that needs no restart, for a database made afresh
# from a dump that does not carry the extension (demo/restore.sh calls it):
# where the library is not loaded it says so and changes nothing.
#
# report and window only read. A window takes a snapshot, waits, and shows the
# differences - the way to look at a period without resetting what everyone
# else's counts are measured from. Plans and calls are shown apart: a
# statement planned once and run many times, or the other way round, says so.
#
# Run from the release's deploy/ directory with the deployment's env file,
# e.g. QUALY_ENV_FILE=/opt/qualy/.env /opt/qualy/current/deploy/query-stats.sh status
set -eu

here=$(cd "$(dirname "$0")" && pwd)
. "$here/lib.sh"

[ -f "$env_file" ] || refuse "no $env_file"

psql_in() {
  compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -X -v ON_ERROR_STOP=1 "$@"' psql "$@"
}

order_of() {
  case "${1:-exec}" in
    plan) printf 'total_plan_time' ;;
    exec) printf 'total_exec_time' ;;
    calls) printf 'calls' ;;
    *) refuse "order by plan, exec or calls, not $1" ;;
  esac
}

limit_of() {
  case "${1:-20}" in
    '' | *[!0-9]*) refuse "the limit is a whole number, not $1" ;;
    *) printf '%s' "${1:-20}" ;;
  esac
}

status() {
  psql_in -At -F ' = ' <<'SQL'
select 'loaded', (current_setting('shared_preload_libraries') ~ '(^|,)\s*pg_stat_statements\s*(,|$)')::text;
select 'installed', coalesce((select extversion || ' in ' || n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_stat_statements'), 'no');
select 'shared_preload_libraries', current_setting('shared_preload_libraries') || ' (' || source || ')' from pg_settings where name = 'shared_preload_libraries';
select 'compute_query_id', current_setting('compute_query_id');
select 'track_planning', coalesce(current_setting('pg_stat_statements.track_planning', true), 'unknown until loaded');
SQL
}

enable() {
  take_lock
  trap release_lock EXIT
  local current source next
  current=$(psql_in -At -c "select setting from pg_settings where name = 'shared_preload_libraries'")
  source=$(psql_in -At -c "select source from pg_settings where name = 'shared_preload_libraries'")
  [ "$source" = 'command line' ] &&
    refuse "shared_preload_libraries is set on the postgres command line ($current); add pg_stat_statements there instead"
  case ",$(printf '%s' "$current" | tr -d ' ')," in
    *,pg_stat_statements,*) next= ;;
    ,,) next=pg_stat_statements ;;
    *) next="$current,pg_stat_statements" ;;
  esac
  if [ -n "$next" ]; then
    say "shared_preload_libraries: '${current}' -> '${next}'"
    psql_in -c "alter system set shared_preload_libraries = '$next'"
    psql_in -c "alter system set pg_stat_statements.track_planning = on"
    say "restarting postgres alone to load it"
    compose restart -t 60 postgres
    compose up -d --wait --no-recreate postgres
  else
    say "pg_stat_statements is already in shared_preload_libraries"
  fi
  install
  status
}

install() {
  local loaded
  loaded=$(psql_in -At -c "select current_setting('shared_preload_libraries') ~ '(^|,)\s*pg_stat_statements\s*(,|$)'")
  if [ "$loaded" != t ]; then
    say "pg_stat_statements is not loaded; nothing installed (deploy/query-stats.sh enable loads it)"
    return 0
  fi
  psql_in -q -c 'create schema if not exists monitoring' \
    -c 'create extension if not exists pg_stat_statements with schema monitoring'
}

planning() {
  case "${1:-}" in
    on | off) ;;
    *) refuse "usage: deploy/query-stats.sh planning on|off" ;;
  esac
  psql_in -c "alter system set pg_stat_statements.track_planning = $1" -c 'select pg_reload_conf()' > /dev/null
  status
}

report() {
  local order limit
  order=$(order_of "${1:-exec}")
  limit=$(limit_of "${2:-20}")
  psql_in -P pager=off <<SQL
select queryid, calls, plans,
       round(total_plan_time::numeric, 1) as plan_ms, round(mean_plan_time::numeric, 2) as plan_mean_ms,
       round(total_exec_time::numeric, 1) as exec_ms, round(mean_exec_time::numeric, 2) as exec_mean_ms,
       rows, left(regexp_replace(query, '\s+', ' ', 'g'), 160) as query
  from monitoring.pg_stat_statements
 where dbid = (select oid from pg_database where datname = current_database())
 order by $order desc
 limit $limit;
select (select dealloc from monitoring.pg_stat_statements_info) as evicted,
       (select stats_reset from monitoring.pg_stat_statements_info) as counting_since;
SQL
}

window() {
  local seconds order limit
  case "${1:-}" in
    '' | *[!0-9]* | 0) refuse "usage: deploy/query-stats.sh window <seconds> [plan|exec|calls] [limit]" ;;
  esac
  seconds=$1
  order=$(order_of "${2:-exec}")
  limit=$(limit_of "${3:-20}")
  say "counting for ${seconds}s"
  psql_in -P pager=off <<SQL
create temporary table before as
  select userid, dbid, queryid, toplevel, calls, plans, total_plan_time, total_exec_time, rows
    from monitoring.pg_stat_statements;
select pg_sleep($seconds) \gset
select now.queryid,
       now.calls - coalesce(b.calls, 0) as calls,
       now.plans - coalesce(b.plans, 0) as plans,
       round((now.total_plan_time - coalesce(b.total_plan_time, 0))::numeric, 1) as plan_ms,
       round((now.total_exec_time - coalesce(b.total_exec_time, 0))::numeric, 1) as exec_ms,
       now.rows - coalesce(b.rows, 0) as rows,
       left(regexp_replace(now.query, '\s+', ' ', 'g'), 160) as query
  from monitoring.pg_stat_statements now
  left join before b using (userid, dbid, queryid, toplevel)
 where now.dbid = (select oid from pg_database where datname = current_database())
   and now.calls > coalesce(b.calls, 0)
 order by (case '$order'
             when 'calls' then (now.calls - coalesce(b.calls, 0))::double precision
             when 'total_plan_time' then now.total_plan_time - coalesce(b.total_plan_time, 0)
             else now.total_exec_time - coalesce(b.total_exec_time, 0)
           end) desc
 limit $limit;
SQL
}

command=${1:-}
[ $# -gt 0 ] && shift
case "$command" in
  status) status ;;
  enable) enable ;;
  install) install ;;
  planning) planning "$@" ;;
  report) report "$@" ;;
  window) window "$@" ;;
  *) refuse "usage: deploy/query-stats.sh status | enable | install | planning on|off | report [plan|exec|calls] [limit] | window <seconds> [plan|exec|calls] [limit]" ;;
esac
