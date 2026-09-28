# Shared by upgrade.sh, rollback.sh, restore.sh, backup.sh and
# demo/restore.sh; sourced, never run. POSIX sh.
#
# The scripts never source .env: a value in it (a sender like `Name <addr>`)
# need not be valid shell. They read the few keys they need with env_get, and
# write the ones that are theirs - which release each color runs, which color
# serves - with env_set, so a plain `docker compose ps` or `up` afterwards
# sees what the scripts left.

here=${here:?lib.sh expects $here to name the deploy directory}
env_file=${QUALY_ENV_FILE:-$here/.env}

compose() {
  docker compose -f "$here/compose.yaml" --env-file "$env_file" "$@"
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
  value=$(sed -n "s/^$1=//p" "$env_file" | tail -n 1)
  if [ -n "$value" ]; then printf '%s' "$value"; else printf '%s' "${2:-}"; fi
}

# writes one key of .env in place, or adds it; values here are release tags
# and color names, never anything a sed pattern could misread
env_set() {
  if grep -q "^$1=" "$env_file"; then
    sed "s|^$1=.*|$1=$2|" "$env_file" > "$env_file.next"
    cat "$env_file.next" > "$env_file"
    rm -f "$env_file.next"
  else
    printf '%s=%s\n' "$1" "$2" >> "$env_file"
  fi
}

# a setting the operator's environment gives, else .env, else the default
setting() {
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
  bind=$(env_get QUALY_BIND 127.0.0.1)
  case $bind in 0.0.0.0 | '') bind=127.0.0.1 ;; esac
  printf 'http://%s:%s' "$bind" "$(color_port "$1")"
}

require_images() {
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
  address=$1
  deadline=$(($(date +%s) + ${2:-180}))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if curl -fsS --max-time 5 "$address/health/ready" > /dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}

# Enough room to run two colors for a minute, and to take a backup and a new
# image. Measured where it can be (Linux); said where it cannot.
preflight() {
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

# the migrations a release's image carries, and those approved as destructive
lineage_of() {
  docker run --rm --entrypoint sh "qualy-server:$1" -c 'cd db/migrations && ls -1 *.sql'
}
destructive_in() {
  docker run --rm --entrypoint sh "qualy-server:$1" -c \
    'cd db/migrations && grep -l -F -e "-- destructive: approved" *.sql || true'
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
  proxy=$(setting QUALY_PROXY caddy)
  [ "$proxy" = none ] && return 0
  [ "$proxy" = caddy ] || refuse "QUALY_PROXY is $proxy; caddy and none are understood"
  snippet=$(setting QUALY_PROXY_UPSTREAM /etc/caddy/qualy/upstream.caddy)
  validate=$(setting QUALY_PROXY_VALIDATE 'caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile')
  reload=$(setting QUALY_PROXY_RELOAD 'systemctl reload caddy')
  previous=
  [ -f "$snippet" ] && previous=$(cat "$snippet")
  if [ "$1" = maintenance ]; then
    # handled by the site's handle_errors, which serves the maintenance page
    printf 'error "maintenance" 503\n' > "$snippet"
  else
    target=${1#http://}
    cat > "$snippet" << CADDY
reverse_proxy $target {
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
  printf '%s\n' "$previous" > "$snippet"
  sh -c "$reload" > /dev/null 2>&1 || true
  return 1
}

# what the public address serves, when there is an edge to ask through
public_serves() {
  [ "$(setting QUALY_PROXY caddy)" = none ] && return 0
  public=$(env_get QUALY_PUBLIC_URL)
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
  target=$1
  release=$2
  previous=$3
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
  env_set QUALY_ACTIVE_COLOR "$target"
  env_set QUALY_RELEASE "$release"
  say "the edge serves $target"
  if [ -n "$previous" ]; then
    drain=$(setting QUALY_DRAIN_SECONDS 20)
    say "draining $previous for ${drain}s"
    sleep "$drain"
    compose stop -t 40 $(color_services "$previous")
    say "$previous stopped"
  fi
}
