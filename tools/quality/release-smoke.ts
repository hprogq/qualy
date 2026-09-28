import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { repoRoot } from '../lib/manifest.ts'

// One release, deployed the way deploy/compose.yaml deploys it, on a
// throwaway compose project - and taken through the moves a deployment makes.
//
//   node tools/quality/release-smoke.ts <release>
//
// The images qualy-server:<release>, qualy-sandbox-runtime:<release> and
// qualy-sandbox-authoring:<release> must exist (pnpm release:build). In
// order: the database comes up; a server started before the migration job
// refuses; the job applies the lineage and installs the image's web release
// into the deployment's release store; a server started before the seed
// refuses; the seed runs from this checkout through compose.seed.yaml;
// deploy/upgrade.sh brings the first color up and it reports ready, serving
// that release; the shell, the manifest and one hashed asset are served; a
// server pointed at a store its release was never installed in refuses,
// naming the job; both sandboxes answer the RPC handshake from inside the
// server container; a second migration run finds nothing to do; the operator
// sets a password from the environment; an upgrade with a migration pending
// that does not roll out as expand refuses, and one without moves the
// deployment onto the other color; a rollback whose older release does not
// know a migration the database ran refuses, and one that does moves it
// back; deploy/backup.sh backs the database and the attachments up, both are
// destroyed, and deploy/restore.sh brings them back, up to date and served,
// with a row and an attachment written before the backup intact. On Linux a
// real Caddy stands in front throughout, and every move is checked through
// it. Then everything, volumes and the second release's tags included, is
// removed.

const release = process.argv[2]
if (!release) {
  console.error('usage: node tools/quality/release-smoke.ts <release>')
  process.exit(2)
}

const project = `qualy-smoke-${process.pid.toString(36)}`
const composeFile = path.join(repoRoot, 'deploy/compose.yaml')
// what publishes the database on this host's loopback while the seed runs
const seedComposeFile = path.join(repoRoot, 'deploy/compose.seed.yaml')
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-release-smoke-'))
const envFile = path.join(work, 'smoke.env')

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = net.createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (address === null || typeof address === 'string') reject(new Error('no port'))
        else resolve(address.port)
      })
    })
  })
const bluePort = await freePort()
const greenPort = await freePort()
const seedPort = await freePort()
const blue = `http://127.0.0.1:${String(bluePort)}`
const green = `http://127.0.0.1:${String(greenPort)}`
// the same images under a second name: an upgrade and a rollback need two
// releases, and what differs between them is not what is under test
const next = `${release}-next`

// A real Caddy in front of the colors, as a deployment has: the scripts
// rewrite its snippet, validate and reload it through the container, and ask
// through it which release it serves. They point it at 127.0.0.1:<port>,
// which a container reaches only on the host's own network - Linux's; under
// Docker Desktop that network is a VM's, so there the scripts run with no
// edge and ask each color directly, and the smoke says so.
const EDGE_IMAGE =
  'caddy:2.11.4-alpine@sha256:6aeddd44c3078b0f9a35206472a11420648a79c184603ef95957d0a20044cb2b'
const withEdge = process.platform === 'linux'
const edgePort = await freePort()
const edgeAdminPort = await freePort()
const edgeName = `${project}-edge`
const edgeDir = path.join(work, 'edge')
const edge = `http://127.0.0.1:${String(edgePort)}`
const inEdge = (command: string) =>
  `docker exec ${edgeName} caddy ${command} --config /etc/caddy/qualy/Caddyfile --adapter caddyfile`

