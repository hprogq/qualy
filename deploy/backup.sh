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
#   QUALY_BACKUP_OFFSITE='rclone copy "$1" remote:qualy-backups/"$(basename "$1")"'
#
# and the run fails if it does. On success the stamp is written to
# <backup-root>/last-success, which a monitor can read for its age.
#
# Not in a backup, on purpose: QUALY_SECRETS_MASTER_KEY. Nothing encrypted in
# the database can be read without it, so keep it - with the rest of .env -
# somewhere that is not beside these files.
#
# Runs from anywhere: it drives deploy/compose.yaml beside it, with the .env
# there (QUALY_ENV_FILE names another; COMPOSE_PROJECT_NAME another project).
# Daily from cron, for example:
#
#   17 3 * * * /opt/qualy/deploy/backup.sh /var/backups/qualy >> /var/log/qualy-backup.log 2>&1
set -eu
umask 077

here=$(cd "$(dirname "$0")" && pwd)
. "$here/lib.sh"
root=${1:-/var/backups/qualy}
keep=${QUALY_BACKUP_KEEP:-14}

case $keep in '' | *[!0-9]* | 0)
  echo "QUALY_BACKUP_KEEP must be a whole number above 0, not $keep" >&2
  exit 1
  ;;
esac
[ -f "$env_file" ] || { echo "no $env_file" >&2; exit 1; }

sums() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi
}

stamp=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$root"
partial="$root/.$stamp.partial"
rm -rf "$partial"
mkdir "$partial"
trap 'rm -rf "$partial"' EXIT

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
gzip -t "$partial/storage.tar.gz"

# And the attachments kept anywhere but the volume, each as it completed: a
# bucket that keeps versions reads back the newest write to a key, which is
# not always the one an attachment names, so a copy of the bucket would not
# do. Written as this script's own user, so it can archive and remove them.
compose run --rm --no-deps -T --user "$(id -u):$(id -g)" -v "$partial:/backup" tools \
  node apps/cli/src/main.ts storage export --to /backup/attachments --except local < /dev/null
tar -czf "$partial/attachments.tar.gz" -C "$partial/attachments" .
rm -rf "$partial/attachments"
gzip -t "$partial/attachments.tar.gz"

(cd "$partial" && sums qualy.dump storage.tar.gz attachments.tar.gz > SHA256SUMS)
mv "$partial" "$root/$stamp"
trap - EXIT

if [ -n "${QUALY_BACKUP_OFFSITE:-}" ]; then
  sh -c "$QUALY_BACKUP_OFFSITE" offsite "$root/$stamp"
fi

# the newest few stay; stamps sort as they were taken
ls -1 "$root" | grep -E '^[0-9]{8}T[0-9]{6}Z$' | sort -r | tail -n "+$((keep + 1))" |
  while read -r old; do rm -rf "${root:?}/$old"; done

printf '%s\n' "$stamp" > "$root/last-success"
echo "backed up to $root/$stamp"
