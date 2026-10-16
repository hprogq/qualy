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

# The database commands run inside the postgres container, which already
# knows the deployment's user and database: .env is compose's to read, and a
# value in it (a sender like `Name <addr>`) need not be valid shell.
in_postgres() {
  compose exec -T postgres sh -c "$1"
}

# Only the two account-check scalars use this dotenv subset. Other deployment
# settings keep lib.sh semantics. No shell evaluation or multiline values.
baseline_scalar() {
  env_get "$1" "${2:-}" | env LC_ALL=C awk '
  {
    if (NR != 1) exit 1
    sub(/^[ \t\r]+/, "")
    quote = substr($0, 1, 1)
    if (quote == "\"" || quote == sprintf("%c", 39)) {
      value = substr($0, 2)
      closing = index(value, quote)
      if (closing == 0 || substr(value, closing + 1) !~ /^[ \t\r]*(#.*)?$/) exit 1
      $0 = substr(value, 1, closing - 1)
    } else {
      sub(/#.*/, "")
      sub(/[ \t\r]+$/, "")
    }
    print
  }
  '
}

[ -f "$env_file" ] || refuse "no $env_file"
[ -f "$baseline/qualy-demo.dump" ] || refuse "no $baseline/qualy-demo.dump"
[ -f "$baseline/storage.tar.gz" ] || refuse "no $baseline/storage.tar.gz"
release=$(env_get QUALY_RELEASE)
[ -n "$release" ] || refuse "no QUALY_RELEASE in $env_file: which release runs the baseline?"
# Match tools/demo/accounts.ts without depending on source files in the
# release image. The domain names accounts already in the dump; it never
# renames them and is independent of QUALY_PUBLIC_URL and QUALY_MAIL_FROM.
demo_email_domain=$(baseline_scalar QUALY_DEMO_EMAIL_DOMAIN) ||
  refuse "QUALY_DEMO_EMAIL_DOMAIN must be a single-line dotenv scalar"
demo_email_domain=$(printf '%s' "$demo_email_domain" | env LC_ALL=C awk '
  {
    sub(/^[ \t\r]+/, ""); sub(/[ \t\r]+$/, "")
    domain = tolower($0)
    if (length(domain) == 0 || length(domain) > 238 || domain ~ /[^a-z0-9.-]/) exit 1
    count = split(domain, labels, ".")
    if (count < 2 || labels[count] !~ /[a-z]/) exit 1
    for (i = 1; i <= count; i++) {
      if (length(labels[i]) == 0 || length(labels[i]) > 63 ||
          labels[i] !~ /^[a-z0-9]/ || labels[i] !~ /[a-z0-9]$/) exit 1
    }
    print domain
  }
') || refuse "QUALY_DEMO_EMAIL_DOMAIN must be a valid ASCII email domain (at most 238 characters)"
[ -n "$demo_email_domain" ] || refuse "set QUALY_DEMO_EMAIL_DOMAIN in $env_file to the baseline's email domain"
default_tenant=$(baseline_scalar QUALY_DEFAULT_TENANT default) ||
  refuse "QUALY_DEFAULT_TENANT must be a single-line dotenv scalar"
# AuthConfig treats an empty value as missing, but preserves quoted spaces.
[ -n "$default_tenant" ] || default_tenant=default
# Who signs in with a password in the baseline, and which variable keeps
# the password this deployment gives them.
ACCOUNTS="admin@$demo_email_domain QUALY_BASELINE_PASSWORD_ADMIN
student@$demo_email_domain QUALY_BASELINE_PASSWORD_STUDENT
class-lead@$demo_email_domain QUALY_BASELINE_PASSWORD_CLASS_LEAD
counsellor@$demo_email_domain QUALY_BASELINE_PASSWORD_COUNSELLOR
lead@$demo_email_domain QUALY_BASELINE_PASSWORD_LEAD"
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

step="checking the baseline's account domain"
baseline_account_count=$(compose exec -T postgres sh -c '
  psql -U "$POSTGRES_USER" -d "${POSTGRES_DB}_restore" -XAt -v ON_ERROR_STOP=1 \
    -v email_domain="$1" -v tenant_slug="$2"' sh "$demo_email_domain" "$default_tenant" <<'SQL'
select count(*) as baseline_account_count
from users u join tenants t on t.id = u.tenant_id
where t.slug = :'tenant_slug' and u.deleted_at is null
  and u.email in (
    'admin@' || :'email_domain', 'student@' || :'email_domain',
    'class-lead@' || :'email_domain', 'counsellor@' || :'email_domain',
    'lead@' || :'email_domain'
  );
SQL
) || refuse "could not verify the baseline's accounts; the serving color has not been stopped"
[ "$baseline_account_count" = 5 ] ||
  refuse "baseline accounts do not match QUALY_DEMO_EMAIL_DOMAIN and QUALY_DEFAULT_TENANT; the serving color has not been stopped"

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

# the baseline is a dump of a database that never had the statement
# statistics; a deployment that counts them goes on counting
step="installing the statement statistics where they are loaded"
echo "$step"
"$here/query-stats.sh" install

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
