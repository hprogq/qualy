# Deploying one Qualy release

This directory is the deployment unit: `compose.yaml`, an `.env` you fill in
from `.env.example`, and nothing else. It runs images; it builds nothing and
mounts no source. The design and the reasoning are in
[docs/deployment.md](../docs/deployment.md); this file is the sequence of
commands.

## What a release is

Three images built from one checkout and tagged alike:

| image                               | runs                                                          |
| ----------------------------------- | ------------------------------------------------------------- |
| `qualy-server:<release>`            | the server (default command) and the migration job (`deploy`) |
| `qualy-sandbox-runtime:<release>`   | formula scoring, behind one unix socket                       |
| `qualy-sandbox-authoring:<release>` | formula compilation, behind one unix socket                   |

They are built on a machine with the repository checked out:

```sh
pnpm release:build <release> --check     # tools/release/build-images.ts
```

A named release is built from a snapshot of the commit, not from the working
directory: a detached git worktree of HEAD is the build context of all three
images, so nothing the working directory holds beyond the commit can reach
them. Changes to anything the build reads are refused (commit them, or build
without a name and get a `-dirty` tag, or pass `--allow-dirty`). The images
are built for `linux/amd64` unless `--platform` says otherwise, and once
built they are inspected: same platform, same revision, or the release is
removed. Each image records the commit it came from as
`org.opencontainers.image.revision`.

and moved to the host either through a registry or as a file:

```sh
docker save qualy-server:<release> qualy-sandbox-runtime:<release> qualy-sandbox-authoring:<release> \
  | ssh host docker load
```

## First deployment

```sh
cp .env.example .env         # then fill it in: QUALY_RELEASE, the database password, DATABASE_URL
docker compose up -d postgres
docker compose run --rm migrate          # applies the release's committed migrations, once
docker compose up -d                     # server, sandbox-runtime, sandbox-authoring
curl -sf http://127.0.0.1:3000/health/ready
```

Then put the edge in front of the published port: `ops/reverse-proxy/` has
the Caddy and nginx shapes (TLS, HSTS, forwarded headers), and
`QUALY_TRUSTED_PROXIES` in `.env` names the peer the container sees.

The tenant and its system account - the account the tenant recovers itself
with, which signs in by email and password - are provisioned by the seed,
run from a source checkout of the same release against the deployment's
database (the image carries no seed):

```sh
DATABASE_URL=postgres://… QUALY_ADMIN_EMAIL=… QUALY_ADMIN_PASSWORD=… pnpm seed
```

A production server refuses to start while any tenant's system account has
no email or no password at its door, and says which tenant; the order is
always migrate, then seed when it is needed, then start.

The first `migrate` builds the whole schema on the empty database. The
server never migrates on its own: its production command keeps
`QUALY_MIGRATIONS` off, and a start against a database that is behind its
release refuses with the pending migrations named.

## Upgrading

```sh
# load the new release's three images, then:
sed -i 's/^QUALY_RELEASE=.*/QUALY_RELEASE=<new>/' .env
docker compose run --rm migrate
docker compose up -d
curl -sf http://127.0.0.1:3000/health/ready
```

When the release notes say an upgrade needs the seed (the one that moved the
password door to email sign-in does: the existing system account has no email
until the seed gives it one), run it between `migrate` and `up -d`.

`migrate` runs first and alone. It takes the database's migration lock, so
a second copy waits and then finds nothing to do; a migration that fails is
not recorded, the job exits non-zero, and the old server keeps running until
it is fixed forward. `up -d` then recreates the containers whose image
changed. Browser tabs of the previous release reload themselves when the
server answers their first request with the release mismatch.

## Rolling back

Setting `QUALY_RELEASE` back and running `docker compose up -d` rolls the
**image** back. It does not roll the **schema** back: applied migrations
stay applied, and the older code now runs against the newer schema. That is
safe when the release's migrations only added (columns, tables, indexes),
which is what a reviewed migration should be until the release that
depended on it has settled. If the release's migrations removed or
rewrote something the older code needs, the way back is a fix-forward
release, or a restore from the backup taken before the upgrade, accepting
the writes made since. Take that backup first (next section).

## Backup and restore

The database:

```sh
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > qualy-$(date +%Y%m%d%H%M%S).dump
```

The attachments written by the local storage backend live in the `storage`
volume:

```sh
docker run --rm -v qualy_storage:/data -v "$PWD":/backup alpine tar czf /backup/storage-$(date +%Y%m%d%H%M%S).tgz -C /data .
```

Restoring the database replaces it, with the server stopped:

```sh
docker compose stop server
docker compose exec -T postgres sh -c 'dropdb -U "$POSTGRES_USER" "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner' < qualy-<stamp>.dump
docker compose run --rm migrate       # brings a backup from an older release up to this one
docker compose up -d server
```

## Looking

```sh
docker compose ps
docker compose logs -f server                    # json lines; QUALY_LOG_FORMAT in .env
curl -sf http://127.0.0.1:3000/health/live       # the process answers
curl -sf http://127.0.0.1:3000/health/ready      # the assembly is up and its dependencies answer
```

## Verifying a release before it goes anywhere

From a checkout with the release's images loaded, the release smoke drives
this compose file on a throwaway project: database up, migrate, server up
and ready, shell and manifest served, backup, restore, start again, down.

```sh
node tools/quality/release-smoke.ts <release>
```