fs.writeFileSync(
  envFile,
  [
    `QUALY_RELEASE=${release}`,
    'POSTGRES_USER=qualy',
    'POSTGRES_PASSWORD=smoke',
    'POSTGRES_DB=qualy',
    'DATABASE_URL=postgres://qualy:smoke@postgres:5432/qualy',
    `QUALY_SECRETS_MASTER_KEY=${randomBytes(32).toString('base64')}`,
    // a sender and a relay; nothing is sent while the smoke runs
    'QUALY_MAIL_FROM=Qualy <no-reply@qualy.invalid>',
    'QUALY_MAIL_SMTP_HOST=127.0.0.1',
    'QUALY_MAIL_SMTP_PORT=1025',
    'QUALY_MAIL_SMTP_TLS=none',
    'QUALY_MAIL_SMTP_ALLOW_PLAINTEXT=1',
    // and a key for resend, whichever of the two the manifest enables
    'QUALY_MAIL_RESEND_API_KEY=re_smoke_only',
    // the address it is reached at, which a production process needs to start
    `QUALY_PUBLIC_URL=https://qualy.invalid`,
    `QUALY_PORT_BLUE=${String(bluePort)}`,
    `QUALY_PORT_GREEN=${String(greenPort)}`,
    `QUALY_SEED_PORT=${String(seedPort)}`,
    ...(withEdge
      ? [
          'QUALY_PROXY=caddy',
          `QUALY_PROXY_UPSTREAM=${path.join(edgeDir, 'upstream.caddy')}`,
          `QUALY_PROXY_VALIDATE=${inEdge('validate')}`,
          `QUALY_PROXY_RELOAD=${inEdge('reload')}`,
          `QUALY_PROXY_CHECK_URL=${edge}`,
        ]
      : ['QUALY_PROXY=none']),
    'QUALY_DRAIN_SECONDS=2',
    // the copy off the machine, read from this file as a deployment's is:
    // here it copies into the work directory instead of a bucket
    `QUALY_BACKUP_OFFSITE=cp -R "$1" ${JSON.stringify(path.join(work, 'offsite'))}/`,
    // an address plan of its own, clear of a deployment on the same host
    'QUALY_NETWORK_SUBNET=172.30.54.0/24',
    'QUALY_NETWORK_GATEWAY=172.30.54.1',
    'QUALY_LOG_FORMAT=json',
    'QUALY_LOG_LEVEL=info',
    '',
  ].join('\n'),
)

interface Ran {
  readonly code: number
  readonly out: string
  readonly stdout: Buffer
}
const compose = (
  args: readonly string[],
  options: { input?: Buffer; timeoutMs?: number; seeding?: boolean } = {},
): Ran => {
  const files = options.seeding === true ? [composeFile, seedComposeFile] : [composeFile]
  const ran = spawnSync(
    'docker',
    [
      'compose',
      '--project-name',
      project,
      ...files.flatMap((file) => ['--file', file]),
      '--env-file',
      envFile,
      ...args,
    ],
    {
      cwd: repoRoot,
      env: { ...process.env, QUALY_ENV_FILE: envFile },
      input: options.input,
      maxBuffer: 256 * 1024 * 1024,
      timeout: options.timeoutMs ?? 300_000,
    },
  )
  const stdout = ran.stdout ?? Buffer.alloc(0)
  return {
    code: ran.status ?? 1,
    out: `${stdout.toString('utf8')}${(ran.stderr ?? Buffer.alloc(0)).toString('utf8')}`.trim(),
    stdout,
  }
}

let failed = false
const step = (line: string) => console.log(`release-smoke: ${line}`)

/** a line of the env file, exactly: a release name's dots are dots */
const envLine = (line: string) =>
  new RegExp(`^${line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm')
class SmokeFailed extends Error {}
// a declaration, not an arrow in a const: only a name with an explicit type
// narrows the code after the call, and `never` is what the callers lean on
function refuse(line: string): never {
  throw new SmokeFailed(line)
}
const expectCode = (label: string, ran: Ran, want: number) => {
  if (ran.code !== want)
    refuse(
      `${label}: exited ${String(ran.code)}, expected ${String(want)}:\n${ran.out.slice(-2000)}`,
    )
}
const expectIn = (label: string, haystack: string, needle: string | RegExp) => {
  const found = typeof needle === 'string' ? haystack.includes(needle) : needle.test(haystack)
  if (!found) refuse(`${label}: expected ${String(needle)} in:\n${haystack.slice(-2000)}`)
}

const waitReady = async (label: string, base = blue, timeoutMs = 120_000) => {
  const deadline = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/health/ready`)
      if (response.status === 200) {
        step(`${label}: /health/ready 200`)
        return
      }
      last = `status ${String(response.status)}`
    } catch (error) {
      last = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  refuse(`${label}: not ready within ${String(timeoutMs)}ms (${last})`)
}

