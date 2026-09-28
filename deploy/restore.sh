#!/bin/sh
# Restores one deployment from a backup deploy/backup.sh made.
#
#   deploy/restore.sh <backup-dir>
#
# The backup directory holds qualy.dump, storage.tar.gz and SHA256SUMS. It
# replaces the database and the attachments the local backend keeps;
# everything written since the backup is lost, which is what a restore is
# for. Attachments in a bucket are not put back: the versions the restored
# rows name are still there, except for an attachment nobody saved that was
# swept since the backup. attachments.tar.gz, when the backup has one, holds
# those and everything else in the bucket, for the day the bucket itself is
# lost (docs/deployment.md). Runs from anywhere: it
# drives deploy/compose.yaml beside it, with the .env there (QUALY_ENV_FILE
# names another; COMPOSE_PROJECT_NAME another project).
#
# The order never leaves the deployment half-restored:
#
#   1. the files are checked against their sums
#   2. the dump goes into a scratch database, all or nothing, while the
#      server still serves
#   3. the serving color stops
#   4. the scratch database takes the live one's name; the live one is kept
#      as <name>_previous until the next restore
#   5. the attachments are unpacked beside the old ones, then swapped in
#   6. the release's migrations bring a backup from an older release up to
#      this one, and its web release is installed
#   7. the serving color starts again, and the script waits for it
#
# A failure before step 3 leaves the deployment as it was. A failure after it
# stops with the step named; running the script again finishes the job.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
. "$here/lib.sh"
backup=${1:?usage: deploy/restore.sh <backup-dir>}
backup=$(cd "$backup" && pwd)

sums() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi
}

[ -f "$env_file" ] || { echo "no $env_file" >&2; exit 1; }
for file in qualy.dump storage.tar.gz SHA256SUMS; do
  [ -f "$backup/$file" ] || { echo "no $backup/$file" >&2; exit 1; }
done

step="checking the backup against its sums"
echo "$step"
(cd "$backup" && sums -c SHA256SUMS > /dev/null) || { echo "$backup does not match its SHA256SUMS" >&2; exit 1; }

step="starting"
finish() {
  status=$?
  if [ "$status" -ne 0 ]; then echo "restore failed while $step; run it again to finish" >&2; fi
}
trap finish EXIT

step="starting the database"
compose up -d --wait postgres

step="restoring the dump into a scratch database"
echo "$step"
compose exec -T postgres sh -c 'dropdb -U "$POSTGRES_USER" --if-exists --force "${POSTGRES_DB}_restore" &&
  createdb -U "$POSTGRES_USER" "${POSTGRES_DB}_restore"'
compose exec -T postgres sh -c \
  'pg_restore -U "$POSTGRES_USER" -d "${POSTGRES_DB}_restore" --no-owner --no-acl --exit-on-error' \
  < "$backup/qualy.dump"

active=$(env_get QUALY_ACTIVE_COLOR)
release=$(env_get QUALY_RELEASE)
[ -n "$release" ] || refuse "no QUALY_RELEASE in $env_file: which release is this deployment?"

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
  -v "$backup:/in:ro" tools -c '
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

if [ -n "$active" ]; then
  step="starting $active again"
  echo "$step"
  compose up -d $(color_services "$active")
  wait_ready "$(color_address "$active")" "$(setting QUALY_READY_TIMEOUT 180)" ||
    refuse "$active did not become ready after the restore"
else
  echo "nothing served before the restore; start it with deploy/upgrade.sh $release"
fi

step="done"
echo "restored from $backup"
