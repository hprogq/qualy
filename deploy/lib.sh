# Shared by upgrade.sh, rollback.sh, restore.sh, backup.sh and
# demo/restore.sh; sourced, never run. POSIX sh, and `local`, which dash,
# bash and busybox all have: a function here shares one namespace with the
# script that sourced it, and every name it assigns is declared local so it
# never overwrites the caller's - `target`, `release` and `previous` mean a
# color and a release up there.
#
# The scripts never source .env: a value in it (a sender like `Name <addr>`)
# need not be valid shell. They read the few keys they need with env_get, and
# write the ones that are theirs - which release each color runs, which color
# serves - with env_set, so a plain `docker compose ps` or `up` afterwards
# sees what the scripts left. Every file they write is replaced whole, never
# rewritten in place: a step killed halfway leaves the old file or the new
# one, not half of either.
#
# What .env says serves is a record, not the fact. The fact is where the edge
# sends traffic, and a step interrupted between moving the edge and writing
# .env leaves the two apart; reconcile() reads the fact at the start of every
# step and brings the record back to it, or refuses when the fact is unclear.

here=${here:?lib.sh expects $here to name the deploy directory}
env_file=${QUALY_ENV_FILE:-$here/.env}

# QUALY_COMPOSE_OVERLAY names one more file beside compose.yaml - staging's
# compose.staging.yaml - read from the environment first, then the env file.
# The collector's credentials live beside .env, wherever that is: a release's
# scripts run from a directory of their own (ops/deploy-host/qualy-deploy).
compose() {
  local overlay
  QUALY_COLLECTOR_ENV_FILE=${QUALY_COLLECTOR_ENV_FILE:-$(dirname "$env_file")/collector.env}
  export QUALY_COLLECTOR_ENV_FILE
  overlay=${QUALY_COMPOSE_OVERLAY:-$(sed -n 's/^QUALY_COMPOSE_OVERLAY=//p' "$env_file" 2> /dev/null | tail -n 1)}
  if [ -n "$overlay" ]; then
    docker compose -f "$here/compose.yaml" -f "$here/$overlay" --env-file "$env_file" "$@"
  else
    docker compose -f "$here/compose.yaml" --env-file "$env_file" "$@"
  fi
}

say() {
  printf '%s\n' "$*"
}

refuse() {
  printf '%s\n' "$*" >&2
  exit 1
}

# the value .env gives a key, or the second argument when it gives none
env_get() {
  local value
  value=$(sed -n "s/^$1=//p" "$env_file" | tail -n 1)
  if [ -n "$value" ]; then printf '%s' "$value"; else printf '%s' "${2:-}"; fi
}

# Replaces a file with what stdin holds: written beside it, flushed, then
# renamed over it - a rename within one directory is atomic. The new file
# keeps the old one's mode (and owner, for a caller allowed to keep it).
replace_file() {
  local file="$1" fresh
  fresh=$(mktemp "$(dirname "$file")/.$(basename "$file").XXXXXX") || return 1
  if [ -f "$file" ]; then cp -p "$file" "$fresh"; fi
  if ! cat > "$fresh"; then
    rm -f "$fresh"
    return 1
  fi
  sync
  mv -f "$fresh" "$file"
}

# Writes keys of .env, as KEY VALUE pairs, in one replacement: a key already
# there is rewritten where it stands, a new one is added at the end. Values
# here are release tags and color names, never anything a sed pattern could
# misread.
env_set() {
  local work
  work=$(mktemp "$(dirname "$env_file")/.env.work.XXXXXX") || refuse "cannot write beside $env_file"
  cat "$env_file" > "$work"
  # a last line without its newline would swallow the first added key
  if [ -s "$work" ] && [ -n "$(tail -c 1 "$work")" ]; then printf '\n' >> "$work"; fi
  while [ $# -ge 2 ]; do
    if grep -q "^$1=" "$work"; then
      sed "s|^$1=.*|$1=$2|" "$work" > "$work.next" && mv -f "$work.next" "$work"
    else
      printf '%s=%s\n' "$1" "$2" >> "$work"
    fi
    shift 2
  done
  replace_file "$env_file" < "$work" || refuse "could not replace $env_file"
  rm -f "$work"
}

# One deployment step at a time for an env file: two upgrades at once - a
# retried CI job and a hand at the terminal - would each move the edge and
# write .env. flock where the host has it (Linux), which the kernel releases
# however the process ends; a directory elsewhere, which release_lock removes
# from the script's exit trap. A step a script runs inside another inherits
# the lock rather than waiting on it.
held_lock=
take_lock() {
  [ "${QUALY_DEPLOY_LOCK_HELD:-}" = "$env_file" ] && return 0
  local lock="$env_file.lock"
  if command -v flock > /dev/null 2>&1; then
    exec 9> "$lock"
    flock -n 9 || refuse "another deployment step holds $lock; wait for it to finish, then run this again"
  else
    mkdir "$lock.d" 2> /dev/null ||
      refuse "another deployment step holds $lock.d; if none is running, remove it and run this again"
    held_lock="$lock.d"
  fi
  QUALY_DEPLOY_LOCK_HELD=$env_file
  export QUALY_DEPLOY_LOCK_HELD
}
release_lock() {
  if [ -n "$held_lock" ]; then rmdir "$held_lock" 2> /dev/null || true; fi
  held_lock=
}

# a setting the operator's environment gives, else .env, else the default
setting() {
  local given
  eval "given=\${$1:-}"
  if [ -n "$given" ]; then printf '%s' "$given"; else env_get "$1" "${2:-}"; fi
}

other_color() {
  case $1 in blue) printf green ;; green) printf blue ;; *) printf blue ;; esac
}

