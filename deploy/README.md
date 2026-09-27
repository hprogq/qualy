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
cp .env.example .env         # then fill it in: QUALY_RELEASE, the database password, DATABASE_URL, QUALY_PUBLIC_URL
openssl rand -base64 32      # QUALY_SECRETS_MASTER_KEY: required, and kept with the backups
docker compose up -d postgres
docker compose run --rm migrate          # applies the release's migrations and installs its web release, once
docker compose up -d                     # server, sandbox-runtime, sandbox-authoring
curl -sf http://127.0.0.1:3000/health/ready
```

Then put the edge in front of the published port: `ops/reverse-proxy/` has
the Caddy and nginx shapes (TLS, HSTS, forwarded headers), and
`QUALY_TRUSTED_PROXIES` in `.env` names the peer the container sees, the
compose network's gateway (`.env.example` has it). Check it once the edge is
up: sign in through the public address and look at the sign-in record under
the account's security page, or at the server's json access log. The address
there must be your own public one; a `172.30.53.1` means the proxy is not
trusted and every visitor shares that address in the rate limits. The server
also says so itself: the first request a private or loopback peer forwards
without being named there is logged once, at Warn, naming
`QUALY_TRUSTED_PROXIES`.

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
  QUALY_ADMIN_EMAIL=… QUALY_ADMIN_PASSWORD=… pnpm seed     # from the checkout
docker compose up -d postgres                              # off the host again
```

Give the seed the same `QUALY_DEFAULT_TENANT` as `.env` if you set one: it
creates the tenant by that name, and the server looks for it by that name.
A production server refuses to start while the default tenant does not exist
(never seeded, or the name differs), and while any tenant's system account
has no email or no password at its door, and says which; the order is always
migrate, then seed when it is needed, then start.

The first `migrate` builds the whole schema on the empty database. The
server never migrates on its own: its production command keeps
`QUALY_MIGRATIONS` off, and a start against a database that is behind its
release refuses with the pending migrations named. The same goes for the
browser application: `migrate` installs the release's web bundle into the
`web_releases` volume, and a server whose release is not the one installed
there last refuses to start and says to run `migrate`.

## Upgrading

```sh
deploy/backup.sh /var/backups/qualy      # first, always: an image rollback is not a schema rollback
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
changed.

`migrate` also installs the new release's web bundle into `web_releases`,
beside the ones before it: the newest five and everything installed in the
last 72 hours stay (`QUALY_WEB_RELEASE_RETAIN_COUNT` and
`QUALY_WEB_RELEASE_RETAIN_HOURS` in `.env`). A tab still running the previous
release keeps loading its chunks from there, and when the release did not
change which plugins are enabled its requests are answered as before; it is
offered the new release in a notice and moves when its reader chooses. A
release that enabled or disabled a plugin is the exception: tabs of the
previous one are asked to reload on their next request, because the screens
they carry may no longer have an api behind them.

## Rolling back

Setting `QUALY_RELEASE` back, running `docker compose run --rm migrate` and
then `docker compose up -d` rolls the **image** back. The `migrate` step
finds no migration to apply (the database is ahead of the older release,
and applied migrations it does not know are left alone) and makes the older
release's web bundle the current one again, which its server requires
before it starts. None of this rolls the **schema** back: applied migrations
stay applied, and the older code now runs against the newer schema. That is
safe when the release's migrations only added (columns, tables, indexes),
which is what a reviewed migration should be until the release that
depended on it has settled. If the release's migrations removed or
rewrote something the older code needs, the way back is a fix-forward
release, or a restore from the backup taken before the upgrade, accepting
the writes made since. Take that backup first (next section).

## Backup and restore

`backup.sh` backs the deployment up - the database, then the attachments
the local storage backend keeps in the `storage` volume - into a directory of
its own under the root you give it, checks what it wrote, keeps the newest 14
(`QUALY_BACKUP_KEEP`), and copies the new one off this machine when
`QUALY_BACKUP_OFFSITE` says how (a command run with the directory as `$1`).
Run it daily:

```sh
# crontab of the deployment's operator
17 3 * * * QUALY_BACKUP_OFFSITE='rclone copy "$1" remote:qualy-backups/"$(basename "$1")"' /opt/qualy/deploy/backup.sh /var/backups/qualy >> /var/log/qualy-backup.log 2>&1
```

`/var/backups/qualy/last-success` names the newest whole backup; a monitor
reading its age is how a backup that stopped running gets noticed.
`QUALY_SECRETS_MASTER_KEY` is not in a backup, on purpose: nothing encrypted
in the database can be read without it, so keep it - with the rest of
`.env` - somewhere that is not beside the backups.

`restore.sh` puts one back. It checks the files against their sums, restores
the dump into a scratch database while the server still serves (all or
nothing), then stops the server, swaps the databases (the live one is kept as
`<name>_previous` until the next restore), swaps the attachments in, runs
`migrate` - which brings a backup from an older release up to this one - and
starts everything again:

```sh
deploy/restore.sh /var/backups/qualy/<stamp>
```

A failure before the server stops leaves the deployment as it was; one after
it names the step, and running the script again finishes the job. The
release smoke (`pnpm release:smoke`) drills both scripts on every CI run: a
row and an attachment written before the backup are read back after the
database and the attachments were destroyed and restored.

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
