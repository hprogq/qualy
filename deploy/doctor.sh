#!/bin/sh
# Says whether a deployment is what it should be, and changes nothing.
#
#   deploy/doctor.sh
#
# One line per fact - PASS, WARN or FAIL - and a non-zero exit when anything
# fails: which release .env records and which one the edge actually sends
# traffic to, the serving color's three containers and the images they run,
# its health and the release it serves (and the public address's), the
# database and the collector, how long ago the last whole backup succeeded
# and whether cron will take the next, free disk and memory, containers that
# have restarted, and how long the certificate has left. Runs from anywhere,
# with the .env beside compose.yaml (QUALY_ENV_FILE names another); as root
# on a deployment host, where the backup root is root's alone. It reads; it
# never repairs - that is the deploy scripts' business, run on purpose.
set -u

here=$(cd "$(dirname "$0")" && pwd)
. "$here/lib.sh"
[ -f "$env_file" ] || refuse "no $env_file"

failed=0
report() {
  printf '%-5s %-18s %s\n' "$1" "$2" "$3"
  [ "$1" = FAIL ] && failed=1
  return 0
}

# --- what serves: the record, the fact, and the containers ----------------
release=$(env_get QUALY_RELEASE)
active=$(env_get QUALY_ACTIVE_COLOR)
if [ -n "$release" ] && [ -n "$active" ]; then
  report PASS release "$release on $active (.env)"
else
  report FAIL release ".env records no serving release or color"
fi

root=$(dirname "$env_file")
current=$(readlink "$root/current" 2> /dev/null || true)
case $current in
  *"/$release" | "releases/$release") report PASS current "$current" ;;
  '') report WARN current "$root/current is not a link" ;;
  *) report FAIL current "$current, while .env records $release" ;;
esac

edge=$(serving_color)
if [ "$edge" = "$active" ]; then
  report PASS edge "sends traffic to $edge"
else
  report FAIL edge "sends traffic to $edge, while .env records $active"
fi

running=$(running_release "$active" || true)
if [ "$running" = "$release" ]; then
  report PASS server "server-$active runs qualy-server:$running"
else
  report FAIL server "server-$active runs ${running:-nothing}, not $release"
fi
for service in sandbox-runtime sandbox-authoring; do
  id=$(compose ps -q "$service-$active" 2> /dev/null)
  image=$( [ -n "$id" ] && docker inspect -f '{{.Config.Image}}' "$id" 2> /dev/null)
  state=$( [ -n "$id" ] && docker inspect -f '{{.State.Status}}' "$id" 2> /dev/null)
  if [ "$state" = running ] && [ "$image" = "qualy-$service:$release" ]; then
    report PASS "$service" "$image running"
  else
    report FAIL "$service" "${image:-no container} ${state:-absent}"
  fi
done

# --- whether it answers, and as which release -----------------------------
address=$(color_address "$active")
for probe in live ready; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$address/health/$probe" || true)
  if [ "$code" = 200 ]; then report PASS "$probe" "$address/health/$probe 200"; else report FAIL "$probe" "$address/health/$probe ${code:-no answer}"; fi
done
local_web=$(served_release "$address")
public=$(env_get QUALY_PUBLIC_URL)
if [ -n "$public" ] && [ "$(setting QUALY_PROXY caddy)" != none ]; then
  public_web=$(served_release "$public")
  if [ -n "$local_web" ] && [ "$public_web" = "$local_web" ]; then
    report PASS public "$public serves web release $public_web"
  else
    report FAIL public "$public serves ${public_web:-nothing}, $active serves ${local_web:-nothing}"
  fi
  host=$(printf '%s' "$public" | sed -n 's#^https://\([^/:]*\).*#\1#p')
  if [ -n "$host" ]; then
    ends=$(printf '' | openssl s_client -servername "$host" -connect "$host:443" 2> /dev/null |
      openssl x509 -noout -enddate 2> /dev/null | sed 's/^notAfter=//')
    left=$( [ -n "$ends" ] && echo $(( ($(date -d "$ends" +%s 2> /dev/null || date -j -f '%b %e %T %Y %Z' "$ends" +%s) - $(date +%s)) / 86400 )))
    if [ -z "$left" ]; then report WARN tls "could not read $host's certificate"
    elif [ "$left" -lt 7 ]; then report FAIL tls "$host's certificate ends in $left day(s)"
    elif [ "$left" -lt 21 ]; then report WARN tls "$host's certificate ends in $left days"
    else report PASS tls "$host's certificate has $left days left"; fi
  fi