upper() {
  printf '%s' "$1" | tr '[:lower:]' '[:upper:]'
}

color_release() {
  env_get "QUALY_RELEASE_$(upper "$1")"
}

color_port() {
  case $1 in
    blue) env_get QUALY_PORT_BLUE 3001 ;;
    green) env_get QUALY_PORT_GREEN 3002 ;;
  esac
}

color_services() {
  printf 'server-%s sandbox-runtime-%s sandbox-authoring-%s' "$1" "$1" "$1"
}

# where this host reaches a color's published port
color_address() {
  local bind
  bind=$(env_get QUALY_BIND 127.0.0.1)
  case $bind in 0.0.0.0 | '') bind=127.0.0.1 ;; esac
  printf 'http://%s:%s' "$bind" "$(color_port "$1")"
}

require_images() {
  local image
  for image in qualy-server qualy-sandbox-runtime qualy-sandbox-authoring; do
    docker image inspect "$image:$1" > /dev/null 2>&1 ||
      refuse "no image $image:$1 on this host; load or pull the release first"
  done
}

# the web release a color serves, from its own probe
served_release() {
  curl -fsS --max-time 5 "$1/__qualy/release" 2> /dev/null |
    sed -n 's/.*"releaseId":"\([^"]*\)".*/\1/p'
}

wait_ready() {
  local deadline
  deadline=$(($(date +%s) + ${2:-180}))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if curl -fsS --max-time 5 "$1/health/ready" > /dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}

# Enough room to run two colors for a minute, and to take a backup and a new
# image. Measured where it can be (Linux); said where it cannot.
preflight() {
  local min_memory min_disk available root free
  min_memory=$(setting QUALY_UPGRADE_MIN_MEMORY_MB 600)
  min_disk=$(setting QUALY_UPGRADE_MIN_DISK_MB 2048)
  if [ -r /proc/meminfo ]; then
    available=$(awk '/^MemAvailable:/ { print int($2 / 1024) }' /proc/meminfo)
    [ "$available" -ge "$min_memory" ] ||
      refuse "only ${available} MB of memory available, ${min_memory} MB needed to run two colors side by side (QUALY_UPGRADE_MIN_MEMORY_MB)"
    say "memory: ${available} MB available"
  else
    say "memory: not measured on this host"
  fi
  root=$(docker info --format '{{.DockerRootDir}}' 2> /dev/null || true)
  if [ -n "$root" ] && [ -d "$root" ]; then
    free=$(df -Pm "$root" | awk 'NR == 2 { print $4 }')
    [ "$free" -ge "$min_disk" ] ||
      refuse "only ${free} MB free under $root, ${min_disk} MB needed (QUALY_UPGRADE_MIN_DISK_MB)"
    say "disk: ${free} MB free under $root"
  else
    say "disk: not measured on this host"
  fi
}

# the migrations the database has recorded, one name a line; none before the
# first migration
ledger() {
  compose exec -T postgres sh -c \
    'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select name from mikro_orm_migrations order by name"' \
    2> /dev/null || true
}

# the migrations a release's image carries
lineage_of() {
  docker run --rm --entrypoint sh "qualy-server:$1" -c 'cd db/migrations && ls -1 *.sql'
}

# Those of them that do not say `-- rollout: expand`: the ones that say
# maintenance, and the ones that say nothing, which are read the same way
# (packages/plugins/infra/database/src/assembly/rollout.ts).
not_expand_in() {
  docker run --rm --entrypoint sh "qualy-server:$1" -c \
    'cd db/migrations && grep -L -E "^--[[:space:]]*rollout:[[:space:]]*expand[[:space:]]*$" *.sql || true'
}

