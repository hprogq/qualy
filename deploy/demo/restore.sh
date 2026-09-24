#!/bin/sh
# Puts the public demonstration back to its baseline.
#
#   deploy/demo/restore.sh [baseline-dir]
#
# Run from the deploy directory's parent or anywhere: it finds compose.yaml
# next to this script's directory. The baseline directory (default
# /opt/qualy/demo-baseline) holds qualy-demo.dump and storage.tar.gz, made by
# `pnpm demo:snapshot`. The server is stopped for the restore - Caddy serves
# the maintenance page meanwhile - so no visitor writes into a half-restored
# database.
set -eu

here=$(cd "$(dirname "$0")/.." && pwd)
baseline=${1:-/opt/qualy/demo-baseline}
compose="docker compose -f $here/compose.yaml --env-file $here/.env"

[ -f "$baseline/qualy-demo.dump" ] || { echo "no $baseline/qualy-demo.dump" >&2; exit 1; }
[ -f "$baseline/storage.tar.gz" ] || { echo "no $baseline/storage.tar.gz" >&2; exit 1; }

# the names the deployment uses, from its own .env
set -a
. "$here/.env"
set +a

echo "stopping the server"
$compose stop server

echo "restoring the database $POSTGRES_DB"
$compose exec -T postgres dropdb -U "$POSTGRES_USER" --if-exists --force "$POSTGRES_DB"
$compose exec -T postgres createdb -U "$POSTGRES_USER" "$POSTGRES_DB"
$compose exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl < "$baseline/qualy-demo.dump"

echo "restoring the attachments"
# compose.yaml names the project `qualy`, so its volumes are qualy_<name>
volume=qualy_storage
docker run --rm -v "$volume:/data" -v "$baseline:/in:ro" pgvector/pgvector:pg18-bookworm@sha256:2ba9ca5f2e7daa0f0e7723cba1ee9167bab54efd3640516a44ac1a928dd67e7a \
  sh -c 'find /data -mindepth 1 -delete && tar -xzf /in/storage.tar.gz -C /data && chown -R 1000:1000 /data'

echo "starting the server"
$compose start server
echo "restored from $baseline"
