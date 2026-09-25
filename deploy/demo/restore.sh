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
#   6. the server and the sandboxes start, and the script waits for them
#
# A failure before step 2 leaves the site as it was. A failure after it
# stops with the step named; running the script again finishes the job.
set -eu

here=$(cd "$(dirname "$0")/.." && pwd)
baseline=${1:-/opt/qualy/demo-baseline}

compose() {
  docker compose -f "$here/compose.yaml" --env-file "$here/.env" "$@"
}

# The database commands run inside the postgres container, which already
# knows the deployment's user and database: .env is compose's to read, and a
# value in it (a sender like `Name <addr>`) need not be valid shell.
in_postgres() {
  compose exec -T postgres sh -c "$1"
}

[ -f "$here/.env" ] || { echo "no $here/.env" >&2; exit 1; }
[ -f "$baseline/qualy-demo.dump" ] || { echo "no $baseline/qualy-demo.dump" >&2; exit 1; }
[ -f "$baseline/storage.tar.gz" ] || { echo "no $baseline/storage.tar.gz" >&2; exit 1; }

# One restore at a time: two would drop each other's scratch database.
lock="${TMPDIR:-/tmp}/qualy-demo-restore.lock"
if ! mkdir "$lock" 2>/dev/null; then
  echo "another restore holds $lock; remove it if no restore is running" >&2
  exit 1
fi
step="starting"
finish() {
  status=$?
  rmdir "$lock" 2>/dev/null || true
  if [ "$status" -ne 0 ]; then
    echo "restore failed while $step; run it again to finish" >&2
  fi
}
trap finish EXIT

step="starting the database"
compose up -d --wait postgres

step="restoring the dump into a scratch database"
echo "$step"
in_postgres 'dropdb -U "$POSTGRES_USER" --if-exists --force "${POSTGRES_DB}_restore" &&
  createdb -U "$POSTGRES_USER" "${POSTGRES_DB}_restore"'
compose exec -T postgres sh -c \
  'pg_restore -U "$POSTGRES_USER" -d "${POSTGRES_DB}_restore" --no-owner --no-acl --exit-on-error' \
  < "$baseline/qualy-demo.dump"

step="stopping the server"
echo "$step"
compose stop server

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
  -v "$baseline:/in:ro" server -c '
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
compose --profile deploy run --rm migrate

step="starting the server and the sandboxes"
echo "$step"
compose up -d --wait server sandbox-runtime sandbox-authoring

step="done"
echo "restored from $baseline"