const psql = (sql: string): Ran =>
  compose([
    'exec',
    '-T',
    'postgres',
    'sh',
    '-c',
    `psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c ${JSON.stringify(sql)}`,
  ])

// the deploy scripts, as an operator runs them, on this project and env file
const deployScript = (name: string, args: readonly string[]) => {
  const ran = spawnSync(path.join(repoRoot, 'deploy', name), args, {
    cwd: work,
    env: { ...process.env, COMPOSE_PROJECT_NAME: project, QUALY_ENV_FILE: envFile },
    encoding: 'utf8',
    timeout: 600_000,
  })
  return { code: ran.status ?? 1, out: `${ran.stdout}${ran.stderr}`.trim() }
}

const IMAGES = ['qualy-server', 'qualy-sandbox-runtime', 'qualy-sandbox-authoring'] as const
const tag = (from: string, to: string) => {
  for (const image of IMAGES) {
    const ran = spawnSync('docker', ['tag', `${image}:${from}`, `${image}:${to}`])
    if (ran.status !== 0) refuse(`docker tag ${image}:${from} ${image}:${to} failed`)
  }
}
const untag = (name: string) => {
  for (const image of IMAGES) spawnSync('docker', ['rmi', `${image}:${name}`])
}

// every color and every one-off service, so teardown reaches them all
const EVERY_PROFILE = ['blue', 'green', 'tools', 'deploy'].flatMap((name) => ['--profile', name])

/** the edge sends traffic to this port, and what is there answers through it */
const edgeOn = async (label: string, port: number) => {
  if (!withEdge) return
  const snippet = fs.readFileSync(path.join(edgeDir, 'upstream.caddy'), 'utf8')
  expectIn(label, snippet, `reverse_proxy 127.0.0.1:${String(port)} {`)
  const answered = await fetch(`${edge}/health/ready`, { signal: AbortSignal.timeout(5000) })
  if (answered.status !== 200) refuse(`${label}: the edge answered ${String(answered.status)}`)
  step(`${label}: caddy sends traffic to 127.0.0.1:${String(port)}, and it answers`)
}

const reachable = async (base: string) => {
  try {
    await fetch(`${base}/health/live`, { signal: AbortSignal.timeout(3000) })
    return true
  } catch {
    return false
  }
}

