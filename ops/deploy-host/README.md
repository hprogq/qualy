# The deployment host's launcher

`qualy-deploy` is what the deploy workflow reaches on the server, and the one
piece of a deployment that does not come with a release. Everything else it
runs - `upgrade.sh`, `rollback.sh`, `lib.sh`, the compose files - is taken out
of the release's own server image, pulled by digest from the registry named
below. The workflow can choose a published release and nothing else: not a
registry, not an image name, not a script.

## What it leaves on the host

```text
/usr/local/sbin/qualy-deploy     this file, root:root 0755
/etc/qualy/deploy.conf           QUALY_DEPLOY_REGISTRY, QUALY_DEPLOY_ROOT; root:root 0644
/opt/qualy/.env                  the deployment's settings (deploy/.env.example); root 0600
/opt/qualy/collector.env         the telemetry uplink's credentials; root 0600
/opt/qualy/releases/<release>/   each release's deploy/, as its server image carries it; root-owned
/opt/qualy/current               -> releases/<the release .env records as serving>
```

`.env`, `collector.env` and the Caddy snippet never come from an image; a
release's scripts find the first two beside each other through
`QUALY_ENV_FILE`, which the launcher sets.

## Installing it

As root, from a reviewed checkout of this repository:

```sh
install -o root -g root -m 0755 ops/deploy-host/qualy-deploy /usr/local/sbin/qualy-deploy
install -d -o root -g root -m 0755 /etc/qualy /opt/qualy
printf 'QUALY_DEPLOY_REGISTRY=%s\nQUALY_DEPLOY_ROOT=/opt/qualy\n' docker.cnb.cool/<org>/<repo> > /etc/qualy/deploy.conf

# the registry, read-only: the token can pull and nothing else
docker login docker.cnb.cool -u cnb          # paste the read-only token

# the account the workflow signs in as: no shell use, no docker group
adduser --system --group --shell /bin/sh --home /var/lib/qualy-deploy qualy-deploy
echo 'qualy-deploy ALL=(root) NOPASSWD: /usr/local/sbin/qualy-deploy' > /etc/sudoers.d/qualy-deploy
chmod 0440 /etc/sudoers.d/qualy-deploy && visudo -cf /etc/sudoers.d/qualy-deploy
install -d -o qualy-deploy -g qualy-deploy -m 0700 /var/lib/qualy-deploy/.ssh
# one line, the workflow's public key behind every restriction there is
echo 'restrict,command="/usr/local/sbin/qualy-deploy" ssh-ed25519 AAAA... github-actions' \
  > /var/lib/qualy-deploy/.ssh/authorized_keys
chown qualy-deploy: /var/lib/qualy-deploy/.ssh/authorized_keys && chmod 0600 /var/lib/qualy-deploy/.ssh/authorized_keys
```

`restrict` turns off port, agent and X11 forwarding, the PTY and `~/.ssh/rc`;
the forced command means whatever the client asks to run arrives as
`SSH_ORIGINAL_COMMAND`, which the launcher splits into words and checks as
root. If sshd limits who may sign in (`AllowUsers`, `AllowGroups`), add
`qualy-deploy` there.

The launcher is updated the same way it was installed: by root, from a
reviewed checkout, never by a release or by the workflow.

## Using it

The deploy workflow (`.github/workflows/deploy.yml`) runs
`deploy <release> <three digests>` from the release's `release.json`, or
`rollback`. By hand, as root:

```sh
qualy-deploy check
qualy-deploy fetch v0.1.0 sha256:... sha256:... sha256:...   # pull, verify, extract; runs nothing
QUALY_ENV_FILE=/opt/qualy/.env /opt/qualy/current/deploy/backup.sh /var/backups/qualy
```

A first deployment fetches the release, then imports its data with the
release's own scripts (`/opt/qualy/releases/<release>/deploy/demo/restore.sh`,
or migrate and seed as `deploy/README.md` says) before the first `deploy`.
