#!/bin/sh
# Moves a deployment onto a release without anybody seeing it move.
#
#   deploy/upgrade.sh <release> [--maintenance]
#
# The release's three images must be on this host. The color that is not
# serving takes the release: the deploy job applies its migrations and
# installs its web release, the idle color starts on it and is waited for,
# the edge is pointed at it, and after a drain the color that served stops.
# It stays stopped, on the release it ran, for rollback.sh. The first
# deployment is the same command on a database the deploy job and the seed
# have already prepared (deploy/README.md).
#
# While the colors overlap, both run against one database, so a release must
# work on the schema the one before it left, and the one before it on the
# new one: migrations expand, and what they remove goes a release later. Each
# migration says whether it does (`-- rollout: expand`, or `maintenance`;
# packages/plugins/infra/database/src/assembly/rollout.ts). A pending one
# that does not say expand - maintenance, or nothing at all - refuses the
# upgrade unless --maintenance says to take the site down instead: the edge
# shows the maintenance page, the serving color stops, and only then does the
# job run. That should be rare. The first deployment serves nothing yet, so
# nothing is asked.
#
# One step at a time: a second upgrade, rollback or restore on the same env
# file waits for nobody and is refused. Before anything else, .env's record of
# what serves is checked against where the edge actually sends traffic
# (reconcile in lib.sh).
#
# Refused before anything changes: another step running, the record and the
# edge disagreeing in a way that cannot be settled, images missing, too little
# memory or disk (QUALY_UPGRADE_MIN_MEMORY_MB, QUALY_UPGRADE_MIN_DISK_MB), a
# pending migration that does not roll out as expand, without --maintenance.
# With QUALY_BACKUP_ROOT set, a backup comes first. A failure after the deploy
# job leaves the serving color serving and puts its web release back as the
# store's current one.
#
# The edge: QUALY_PROXY (caddy, or none for a host with no edge), the snippet
# the site imports (QUALY_PROXY_UPSTREAM, default
# /etc/caddy/qualy/upstream.caddy), and the commands that validate and reload
# it (QUALY_PROXY_VALIDATE, QUALY_PROXY_RELOAD); ops/reverse-proxy/Caddyfile
# shows the site. Each is read from the environment first, then .env.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
. "$here/lib.sh"

release=${1:-}
[ -n "$release" ] || refuse "usage: deploy/upgrade.sh <release> [--maintenance]"
maintenance=false
[ "${2:-}" = --maintenance ] && maintenance=true
[ -f "$env_file" ] || refuse "no $env_file"
take_lock
trap release_lock EXIT
reconcile

active=$(env_get QUALY_ACTIVE_COLOR)
target=$(other_color "$active")
current=
[ -n "$active" ] && current=$(color_release "$active")
[ "$current" = "$release" ] && refuse "$active already serves $release"

say "upgrading to $release on $target${active:+ (serving: $active, $current)}"
require_images "$release"
preflight
compose up -d --wait postgres

# what the database has not run yet, and whether all of it lets the serving
# release keep working; nothing serves on a first deployment, so nothing is
# asked there
if [ -n "$active" ]; then
  applied=$(ledger)
  holding=$(missing_from "$(not_expand_in "$release")" "$applied")
  if [ -n "$holding" ]; then
    if [ "$maintenance" = false ]; then
      refuse "pending migrations that do not roll out as expand: $(printf '%s' "$holding" | tr '\n' ' ')
while two colors overlap, $current would run on a schema it may not work on;
run again with --maintenance to take the site down for this upgrade"
    fi
    say "migrations that do not roll out as expand are pending, upgrading under maintenance: $(printf '%s' "$holding" | tr '\n' ' ')"
  fi
fi

backups=$(setting QUALY_BACKUP_ROOT)
if [ -n "$backups" ]; then
  say "backing up to $backups"
  "$here/backup.sh" "$backups"
else
  say "no backup taken: QUALY_BACKUP_ROOT is not set"
fi

if [ "$maintenance" = true ] && [ -n "$active" ]; then
  proxy_point maintenance || refuse "the edge could not be pointed at the maintenance page; nothing changed"
  compose stop -t 40 $(color_services "$active")
  say "$active stopped; the site shows the maintenance page"
fi

say "running the deploy job for $release"
deploy_job "$release"

# a failure from here leaves the old color serving, with its web release
# current again: were it to restart, it would find its own
put_back() {
  if [ -n "$current" ]; then
    say "putting $current back as the web release store's current one" >&2
    deploy_job "$current" > /dev/null 2>&1 || say "that failed too: run the deploy job for $current by hand" >&2
    if [ "$maintenance" = true ]; then
      compose up -d $(color_services "$active") > /dev/null 2>&1 || true
      wait_ready "$(color_address "$active")" 180 && proxy_point "$(color_address "$active")" || true
    fi
  fi
}
if ! take_over "$target" "$release" "$([ "$maintenance" = true ] && printf '' || printf '%s' "$active")"; then
  put_back
  refuse "upgrade to $release failed; ${active:-nothing} serves as before"
fi
say "upgraded to $release on $target"