try {
  // --- the database
  expectCode('postgres up', compose(['up', '-d', '--wait', 'postgres']), 0)
  step('postgres up')

  // --- a start before the migration job: refused, naming the job
  {
    const ran = compose(['run', '--rm', '--no-deps', 'tools'], { timeoutMs: 120_000 })
    if (ran.code === 0) refuse('a server started before the migration job did not refuse')
    expectIn('start before migrate', ran.out, /migration\(s\) behind/)
    expectIn('start before migrate', ran.out, 'startup failed')
    step('a server started before the migration job refuses, naming the job')
  }

  // --- the migration job: the lineage, then the web release into its store
  let installed = ''
  {
    const ran = compose(['run', '--rm', 'migrate'])
    expectCode('migrate', ran, 0)
    expectIn('migrate', ran.out, /applied \d+ migration\(s\)/)
    step(`migrate: ${ran.out.split('\n').find((line) => line.includes('applied')) ?? 'applied'}`)
    installed =
      /web-release: (\S+) installed into \/var\/lib\/qualy\/web/.exec(ran.out)?.[1] ??
      refuse(`migrate installed no web release:\n${ran.out.slice(-2000)}`)
    step(`migrate: web release ${installed} installed into the deployment's store`)
  }

  // --- a start before the seed: refused, naming the default tenant
  {
    const ran = compose(['run', '--rm', '--no-deps', 'tools'], { timeoutMs: 120_000 })
    if (ran.code === 0) refuse('a server started before the seed did not refuse')
    expectIn('start before seed', ran.out, 'QUALY_DEFAULT_TENANT')
    step('a server started before the seed refuses, naming the default tenant')
  }

  // --- the seed, from this checkout, the way deploy/README.md runs it
  {
    expectCode(
      'postgres published for the seed',
      compose(['up', '-d', '--wait', 'postgres'], { seeding: true }),
      0,
    )
    const seeded = spawnSync(
      process.execPath,
      [path.join(repoRoot, 'tools/fixtures/seed-cli.ts')],
      {
        // a directory with no .env in it: the seed takes only what it is given
        cwd: work,
        env: {
          ...process.env,
          DATABASE_URL: `postgres://qualy:smoke@127.0.0.1:${String(seedPort)}/qualy`,
          QUALY_ADMIN_EMAIL: 'admin@qualy.invalid',
          QUALY_ADMIN_PASSWORD: randomBytes(18).toString('base64url'),
        },
        encoding: 'utf8',
        timeout: 120_000,
      },
    )
    if (seeded.status !== 0) {
      refuse(
        `seed exited ${String(seeded.status)}:\n${`${seeded.stdout}${seeded.stderr}`.slice(-2000)}`,
      )
    }
    expectIn('seed', seeded.stdout, 'seed complete: tenant +1')
    expectCode('postgres unpublished', compose(['up', '-d', '--wait', 'postgres']), 0)
    step('seed: the default tenant and its system account, then the database off the host again')
  }

  // --- the edge, before anything serves: the maintenance page, as a first
  // deployment's snippet starts (deploy/README.md)
  if (withEdge) {
    fs.mkdirSync(edgeDir)
    fs.writeFileSync(
      path.join(edgeDir, 'Caddyfile'),
      [
        '{',
        `\tadmin 127.0.0.1:${String(edgeAdminPort)}`,
        '\tauto_https off',
        '}',
        `http://127.0.0.1:${String(edgePort)} {`,
        '\tbind 127.0.0.1',
        '\timport /etc/caddy/qualy/upstream.caddy',
        '\thandle_errors 502 503 504 {',
        '\t\trespond "maintenance" 503',
        '\t}',
        '}',
        '',
      ].join('\n'),
    )
    fs.writeFileSync(path.join(edgeDir, 'upstream.caddy'), 'error "maintenance" 503\n')
    const started = spawnSync(
      'docker',
      [
        'run',
        '-d',
        '--name',
        edgeName,
        '--network',
        'host',
        '-v',
        `${edgeDir}:/etc/caddy/qualy`,
        EDGE_IMAGE,
        'caddy',
        'run',
        '--config',
        '/etc/caddy/qualy/Caddyfile',
        '--adapter',
        'caddyfile',
      ],
      { encoding: 'utf8' },
    )
    if (started.status !== 0) refuse(`caddy did not start: ${started.stderr}`)
    const deadline = Date.now() + 30_000
    let status = 0
    while (Date.now() < deadline && status !== 503) {
      status = await fetch(edge, { signal: AbortSignal.timeout(2000) }).then(
        (response) => response.status,
        () => 0,
      )
      if (status !== 503) await new Promise((resolve) => setTimeout(resolve, 500))
    }
    if (status !== 503) refuse(`caddy answered ${String(status)}, not the maintenance page`)
    step('caddy in front, serving the maintenance page')
  } else {
    step(`no edge: docker's host network is not this machine's on ${process.platform}`)
  }

  // --- the first color, through the script every later release goes through
  {
    const ran = deployScript('upgrade.sh', [release])
    if (ran.code !== 0)
      refuse(`upgrade.sh (first) exited ${String(ran.code)}:\n${ran.out.slice(-3000)}`)
    expectIn('first upgrade', ran.out, `upgraded to ${release} on blue`)
    step('upgrade.sh: the first color, blue, up and serving')
  }
  await waitReady('first start')
  await edgeOn('first start', bluePort)

  // --- what it serves: the release the job installed, the shell, one hashed asset, the manifest
  {
    const base = blue
    const probe = await fetch(`${base}/__qualy/release`)
    if (probe.status !== 200) refuse(`GET /__qualy/release status ${String(probe.status)}`)
    const served = ((await probe.json()) as { releaseId?: unknown }).releaseId
    if (served !== installed)
      refuse(`the server serves ${String(served)}, the job installed ${installed}`)
    step(`serving web release ${installed}`)
    const shell = await fetch(`${base}/`)
    if (shell.status !== 200) refuse(`GET / status ${String(shell.status)}`)
    const html = await shell.text()
    expectIn('shell', html, '<!doctype html')
    const asset = /(?:src|href)="(\/[^"]+\.(?:js|css))"/.exec(html)?.[1]
    if (asset === undefined) refuse('the shell references no built asset')
    const fetched = await fetch(`${base}${asset}`)
    if (fetched.status !== 200) refuse(`GET ${asset} status ${String(fetched.status)}`)
    step(`shell and ${asset} served`)
    const manifest = await fetch(`${base}/api/app/manifest`)
    if (manifest.status !== 200) refuse(`manifest status ${String(manifest.status)}`)
    const body = (await manifest.json()) as { pages?: unknown[] }
    if (!Array.isArray(body.pages)) refuse('the manifest carries no pages')
    step(`manifest: ${String(body.pages.length)} page(s) for an anonymous visitor`)
  }

  // --- a store the image's release was never installed in: refused, naming the job
  {
    const ran = compose(
      ['run', '--rm', '--no-deps', '-e', 'QUALY_WEB_RELEASE_STORE=/tmp', 'tools'],
      { timeoutMs: 120_000 },
    )
    if (ran.code === 0) refuse('a server whose release store lacks its release did not refuse')
    expectIn('start without its web release', ran.out, 'run the deploy job')
    step('a server whose release was never installed in its store refuses, naming the job')
  }

  // --- the sandbox pair, over their sockets, from inside the server
  {
    const ran = compose([
      'exec',
      '-T',
      'server-blue',
      'node',
      'apps/cli/src/main.ts',
      'sandbox',
      'status',
    ])
    expectCode('sandbox status', ran, 0)
    expectIn('sandbox status', ran.out, 'runtime ok')
    expectIn('sandbox status', ran.out, 'authoring ok')
    for (const line of ran.out.split('\n')) step(line)
  }

  // --- the job again: nothing to do
  {
    const ran = compose(['run', '--rm', 'migrate'])
    expectCode('migrate again', ran, 0)
    expectIn('migrate again', ran.out, 'is up to date')
    expectIn('migrate again', ran.out, `web-release: ${installed} was already installed`)
    step('migrate again: up to date, the web release already installed')
  }

  // --- the operator gives an account a password, from the environment only
  {
    const ran = compose([
      'run',
      '--rm',
      '--no-deps',
      '-T',
      '-e',
      `SMOKE_PASSWORD=${randomBytes(18).toString('base64url')}`,
      'tools',
      'node',
      'apps/cli/src/main.ts',
      'auth',
      'set-password',
      '--email',
      'admin@qualy.invalid',
      '--from-env',
      'SMOKE_PASSWORD',
    ])
    expectCode('auth set-password', ran, 0)
    expectIn('auth set-password', ran.out, 'password for admin@qualy.invalid in default replaced')
    step('auth set-password: the system account given a password from the environment')
  }

  // --- an upgrade with a migration pending that does not roll out as
  // expand: refused, nothing changed. The one hidden predates the rollout
  // line and says nothing, which counts as maintenance.
  const ledger = (sql: string) => psql(sql)
  {
    const holding = '20260809085658_batch-scope-node-set.sql'
    expectCode(
      'hide a ledger row',
      ledger(`delete from mikro_orm_migrations where name = '${holding}'`),
      0,
    )
    tag(release, next)
    const ran = deployScript('upgrade.sh', [next])
    expectCode(
      'restore the ledger row',
      ledger(`insert into mikro_orm_migrations (name, executed_at) values ('${holding}', now())`),
      0,
    )
    if (ran.code === 0) refuse('an upgrade with a maintenance migration pending did not refuse')
    expectIn('maintenance upgrade', ran.out, holding)
    expectIn('maintenance upgrade', ran.out, '--maintenance')
    if ((await fetch(`${blue}/health/ready`)).status !== 200)
      refuse('blue stopped serving after a refused upgrade')
    step('upgrade.sh: a maintenance migration pending is refused, blue still serving')
  }

  // --- an upgrade: green takes over, blue stops
  {
    const ran = deployScript('upgrade.sh', [next])
    if (ran.code !== 0) refuse(`upgrade.sh exited ${String(ran.code)}:\n${ran.out.slice(-3000)}`)
    expectIn('upgrade', ran.out, `upgraded to ${next} on green`)
    await waitReady('after the upgrade', green)
    if (await reachable(blue)) refuse('blue still answers after the upgrade')
    const env = fs.readFileSync(envFile, 'utf8')
    expectIn('env after upgrade', env, /^QUALY_ACTIVE_COLOR=green$/m)
    expectIn('env after upgrade', env, envLine(`QUALY_RELEASE_GREEN=${next}`))
    step(`upgrade.sh: green serves ${next}, blue stopped with ${release} kept for rollback`)
    await edgeOn('after the upgrade', greenPort)
  }

  // --- a rollback past a migration the older release does not know: refused.
  // It starts from .env as a step stopped after moving the edge and before
  // recording it leaves it - still naming blue - and first records what
  // actually serves.
  {
    const unknown = '29990101000000_not-in-any-release.sql'
    expectCode(
      'an unknown ledger row',
      ledger(`insert into mikro_orm_migrations (name, executed_at) values ('${unknown}', now())`),
      0,
    )
    fs.writeFileSync(
      envFile,
      fs
        .readFileSync(envFile, 'utf8')
        .replace(/^QUALY_ACTIVE_COLOR=green$/m, 'QUALY_ACTIVE_COLOR=blue')
        .replace(/^QUALY_RELEASE=.*$/m, `QUALY_RELEASE=${release}`),
    )
    const ran = deployScript('rollback.sh', [])
    expectCode(
      'remove the unknown row',
      ledger(`delete from mikro_orm_migrations where name = '${unknown}'`),
      0,
    )
    expectIn('reconcile', ran.out, `RECONCILED: the edge serves green running ${next}`)
    const env = fs.readFileSync(envFile, 'utf8')
    expectIn('env after reconcile', env, /^QUALY_ACTIVE_COLOR=green$/m)
    expectIn('env after reconcile', env, envLine(`QUALY_RELEASE=${next}`))
    step('rollback.sh: .env left naming blue is brought back to green, which serves')
    if (ran.code === 0) refuse('a rollback past an unknown migration did not refuse')
    expectIn('unknown rollback', ran.out, unknown)
    step('rollback.sh: a migration the older release does not know is refused')
  }

  // --- a rollback: blue takes over again, green stops
  {
    const ran = deployScript('rollback.sh', [])
    if (ran.code !== 0) refuse(`rollback.sh exited ${String(ran.code)}:\n${ran.out.slice(-3000)}`)
    expectIn('rollback', ran.out, `rolled back to ${release} on blue`)
    await waitReady('after the rollback', blue)
    if (await reachable(green)) refuse('green still answers after the rollback')
    step(`rollback.sh: blue serves ${release} again, green stopped`)
    await edgeOn('after the rollback', bluePort)
  }

  // --- backup, destroy, restore, serve again: the scripts a deployment runs
  const marker = `smoke-${Date.now().toString(36)}`
  expectCode(
    'marker',
    psql(
      `create table release_smoke_marker (value text); insert into release_smoke_marker values ('${marker}')`,
    ),
    0,
  )
  // and an attachment, where the local storage backend keeps them
  const inStorage = (script: string) =>
    compose([
      'run',
      '--rm',
      '--no-deps',
      '-T',
      '--user',
      '0:0',
      '--entrypoint',
      'sh',
      'tools',
      '-c',
      script,
    ])
  expectCode(
    'attachment',
    inStorage(
      `mkdir -p /var/lib/qualy/storage/smoke && printf %s ${marker} > /var/lib/qualy/storage/smoke/marker.txt && chown -R 1000:1000 /var/lib/qualy/storage/smoke`,
    ),
    0,
  )
  const backups = path.join(work, 'backups')
  {
    fs.mkdirSync(path.join(work, 'offsite'))
    const ran = deployScript('backup.sh', [backups])
    if (ran.code !== 0) refuse(`backup.sh exited ${String(ran.code)}:\n${ran.out.slice(-2000)}`)
    const stamp = fs.readFileSync(path.join(backups, 'last-success'), 'utf8').trim()
    const dump = fs.statSync(path.join(backups, stamp, 'qualy.dump')).size
    const storage = fs.statSync(path.join(backups, stamp, 'storage.tar.gz')).size
    if (dump < 1024) refuse(`backup.sh wrote a ${String(dump)}-byte dump`)
    // the attachments kept anywhere but the volume, fetched by the release's
    // own export command - none here, so the manifest alone
    const listed = spawnSync('tar', [
      '-xzOf',
      path.join(backups, stamp, 'attachments.tar.gz'),
      './attachments.tsv',
    ])
    if (listed.status !== 0) refuse('the backup carries no attachments.tar.gz with its manifest')
    expectIn(
      'attachment manifest',
      listed.stdout.toString('utf8'),
      /^id\ttenant\tbackend\tkey\tversion/,
    )
    step(
      `backup: ${stamp}, dump ${String(dump)} bytes, attachments ${String(storage)} bytes, exported attachments listed`,
    )
    if (!fs.existsSync(path.join(work, 'offsite', stamp, 'SHA256SUMS')))
      refuse('backup.sh did not run the QUALY_BACKUP_OFFSITE the env file names')
    step('backup: copied off the machine by the command the env file names')
  }

  expectCode('blue stop', compose(['stop', 'server-blue']), 0)
  expectCode(
    'drop and recreate',
    compose([
      'exec',
      '-T',
      'postgres',
      'sh',
      '-c',
      'dropdb --force -U "$POSTGRES_USER" "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"',
    ]),
    0,
  )
  expectCode('attachments wiped', inStorage('find /var/lib/qualy/storage -mindepth 1 -delete'), 0)
  step('database dropped and recreated empty, attachments wiped')
  {
    const stamp = fs.readFileSync(path.join(backups, 'last-success'), 'utf8').trim()
    const ran = deployScript('restore.sh', [path.join(backups, stamp)])
    if (ran.code !== 0) refuse(`restore.sh exited ${String(ran.code)}:\n${ran.out.slice(-2000)}`)
    expectIn('restore.sh', ran.out, 'restored from')
    step('restore.sh: checked, restored into a scratch database, swapped in, migrated, started')
  }
  await waitReady('after restore')
  await edgeOn('after restore', bluePort)
  {
    const shell = await fetch(`${blue}/`)
    if (shell.status !== 200) refuse(`GET / after restore: status ${String(shell.status)}`)
    const found = psql('select value from release_smoke_marker')
    expectCode('marker after restore', found, 0)
    expectIn('marker after restore', found.out, marker)
    const attachment = compose([
      'exec',
      '-T',
      'server-blue',
      'cat',
      '/var/lib/qualy/storage/smoke/marker.txt',
    ])
    expectCode('attachment after restore', attachment, 0)
    expectIn('attachment after restore', attachment.out, marker)
    step('after restore: served, with the row and the attachment written before the backup')
  }
} catch (error) {
  failed = true
  console.error(
    `release-smoke: FAIL ${error instanceof SmokeFailed ? error.message : error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
  )
  const logs = compose([
    'logs',
    '--no-color',
    '--tail',
    '60',
    'server-blue',
    'server-green',
    'postgres',
  ])
  console.error(logs.out)
} finally {
  const down = compose([
    ...EVERY_PROFILE,
    'down',
    '--volumes',
    '--remove-orphans',
    '--timeout',
    '20',
  ])
  untag(next)
  if (withEdge) spawnSync('docker', ['rm', '-f', edgeName])
  if (down.code !== 0)
    console.error(`release-smoke: compose down exited ${String(down.code)}:\n${down.out}`)
  fs.rmSync(work, { recursive: true, force: true })
}

if (failed) process.exit(1)
console.log(`release-smoke: ${release} ok`)
