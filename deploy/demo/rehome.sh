#!/bin/sh
# Moves a demonstration baseline's accounts to another email domain.
#
#   deploy/demo/rehome.sh <from-domain> <to-domain> [baseline-dir]
#
# A baseline names its accounts under the domain it was generated with, and
# generating it again takes hours. This edits the baseline instead: its dump
# goes into a scratch database (never the one that serves), every address at
# <from-domain> moves to <to-domain> - ids, password hashes and bindings stay,
# and a moved address is not verified, being a new one - and the scratch
# database is exported again, the way demo:snapshot exports it. The old dump
# stays beside the new one. The attachments archive does not name addresses
# and is left as it is.
#
# Nothing that serves is touched. Afterwards set QUALY_DEMO_EMAIL_DOMAIN to
# <to-domain> and run restore.sh, which checks the accounts against it.
set -eu

here=$(cd "$(dirname "$0")/.." && pwd)
. "$here/lib.sh"
. "$here/demo/domain.sh"

[ $# -ge 2 ] && [ $# -le 3 ] ||
  refuse "usage: deploy/demo/rehome.sh <from-domain> <to-domain> [baseline-dir]"
from=$(printf '%s' "$1" | email_domain) || refuse "$1 is not an email domain"
to=$(printf '%s' "$2" | email_domain) || refuse "$2 is not an email domain"
[ "$from" != "$to" ] || refuse "the baseline is already at $to"
baseline=${3:-/opt/qualy/demo-baseline}
[ -f "$env_file" ] || refuse "no $env_file"
[ -f "$baseline/qualy-demo.dump" ] || refuse "no $baseline/qualy-demo.dump"

in_postgres() {
  compose exec -T postgres sh -c "$1"
}

# one deployment step at a time: a restore beside this would read a dump
# halfway replaced
take_lock
step="starting"
finish() {
  status=$?
  in_postgres 'dropdb -U "$POSTGRES_USER" --if-exists --force "${POSTGRES_DB}_rehome"' > /dev/null 2>&1 || true
  rm -f "$baseline/qualy-demo.dump.next"
  release_lock
  if [ "$status" -ne 0 ]; then
    echo "rehome failed while $step; the baseline is as it was" >&2
  fi
}
trap finish EXIT
umask 077

step="starting the database"
compose up -d --wait postgres

step="restoring the baseline into a scratch database"
echo "$step"
in_postgres 'dropdb -U "$POSTGRES_USER" --if-exists --force "${POSTGRES_DB}_rehome" &&
  createdb -U "$POSTGRES_USER" "${POSTGRES_DB}_rehome"'
compose exec -T postgres sh -c \
  'pg_restore -U "$POSTGRES_USER" -d "${POSTGRES_DB}_rehome" --no-owner --no-acl --exit-on-error' \
  < "$baseline/qualy-demo.dump"

step="moving the accounts from $from to $to"
echo "$step"
moved=$(compose exec -T postgres sh -c '
  psql -U "$POSTGRES_USER" -d "${POSTGRES_DB}_rehome" -XAtq -v ON_ERROR_STOP=1 \
    -v from_domain="$1" -v to_domain="$2"' sh "$from" "$to" <<'SQL'
begin;
-- the part before the @ stays; only an address exactly at the old domain moves
with moved as (
  update users
     set email = left(email, length(email) - length(:'from_domain')) || :'to_domain',
         email_verified_at = null
   where email like '%@' || :'from_domain'
  returning 1
)
select count(*) from moved;
-- the five demonstration accounts are where restore.sh will look for them
select count(*) = 5 as accounts from users
 where email in ('admin@' || :'to_domain', 'student@' || :'to_domain',
   'class-lead@' || :'to_domain', 'counsellor@' || :'to_domain', 'lead@' || :'to_domain') \gset
\if :accounts
\else
  do $$ begin raise exception 'the five demonstration accounts are not all at the new domain'; end $$;
\endif
commit;
SQL
)
[ "${moved:-0}" -gt 0 ] || refuse "no account in the baseline is at $from"

step="exporting the baseline again"
echo "$step"
compose exec -T postgres sh -c \
  'pg_dump -U "$POSTGRES_USER" -Fc --no-owner --no-acl -d "${POSTGRES_DB}_rehome"' \
  > "$baseline/qualy-demo.dump.next"
compose exec -T postgres pg_restore --list < "$baseline/qualy-demo.dump.next" > /dev/null ||
  refuse "the exported dump does not read back"

step="putting the new dump in place"
kept="$baseline/qualy-demo.dump.$from.$(date -u +%Y%m%dT%H%M%SZ)"
mv "$baseline/qualy-demo.dump" "$kept"
mv "$baseline/qualy-demo.dump.next" "$baseline/qualy-demo.dump"
chmod 600 "$baseline/qualy-demo.dump" "$kept"

step="done"
echo "moved $moved account(s) from $from to $to; the old dump is $kept"
echo "set QUALY_DEMO_EMAIL_DOMAIN=$to before the next restore"
