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

A production release is built by the release workflow instead: a `v*` tag
builds, smokes and pushes the three images and records their digests in
`release.json` on the tag's GitHub release. The deploy workflow sends those
digests to the host's launcher (`ops/deploy-host/`), which pulls them, checks
they are one release, takes this directory out of the release's own server
image and runs its `upgrade.sh` - so on that host the scripts below live in
`/opt/qualy/releases/<release>/deploy/`, `.env` and `collector.env` in
`/opt/qualy/`, and `/opt/qualy/current` points at the serving release's
scripts. Elsewhere, images can also be moved as a file:

```sh
docker save qualy-server:<release> qualy-sandbox-runtime:<release> qualy-sandbox-authoring:<release> \
  | ssh host docker load
```

## Two colors

`compose.yaml` runs the release in two colors, blue and green, each a whole
set - the server and both sandboxes - on a port of its own (`QUALY_PORT_BLUE`,
`QUALY_PORT_GREEN`, 3001 and 3002 on loopback). One serves; the other is idle,
stopped on the release it last ran. The edge proxy is pointed at the serving
color through a snippet the site imports (`/etc/caddy/qualy/upstream.caddy`,
see `ops/reverse-proxy/Caddyfile`), which the scripts rewrite, validate and
reload. `.env` records which color serves and which release each color last
ran (`QUALY_ACTIVE_COLOR`, `QUALY_RELEASE_BLUE`, `QUALY_RELEASE_GREEN`); the
scripts write those, not the operator.

## First deployment

```sh
cp .env.example .env         # then fill it in: QUALY_RELEASE, the database password, DATABASE_URL, QUALY_PUBLIC_URL
openssl rand -base64 32      # QUALY_SECRETS_MASTER_KEY: required, and kept with the backups
sudo mkdir -p /etc/caddy/qualy
echo 'error "maintenance" 503' | sudo tee /etc/caddy/qualy/upstream.caddy   # the site needs the snippet to load
docker compose up -d postgres
docker compose run --rm migrate          # applies the release's migrations and installs its web release, once
# the seed, below
deploy/upgrade.sh <release>              # starts blue, waits for it, points the edge at it
```

Then check the edge: `QUALY_TRUSTED_PROXIES` in `.env` names the peer the
container sees, the compose network's gateway (`.env.example` has it). Sign in
through the public address and look at the sign-in record under the account's
security page, or at the server's json access log. The address there must be
your own public one; a `172.30.53.1` means the proxy is not trusted and every
visitor shares that address in the rate limits. The server also says so
itself: the first request a private or loopback peer forwards without being
named there is logged once, at Warn, naming `QUALY_TRUSTED_PROXIES`.

Do not run these commands from a development checkout's working copy against
its own Docker: the deployment is its own project (`qualy-deployment`), but
it still wants a host of its own.

The tenant and its system account - the account the tenant recovers itself
with, which signs in by email and password - are provisioned by the seed,
run from a source checkout of the same release against the deployment's
database (the image carries no seed). The database is on no port, so
`compose.seed.yaml` publishes it on this host's loopback while the seed runs:

```sh
docker compose -f compose.yaml -f compose.seed.yaml up -d postgres
DATABASE_URL=postgres://qualy:<POSTGRES_PASSWORD>@127.0.0.1:55432/qualy \
  QUALY_ADMIN_EMAIL=… QUALY_ADMIN_PASSWORD=… node tools/fixtures/seed-cli.ts   # from the checkout
docker compose up -d postgres                              # off the host again
```

Run the file itself, not `pnpm seed`: `pnpm seed` loads the checkout's own
`.env`, which on a developer's machine is that machine's settings - a
`QUALY_SEED_DEMO=1` there would seed demonstration people into production.
The file reads only the environment it is given.

Give the seed the same `QUALY_DEFAULT_TENANT` as `.env` if you set one: it
creates the tenant by that name, and the server looks for it by that name.
A production server refuses to start while the default tenant does not exist
(never seeded, or the name differs), and while any tenant's system account
has no email or no password at its door, and says which; the order is always
migrate, then seed when it is needed, then start. A demonstration instance
imports a baseline instead of seeding (`demo/README.md`).

The first `migrate` builds the whole schema on the empty database. The
server never migrates on its own: its production command keeps
`QUALY_MIGRATIONS` off, and a start against a database that is behind its
release refuses with the pending migrations named. The same goes for the
browser application: `migrate` installs the release's web bundle into the
`web_releases` volume, and a server whose release is not the one installed
there last refuses to start and says to run `migrate`.

