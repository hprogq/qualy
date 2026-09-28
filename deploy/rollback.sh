#!/bin/sh
# Moves a deployment back to the release it served before its last upgrade.
#
#   deploy/rollback.sh [--force]
#
# The color that is not serving still holds that release, stopped. It is
# started again, waited for and made the one the edge serves, and the color
# that served stops after a drain - the same moves as an upgrade, so nobody
# sees this one either. For any other release, use upgrade.sh.
#
# An image rollback is not a schema rollback (docs/deployment.md): the
# migrations the newer release applied stay applied, and the older release
# runs against them. That is safe for migrations that roll out as expand
# (lib.sh, rollout.ts). When one of them says maintenance, says nothing, or
# is not in the newer release either, the older release may not work on
# what it left, and this refuses unless --force says the operator has
# checked; the ways back from there are a fix-forward release or restore.sh.
# The same lock and the same reconcile as upgrade.sh come first.
#
# The deploy job runs first for the older release: it applies nothing (the
# database is ahead of it, and migrations it does not know are left alone)
# and makes its web release the store's current one again, which its server
# requires before it starts.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
. "$here/lib.sh"

force=false
[ "${1:-}" = --force ] && force=true
[ -f "$env_file" ] || refuse "no $env_file"
take_lock
trap release_lock EXIT
reconcile

active=$(env_get QUALY_ACTIVE_COLOR)
[ -n "$active" ] || refuse "nothing serves yet; there is nothing to roll back"
idle=$(other_color "$active")
current=$(color_release "$active")
release=$(color_release "$idle")
case $release in '' | none) refuse "$idle has never run a release; there is nothing to roll back to" ;; esac
[ "$release" = "$current" ] && refuse "$idle last ran $release, which $active serves already"

say "rolling back from $current ($active) to $release ($idle)"
require_images "$release"
require_images "$current"
preflight
compose up -d --wait postgres

# what the database ran that the older release does not know, and whether the
# release that brought it says all of it rolls out as expand
ahead=$(missing_from "$(ledger)" "$(lineage_of "$release")")
if [ -n "$ahead" ]; then
  known=$(lineage_of "$current")
  unknown=$(missing_from "$ahead" "$known")
  risky=$(printf '%s\n' "$(not_expand_in "$current")" | while read -r name; do
    [ -n "$name" ] && printf '%s\n' "$ahead" | grep -qxF "$name" && printf '%s\n' "$name"
  done || true)
  say "applied since $release: $(printf '%s' "$ahead" | tr '\n' ' ')"
  if [ -n "$unknown$risky" ] && [ "$force" = false ]; then
    refuse "$release may not run on this schema: ${risky:+not rolling out as expand: $(printf '%s' "$risky" | tr '\n' ' ')}${unknown:+ unknown to $current: $(printf '%s' "$unknown" | tr '\n' ' ')}
check that it does and run again with --force, or fix forward, or restore a backup (restore.sh)"
  fi
fi

say "running the deploy job for $release"
deploy_job "$release"
if ! take_over "$idle" "$release" "$active"; then
  say "putting $current back as the web release store's current one" >&2
  deploy_job "$current" > /dev/null 2>&1 || say "that failed too: run the deploy job for $current by hand" >&2
  refuse "rollback to $release failed; $active serves $current as before"
fi
say "rolled back to $release on $idle"