# names in the first list that the second does not hold
missing_from() {
  printf '%s\n' "$1" | while read -r name; do
    [ -z "$name" ] && continue
    printf '%s\n' "$2" | grep -qxF "$name" || printf '%s\n' "$name"
  done
}

# Points the edge at a color's port, or at the maintenance page. Written to
# the snippet the site imports, validated, then reloaded; a snippet that does
# not validate or reload is put back as it was, and the caller is told.
proxy_point() {
  local proxy snippet validate reload before upstream
  proxy=$(setting QUALY_PROXY caddy)
  [ "$proxy" = none ] && return 0
  [ "$proxy" = caddy ] || refuse "QUALY_PROXY is $proxy; caddy and none are understood"
  snippet=$(setting QUALY_PROXY_UPSTREAM /etc/caddy/qualy/upstream.caddy)
  validate=$(setting QUALY_PROXY_VALIDATE 'caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile')
  reload=$(setting QUALY_PROXY_RELOAD 'systemctl reload caddy')
  before=
  [ -f "$snippet" ] && before=$(cat "$snippet")
  if [ "$1" = maintenance ]; then
    # handled by the site's handle_errors, which serves the maintenance page
    printf 'error "maintenance" 503\n' | replace_file "$snippet" || return 1
  else
    upstream=${1#http://}
    replace_file "$snippet" << CADDY || return 1
reverse_proxy $upstream {
	header_up X-Forwarded-Host {http.request.host}
	flush_interval -1
	transport http {
		keepalive 90s
		keepalive_idle_conns 32
	}
}
CADDY
  fi
  if sh -c "$validate" > /dev/null 2>&1 && sh -c "$reload"; then
    return 0
  fi
  printf '%s\n' "$before" | replace_file "$snippet" || true
  sh -c "$reload" > /dev/null 2>&1 || true
  return 1
}

# the release a color's server runs, when it is running
running_release() {
  local id
  id=$(compose ps -q "server-$1" 2> /dev/null)
  [ -n "$id" ] || return 1
  [ "$(docker inspect -f '{{.State.Running}}' "$id" 2> /dev/null)" = true ] || return 1
  docker inspect -f '{{.Config.Image}}' "$id" | sed 's/^qualy-server://'
}

# Which color the edge sends traffic to, from what can be checked rather than
# from .env: the snippet the site imports, or - with no edge - which server
# runs. One of blue, green, maintenance, none or unclear.
serving_color() {
  local snippet port color found
  if [ "$(setting QUALY_PROXY caddy)" = caddy ]; then
    snippet=$(setting QUALY_PROXY_UPSTREAM /etc/caddy/qualy/upstream.caddy)
    if [ ! -s "$snippet" ]; then
      printf none
      return
    fi
    if grep -q 'error "maintenance"' "$snippet"; then
      printf maintenance
      return
    fi
    port=$(sed -n 's/^reverse_proxy [^ ]*:\([0-9][0-9]*\) .*/\1/p' "$snippet" | head -n 1)
    for color in blue green; do
      if [ -n "$port" ] && [ "$port" = "$(color_port "$color")" ]; then
        printf '%s' "$color"
        return
      fi
    done
    printf unclear
  else
    found=
    for color in blue green; do
      if running_release "$color" > /dev/null; then found="$found $color"; fi
    done
    case $found in
      '') printf none ;;
      ' blue' | ' green') printf '%s' "${found# }" ;;
      *) printf unclear ;;
    esac
  fi
}