else
  report PASS web "$active serves web release ${local_web:-nothing}"
fi

# --- what it stands on ------------------------------------------------------
id=$(compose ps -q postgres 2> /dev/null)
health=$( [ -n "$id" ] && docker inspect -f '{{.State.Health.Status}}' "$id" 2> /dev/null)
if [ "$health" = healthy ]; then report PASS postgres healthy; else report FAIL postgres "${health:-not running}"; fi

id=$(compose --profile telemetry ps -q otel-collector 2> /dev/null)
if [ -n "$id" ]; then
  state=$(docker inspect -f '{{.State.Status}}' "$id" 2> /dev/null)
  if [ "$state" = running ]; then report PASS collector running; else report FAIL collector "$state"; fi
else
  report WARN collector "not running: no traces, metrics or logs leave this host"
fi

# a container that restarted says something failed, even when it came back
restarted=
for id in $(compose --profile telemetry ps -q 2> /dev/null); do
  count=$(docker inspect -f '{{.RestartCount}}' "$id" 2> /dev/null || echo 0)
  if [ "${count:-0}" -gt 0 ]; then
    restarted="$restarted $(docker inspect -f '{{.Name}}' "$id" | sed 's#^/##')=$count"
  fi
done
if [ -z "$restarted" ]; then report PASS restarts "none"; else report WARN restarts "${restarted# }"; fi

# --- the backup: when it last succeeded, and whether the next is due -------
backups=$(setting QUALY_BACKUP_ROOT /var/backups/qualy)
if [ -f "$backups/last-success" ]; then
  stamp=$(cat "$backups/last-success")
  at=$(date -u -d "$(printf '%s' "$stamp" | sed 's/\(....\)\(..\)\(..\)T\(..\)\(..\)\(..\)Z/\1-\2-\3 \4:\5:\6/')" +%s 2> /dev/null ||
    date -j -u -f '%Y%m%dT%H%M%SZ' "$stamp" +%s 2> /dev/null)
  if [ -n "$at" ]; then
    hours=$(( ($(date +%s) - at) / 3600 ))
    # daily at 03:17 and about a minute long: over 26 hours is a run missed
    if [ "$hours" -gt 26 ]; then report FAIL backup "last whole backup $stamp, ${hours}h ago"
    else report PASS backup "last whole backup $stamp, ${hours}h ago"; fi
  else
    report FAIL backup "$backups/last-success holds '$stamp', not a stamp"
  fi
else
  report FAIL backup "no $backups/last-success: no backup has ever finished here"
fi
if grep -rqs 'backup.sh' /etc/cron.d /var/spool/cron 2> /dev/null; then
  report PASS cron "a backup is scheduled"
else
  report FAIL cron "no cron entry runs backup.sh"
fi
status=$(setting QUALY_BACKUP_STATUS_DIR)
if [ -n "$status" ]; then
  if [ "$(cat "$status/last-success" 2> /dev/null)" = "$(cat "$backups/last-success" 2> /dev/null)" ]; then
    report PASS reported "the collector reads the same stamp from $status"
  else
    report WARN reported "$status/last-success differs from $backups/last-success"
  fi
fi

# --- room ------------------------------------------------------------------
for dir in "$backups" "$root" /var/lib/docker; do
  [ -d "$dir" ] || continue
  free=$(df -Pm "$dir" | awk 'NR == 2 { print $4 }')
  if [ "$free" -lt 2048 ]; then report FAIL disk "$dir: ${free} MB free"
  elif [ "$free" -lt 5120 ]; then report WARN disk "$dir: ${free} MB free"
  else report PASS disk "$dir: $((free / 1024)) GB free"; fi
done
if [ -r /proc/meminfo ]; then
  available=$(awk '/^MemAvailable:/ { print int($2 / 1024) }' /proc/meminfo)
  if [ "$available" -lt 300 ]; then report WARN memory "${available} MB available"
  else report PASS memory "${available} MB available"; fi
fi

exit "$failed"
