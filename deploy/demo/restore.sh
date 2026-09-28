#!/bin/sh
# Puts a demonstration deployment back to its baseline.
#
#   deploy/demo/restore.sh [baseline-dir]
#
# Runs from anywhere: it drives deploy/compose.yaml beside this script's
# directory, with that directory's .env. The baseline directory (default
# /opt/qualy/demo-baseline) holds qualy-demo.dump and storage.tar.gz, made by
# `pnpm demo:snapshot`. Also the first import: with only postgres up, it
# creates everything else.
#
# The order keeps the site up for as long as it can and never half-restored:
#
#   1. the dump goes into a scratch database while the server still serves
#   2. the server stops (the edge shows its maintenance page)
#   3. the scratch database takes the live one's name; the live one is kept
#      as <name>_previous until the next restore
#   4. the attachments are unpacked beside the old ones, then swapped in
#   5. the release's migrations bring the baseline up to the running image
#   6. the five accounts that sign in with a password - the administrator
#      and the four demonstration people - are given this deployment's own
#      passwords, from .env: a baseline carries the ones it was generated
#      with, and those are not this deployment's
#   7. the serving color starts again (the first import starts blue), and
#      the script waits for it
#
# A failure before step 2 leaves the site as it was. A failure after it
# stops with the step named; running the script again finishes the job.
set -eu

here=$(cd "$(dirname "$0")/.." && pwd)
. "$here/lib.sh"
baseline=${1:-/opt/qualy/demo-baseline}

# who signs in with a password in the baseline, and where .env keeps the
# password this deployment gives them (tools/demo/seed.ts, seed/personas.ts)
ACCOUNTS='admin@demo.example.edu QUALY_BASELINE_PASSWORD_ADMIN
student@demo.qualy.example QUALY_BASELINE_PASSWORD_STUDENT
class-lead@demo.qualy.example QUALY_BASELINE_PASSWORD_CLASS_LEAD
counsellor@demo.qualy.example QUALY_BASELINE_PASSWORD_COUNSELLOR
assessment-lead@demo.qualy.example QUALY_BASELINE_PASSWORD_LEAD'

# The database commands run inside the postgres container, which already
# knows the deployment's user and database: .env is compose's to read, and a
# value in it (a sender like `Name <addr>`) need not be valid shell.
in_postgres() {
  compose exec -T postgres sh -c "$1"
}

[ -f "$env_file" ] || refuse "no $env_file"
[ -f "$baseline/qualy-demo.dump" ] || refuse "no $baseline/qualy-demo.dump"
[ -f "$baseline/storage.tar.gz" ] || refuse "no $baseline/storage.tar.gz"
release=$(env_get QUALY_RELEASE)
[ -n "$release" ] || refuse "no QUALY_RELEASE in $env_file: which release runs the baseline?"
# every password is there before the site goes down, not found missing after
unset_passwords=$(printf '%s\n' "$ACCOUNTS" | while read -r email variable; do
  [ -n "$(env_get "$variable")" ] || printf '%s ' "$variable"
done)
[ -z "$unset_passwords" ] || refuse "set these in $env_file first: $unset_passwords"
# One deployment step at a time - two restores would drop each other's
# scratch database, and an upgrade beside one would move the edge under it -
# and the record of what serves checked against the edge first (lib.sh), a
# stopped color included: a reset that stopped halfway is finished by
# running it again.
take_lock
step="starting"
finish() {
  status=$?
  release_lock
  if [ "$status" -ne 0 ]; then
    echo "restore failed while $step; run it again to finish" >&2
  fi
}
trap finish EXIT
reconcile --stopped-ok
active=$(env_get QUALY_ACTIVE_COLOR)

step="starting the database"
compose up -d --wait postgres

step="restoring the dump into a scratch database"
echo "$step"
in_postgres 'dropdb -U "$POSTGRES_USER" --if-exists --force "${POSTGRES_DB}_restore" &&
  createdb -U "$POSTGRES_USER" "${POSTGRES_DB}_restore"'
compose exec -T postgres sh -c \
  'pg_restore -U "$POSTGRES_USER" -d "${POSTGRES_DB}_restore" --no-owner --no-acl --exit-on-error' \
  < "$baseline/qualy-demo.dump"

step="stopping the serving color"
echo "$step"
if [ -n "$active" ]; then compose stop -t 40 $(color_services "$active"); fi

step="swapping the restored database in"
echo "$step"
compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 \
  -v live="$POSTGRES_DB" -v previous="${POSTGRES_DB}_previous" -v restored="${POSTGRES_DB}_restore"' <<'SQL'
select pg_terminate_backend(pid) from pg_stat_activity
 where datname in (:'live', :'previous') and pid <> pg_backend_pid();
drop database if exists :"previous";
select exists (select 1 from pg_database where datname = :'live') as has_live \gset
\if :has_live
alter database :"live" rename to :"previous";
\endif
alter database :"restored" rename to :"live";
SQL

step="restoring the attachments"
echo "$step"
# The server image, as root, on the storage volume: the volume is found by
# its role in compose.yaml rather than by a project-prefixed name.
compose run --rm --no-deps -T --user 0:0 --entrypoint sh \
  -v "$baseline:/in:ro" tools -c '
    set -eu
    root=/var/lib/qualy/storage
    rm -rf "$root/.incoming"
    mkdir "$root/.incoming"
    tar -xzf /in/storage.tar.gz -C "$root/.incoming"
    find "$root" -mindepth 1 -maxdepth 1 ! -name .incoming -exec rm -rf {} +
    find "$root/.incoming" -mindepth 1 -maxdepth 1 -exec mv {} "$root/" \;
    rmdir "$root/.incoming"
    chown -R 1000:1000 "$root"'

step="applying the release's migrations"
echo "$step"
deploy_job "$release"

step="giving the imported accounts this deployment's passwords"
echo "$step"
# the password never leaves the container's own environment: the command is
# told which variable holds it
printf '%s\n' "$ACCOUNTS" | while read -r email variable; do
  compose run --rm --no-deps -T tools \
    node apps/cli/src/main.ts auth set-password --email "$email" --from-env "$variable" < /dev/null
done

if [ -n "$active" ]; then
  step="starting $active again"
  echo "$step"
  compose up -d $(color_services "$active")
  wait_ready "$(color_address "$active")" "$(setting QUALY_READY_TIMEOUT 180)" ||
    refuse "$active did not become ready"
else
  step="starting blue, the first color"
  echo "$step"
  take_over blue "$release" '' || refuse "blue did not start"
fi

step="done"
echo "restored from $baseline"