# Brings .env's record of what serves back to the fact, before a step acts on
# it. When the edge sends traffic to a running color, that color and the
# release its server runs are what serve, and .env is made to say so - out
# loud, since it means a step before this one ended between moving the edge
# and writing the record. When nothing serves yet, that is a first
# deployment. Anything else is refused: a maintenance page left up by an
# upgrade that did not finish, an edge pointed at a stopped color, or a
# snippet that names neither color's port.
#
# A restore is run on a deployment that is down, or again after a restore
# that stopped halfway, so with --stopped-ok a stopped color is accepted
# when nothing says anything but the record: no edge and no server running,
# or the edge on the very color .env records.
reconcile() {
  local recorded actual running
  recorded=$(env_get QUALY_ACTIVE_COLOR)
  actual=$(serving_color)
  if [ "${1:-}" = --stopped-ok ] && [ -n "$recorded" ]; then
    if [ "$actual" = none ] && [ "$(setting QUALY_PROXY caddy)" = none ]; then return 0; fi
    if [ "$actual" = "$recorded" ] && ! running_release "$actual" > /dev/null; then return 0; fi
  fi
  case $actual in
    none | maintenance)
      [ -z "$recorded" ] && return 0
      refuse "the edge serves ${actual} while $env_file records $recorded as serving - an upgrade under maintenance that did not finish, or an edge changed by hand; point it at the color that should serve (deploy/README.md) and run this again"
      ;;
    blue | green)
      running=$(running_release "$actual") ||
        refuse "the edge sends traffic to $actual, but its server is not running; start it ($(color_services "$actual")) or point the edge at the color that runs, then run this again"
      if [ "$actual" != "$recorded" ] || [ "$running" != "$(color_release "$actual")" ]; then
        say "RECONCILED: the edge serves $actual running $running, but $env_file recorded ${recorded:-nothing} serving; recording what serves"
        env_set QUALY_ACTIVE_COLOR "$actual" QUALY_RELEASE "$running" \
          "QUALY_RELEASE_$(upper "$actual")" "$running"
      fi
      ;;
    *)
      refuse "cannot tell which color serves: the edge names neither color's port, or both servers run with no edge to choose between them; settle it by hand (deploy/README.md) and run this again"
      ;;
  esac
}

# what the public address serves, when there is an edge to ask through;
# QUALY_PROXY_CHECK_URL asks the edge at another address than the public one
# (the release smoke's edge is plain http on loopback)
public_serves() {
  local public tries
  [ "$(setting QUALY_PROXY caddy)" = none ] && return 0
  public=$(setting QUALY_PROXY_CHECK_URL "$(env_get QUALY_PUBLIC_URL)")
  [ -n "$public" ] || return 0
  tries=0
  while [ "$tries" -lt 15 ]; do
    [ "$(served_release "$public")" = "$1" ] && return 0
    tries=$((tries + 1))
    sleep 1
  done
  return 1
}

# Runs the deploy job for a release: its migrations, then its web release made
# the store's current one. Prints the job's own words; fails when it does.
deploy_job() {
  QUALY_RELEASE=$1 compose run --rm migrate
}

# Starts the idle color on a release whose deploy job has run, points the
# edge at it once it is ready, and then stops the color that served before -
# after a drain, so requests already on their way finish there. Until the
# edge has moved, the old color serves as it did; a failure before then
# stops the new color and returns non-zero, and the caller puts the web
# release store back.
take_over() {
  local target="$1" release="$2" previous="$3" was address serving drain
  was=$(color_release "$target")
  # the idle color goes back to naming what it ran, so a later rollback
  # returns there rather than to a release that never served
  abandon() {
    compose stop -t 10 $(color_services "$target") > /dev/null 2>&1 || true
    env_set "QUALY_RELEASE_$(upper "$target")" "$was"
  }
  env_set "QUALY_RELEASE_$(upper "$target")" "$release"
  # the service names are three plain words, split on purpose
  if ! compose up -d $(color_services "$target"); then
    abandon
    return 1
  fi
  address=$(color_address "$target")
  say "waiting for $target ($release) at $address"
  if ! wait_ready "$address" "$(setting QUALY_READY_TIMEOUT 180)"; then
    compose logs --no-color --tail 40 "server-$target" >&2 || true
    say "$target did not become ready" >&2
    abandon
    return 1
  fi
  # the first requests pay for what the process loads lazily; better here
  curl -fsS --max-time 10 "$address/" > /dev/null 2>&1 || true
  curl -fsS --max-time 10 "$address/api/app/manifest" > /dev/null 2>&1 || true
  serving=$(served_release "$address")
  say "$target is ready, serving web release $serving"
  if ! proxy_point "$address"; then
    say "the edge could not be pointed at $target; it still points where it did" >&2
    abandon
    return 1
  fi
  if ! public_serves "$serving"; then
    say "the public address does not serve $serving; pointing the edge back" >&2
    if [ -n "$previous" ]; then proxy_point "$(color_address "$previous")" || true; fi
    abandon
    return 1
  fi
  # the edge moved; the record follows in one write, and reconcile() at the
  # start of the next step puts it right if this one never gets here
  env_set QUALY_ACTIVE_COLOR "$target" QUALY_RELEASE "$release"
  say "the edge serves $target"
  if [ -n "$previous" ]; then
    drain=$(setting QUALY_DRAIN_SECONDS 20)
    say "draining $previous for ${drain}s"
    sleep "$drain"
    compose stop -t 40 $(color_services "$previous")
    say "$previous stopped"
  fi
}