## Upgrading

```sh
# load the new release's three images, then:
deploy/upgrade.sh <new>
```

It checks that the images are here and that the host has room for two colors
at once (`QUALY_UPGRADE_MIN_MEMORY_MB`, `QUALY_UPGRADE_MIN_DISK_MB`), backs up
to `QUALY_BACKUP_ROOT`, runs the deploy job for the new release, starts the
idle color on it and waits until it is ready, points the edge at it and asks
the public address which release it serves, and then, after
`QUALY_DRAIN_SECONDS`, stops the color that served. Nobody sees the switch: a
page that was open keeps working, its live channel reconnects on its own
within seconds, and a tab of the previous release keeps loading its chunks
from `web_releases`. Until the edge has moved, the old color serves as it
did; a failure before then stops the new color, puts the old release back as
the web store's current one and says what failed.

While the colors overlap, both releases run against one database, so each
must work on the schema the other leaves: migrations expand, and what a
release stops using is removed a release later. Every migration says which
it is on a line of its own, `-- rollout: expand` or `-- rollout: maintenance`.
A pending migration that does not say expand (one written before the rule
says nothing, and counts as maintenance) makes the upgrade refuse unless run
with `--maintenance`: the edge shows the maintenance page, the serving color
stops, the job runs, the new color starts. That should be rare. A first
deployment has no serving color, and applies what it finds.

One deployment step runs at a time: `upgrade.sh`, `rollback.sh`,
`restore.sh` and the demo reset take a lock beside `.env` and refuse while
another step holds it. Each first reads which color the edge serves from the
proxy snippet and compares it with `QUALY_ACTIVE_COLOR`: a step stopped
after moving the edge but before writing `.env` is noticed and recorded
(`RECONCILED: ...` in the output); anything the snippet and the running
containers cannot settle is refused for a person to look at.

When the release notes say an upgrade needs the seed (the one that moved the
password door to email sign-in does: the existing system account has no email
until the seed gives it one), run `docker compose run --rm migrate` and the
seed first, then `deploy/upgrade.sh`.

`migrate` takes the database's migration lock, so a second copy waits and
then finds nothing to do; a migration that fails is not recorded, the job
exits non-zero, and the serving color keeps serving until it is fixed
forward. It also installs the new release's web bundle into `web_releases`,
beside the ones before it: the newest five and everything installed in the
last 72 hours stay (`QUALY_WEB_RELEASE_RETAIN_COUNT` and
`QUALY_WEB_RELEASE_RETAIN_HOURS` in `.env`). When the release did not change
which plugins are enabled, a tab of the previous one has its requests
answered as before and is offered the new release in a notice; a release
that enabled or disabled a plugin asks those tabs to reload on their next
request, because the screens they carry may no longer have an api behind
them.

## Rolling back

```sh
deploy/rollback.sh
```

goes back to the release the idle color last ran: the deploy job makes that
release's web bundle the current one again (it applies nothing - the
database is ahead of it, and migrations it does not know are left alone), the
idle color starts, the edge moves, and the other color stops, the same way
an upgrade does. For any other release, use `upgrade.sh`.

None of this rolls the **schema** back: applied migrations stay applied, and
the older code now runs against the newer schema. That is safe when the
release's migrations only added (columns, tables, indexes), which is what a
reviewed migration should be until the release that depended on it has
settled. When one of them does not roll out as expand, or is unknown to the
release that brought it, `rollback.sh` refuses unless `--force` says the
operator has checked; the ways back from there are a fix-forward release, or
a restore from the backup the upgrade took, accepting the writes made since.

## Backup and restore

`backup.sh` backs the deployment up - the database, then the attachments
the local storage backend keeps in the `storage` volume - into a directory of
its own under the root you give it, checks what it wrote, keeps the newest 14
(`QUALY_BACKUP_KEEP`), and copies the new one off this machine when
`QUALY_BACKUP_OFFSITE` says how (a command run with the directory as `$1`).
The destination is append-only: the command must refuse an existing object,
and the remote writer's policy must require that refusal independently of the
host. For COS use a dedicated unversioned backup bucket, `coscli cp -r
--forbid-overwrite=true`, and a CAM condition requiring
`cos:x-cos-forbid-overwrite = true`; a versioned bucket only preserves an old
version while a compromised writer can still put a forged version in front of
it.
Run it daily:

```sh
# crontab of the deployment's operator
17 3 * * * QUALY_BACKUP_OFFSITE='rclone copy --immutable "$1" remote:qualy-backups/"$(basename "$1")"' /opt/qualy/deploy/backup.sh /var/backups/qualy >> /var/log/qualy-backup.log 2>&1
```

`/var/backups/qualy/last-success` names the newest whole backup; a monitor
reading its age is how a backup that stopped running gets noticed.
`QUALY_SECRETS_MASTER_KEY` is not in a backup, on purpose: nothing encrypted
in the database can be read without it, so keep it - with the rest of
`.env` - somewhere that is not beside the backups.

`restore.sh` puts one back. It checks the files against their sums, restores
the dump into a scratch database while the serving color still serves (all
or nothing), then stops that color, swaps the databases (the live one is kept
as `<name>_previous` until the next restore), swaps the attachments in, runs
`migrate` - which brings a backup from an older release up to this one - and
starts the color again:

```sh
deploy/restore.sh /var/backups/qualy/<stamp>
```

A failure before the server stops leaves the deployment as it was; one after
it names the step, and running the script again finishes the job. The
release smoke (`pnpm release:smoke`) drills both scripts on every CI run: a
row and an attachment written before the backup are read back after the
database and the attachments were destroyed and restored.

## Telemetry

The collector is the one process that knows Tencent Cloud: `otel-collector.yaml`
beside `compose.yaml`, with its credentials in `collector.env` (copied from
`collector.env.example`; the server never sees any of it). Start it once, and
upgrades leave it running:

```sh
docker compose --profile telemetry up -d otel-collector
```

and point the server at it in `.env` (`OTEL_EXPORTER_OTLP_ENDPOINT`,
`OTEL_LOGS_EXPORTER`, `QUALY_INSTANCE_ID`). Traces, metrics and logs then go
out over the region's private-network endpoints. An endpoint it cannot reach
is a retry in the background, never a failed start.

## Staging

The same compose file, pulled up on demand on the same host and taken down
once a release has been checked on it, with `compose.staging.yaml` adding a
Mailpit that catches every mail it sends. It has an env file of its own,
`staging.env` (from `.env.example`), which keeps it apart from production:

```sh
COMPOSE_PROJECT_NAME=qualy-staging          # its own containers, volumes and network
QUALY_COMPOSE_OVERLAY=compose.staging.yaml  # the scripts add the overlay
QUALY_PORT_BLUE=3011
QUALY_PORT_GREEN=3012
QUALY_NETWORK_SUBNET=172.30.54.0/24
QUALY_NETWORK_GATEWAY=172.30.54.1           # and QUALY_TRUSTED_PROXIES to match
QUALY_PROXY_UPSTREAM=/etc/caddy/qualy-staging/upstream.caddy
QUALY_PUBLIC_URL=https://qualy-staging.example.edu
QUALY_MAIL_DEFAULT_BACKEND=smtp             # into Mailpit, see compose.staging.yaml
QUALY_RUM_TENCENT_ENV=pre
```

Every script takes it through `QUALY_ENV_FILE`:

```sh
QUALY_ENV_FILE=/opt/qualy/deploy/staging.env deploy/upgrade.sh <release>
QUALY_ENV_FILE=/opt/qualy/deploy/staging.env deploy/rollback.sh
docker compose -f compose.yaml -f compose.staging.yaml --env-file staging.env \
  --profile blue --profile green --profile telemetry down   # when it has been checked
```

Nothing is shared with production but the host: while both run, the host
carries two databases and up to four colors, so staging is up only while a
release is being checked.

## Looking

```sh
docker compose ps
docker compose logs -f server-blue               # json lines; QUALY_LOG_FORMAT in .env
curl -sf http://127.0.0.1:3001/health/live       # the process answers
curl -sf http://127.0.0.1:3001/health/ready      # the assembly is up and its dependencies answer
```

(3001 is blue, 3002 green; `QUALY_ACTIVE_COLOR` in `.env` says which serves.)

## Verifying a release before it goes anywhere

From a checkout with the release's images loaded, the release smoke drives
this compose file and these scripts on a throwaway project: database up,
migrate, seed, the first color up through `upgrade.sh`, shell and manifest
served, an upgrade to the other color and a rollback, both refusals (a
migration pending that does not roll out as expand, a migration the older
release does not know),
backup, restore, start again, down.

```sh
node tools/quality/release-smoke.ts <release>
```
