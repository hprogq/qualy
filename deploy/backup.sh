#!/bin/sh
# Backs one deployment up: the database, then the attachments.
#
#   deploy/backup.sh [backup-root]
#
# Each run writes <backup-root>/<UTC stamp>/ with qualy.dump (pg_dump custom
# format), storage.tar.gz (the local storage backend's volume),
# attachments.tar.gz (every attachment kept anywhere else - a bucket - fetched
# at the version it completed with, with attachments.tsv naming each) and
# SHA256SUMS, and only then puts the directory in place, so a directory with a
# stamp for a name is a whole backup. The newest QUALY_BACKUP_KEEP (default 14) stay.
# QUALY_BACKUP_OFFSITE, when set, is run by sh with the new directory as $1
# to copy it off this machine, for example
#
#   QUALY_BACKUP_OFFSITE='rclone copy --immutable "$1" remote:qualy-backups/"$(basename "$1")"'
#
# and the run fails if it does. On success the stamp is written to
# <backup-root>/last-success, and - when QUALY_BACKUP_STATUS_DIR is set - to
# last-success there too: a directory anyone may read, holding nothing but
# that stamp, which the collector reports as qualy_backup_last_success so an
# alert can say a backup has stopped. The backup root stays root's alone.
#
# Not in a backup, on purpose: QUALY_SECRETS_MASTER_KEY. Nothing encrypted in
# the database can be read without it, so keep it - with the rest of .env -
# somewhere that is not beside these files.
#
# Runs from anywhere: it drives deploy/compose.yaml beside it, with the .env
# there (QUALY_ENV_FILE names another; COMPOSE_PROJECT_NAME another project).
# The backup root, QUALY_BACKUP_KEEP and QUALY_BACKUP_OFFSITE are read from
# the environment first, then that .env, as every deploy setting is - so an
# upgrade's backup and cron's copy off the machine alike. Daily from cron,
# on a host the launcher keeps (ops/deploy-host/README.md), for example:
#
#   17 3 * * * QUALY_ENV_FILE=/opt/qualy/.env /opt/qualy/current/deploy/backup.sh >> /var/log/qualy-backup.log 2>&1
set -eu
umask 077

here=$(cd "$(dirname "$0")" && pwd)
. "$here/lib.sh"
[ -f "$env_file" ] || { echo "no $env_file" >&2; exit 1; }
root=${1:-$(setting QUALY_BACKUP_ROOT /var/backups/qualy)}
keep=$(setting QUALY_BACKUP_KEEP 14)
offsite=$(setting QUALY_BACKUP_OFFSITE)
status=$(setting QUALY_BACKUP_STATUS_DIR)

# Backups are deployment steps too. An upgrade and cron firing together used
# to share the same second-stamped partial directory, deleting or moving it
# from underneath the other process.
take_lock
partial=
cleanup() {
  if [ -n "$partial" ]; then rm -rf "$partial"; fi
  release_lock
}
trap cleanup EXIT
# A signal trap that merely returns makes POSIX sh continue after the
# interrupted command. Exit explicitly; the EXIT trap above then cleans the
# partial directory and releases the deployment lock exactly once.
trap 'interrupt_step INT 130' INT
trap 'interrupt_step TERM 143' TERM

case $keep in '' | *[!0-9]* | 0)
  echo "QUALY_BACKUP_KEEP must be a whole number above 0, not $keep" >&2
  exit 1
  ;;
esac

sums() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi
}

stamp=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$root"
destination="$root/$stamp"
[ ! -e "$destination" ] || refuse "backup $destination already exists; wait one second and run this again"
partial="$root/.$stamp.$$.partial"
mkdir "$partial"

# The database first, and checked: a dump pg_restore cannot list is not one.
# The commands run inside the postgres container, which knows the user and
# the database already; .env is compose's to read, not the shell's.
compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > "$partial/qualy.dump"
compose exec -T postgres pg_restore --list < "$partial/qualy.dump" > /dev/null

# Then the attachments, after the database: a file the dump names may be
# newer than the dump, which a restore survives; a row naming a file that the
# archive lacks it would not.
compose run --rm --no-deps -T --user 0:0 --entrypoint sh tools \
  -c 'tar -czf - -C /var/lib/qualy/storage .' > "$partial/storage.tar.gz"
run_interruptible gzip -t "$partial/storage.tar.gz"

# And the attachments kept anywhere but the volume, each as it completed: a
# bucket that keeps versions reads back the newest write to a key, which is
# not always the one an attachment names, so a copy of the bucket would not
# do. Written as this script's own user, so it can archive and remove them.
compose run --rm --no-deps -T --user "$(id -u):$(id -g)" -v "$partial:/backup" tools \
  node apps/cli/src/main.ts storage export --to /backup/attachments --except local < /dev/null
run_interruptible tar -czf "$partial/attachments.tar.gz" -C "$partial/attachments" .
rm -rf "$partial/attachments"
run_interruptible gzip -t "$partial/attachments.tar.gz"

(cd "$partial" && sums qualy.dump storage.tar.gz attachments.tar.gz > SHA256SUMS)
mv "$partial" "$destination"

if [ -n "$offsite" ]; then
  # COS overwrites an existing key unless both the request and the writer's
  # CAM policy require the forbid-overwrite header. Refuse the known unsafe
  # form; other backends have the same immutable-destination contract, which
  # deploy/.env.example and docs/deployment.md spell out.
  assert_immutable_offsite "$offsite"
  run_interruptible sh -c "$offsite" offsite "$destination"
fi

# the newest few stay; stamps sort as they were taken
ls -1 "$root" | grep -E '^[0-9]{8}T[0-9]{6}Z$' | sort -r | tail -n "+$((keep + 1))" |
  while read -r old; do rm -rf "${root:?}/$old"; done

printf '%s\n' "$stamp" > "$root/last-success"
# only after everything above, the copy off the machine included: its time is
# the time the whole backup last succeeded, which is what the alert reads
if [ -n "$status" ]; then
  install -d -m 755 "$status"
  printf '%s\n' "$stamp" > "$status/last-success"
  chmod 644 "$status/last-success"
fi
echo "backed up to $destination"
