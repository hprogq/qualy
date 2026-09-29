import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'

// A whole deployment on this machine, for the end-to-end journeys to walk.
//
//   node tools/quality/e2e-stack.ts up [--release <name>] [--baseline <dir>]
//   node tools/quality/e2e-stack.ts down
//
// The release images (`pnpm release:build <name>`), deploy/compose.yaml, and
// the demonstration baseline brought in by deploy/demo/restore.sh - the same
// script that resets the public demonstration, which imports the dump,
// migrates it to this release, gives the five password accounts this
// deployment's passwords and starts blue. Nothing is mocked: a journey goes
// browser → HTTP → the server → PostgreSQL and the sandboxes.
//
// The baseline is `pnpm demo:seed` + `demo:snapshot` output (data/, not in
// git); the passwords are this stack's own and fixed, so a journey can sign
// in. `up` writes .qualy/e2e/stack.json with the address and the accounts;
// the journeys read it (vitest.e2e.config.ts).

const repoRoot = path.resolve(import.meta.dirname, '../..')
const work = path.join(repoRoot, '.qualy/e2e')
const envFile = path.join(work, '.env')
const stackFile = path.join(work, 'stack.json')
const project = 'qualy-e2e'
const composeFile = path.join(repoRoot, 'deploy/compose.yaml')
const EVERY_PROFILE = ['blue', 'green', 'tools', 'deploy'].flatMap((name) => ['--profile', name])
const edgeName = `${project}-edge`
// the smoke's edge, by the same digest: a production process refuses a public
// address that is not https, so this deployment has an edge in front of it
// as a real one does - Caddy with a certificate of its own for localhost
const EDGE_IMAGE =
  'caddy:2.11.4-alpine@sha256:6aeddd44c3078b0f9a35206472a11420648a79c184603ef95957d0a20044cb2b'

/** the accounts the baseline signs in with, and this stack's password for each */
export const E2E_ACCOUNTS = {
  admin: { email: 'admin@demo.example.edu', variable: 'QUALY_BASELINE_PASSWORD_ADMIN' },
  student: { email: 'student@demo.qualy.example', variable: 'QUALY_BASELINE_PASSWORD_STUDENT' },
  classLead: {
    email: 'class-lead@demo.qualy.example',
    variable: 'QUALY_BASELINE_PASSWORD_CLASS_LEAD',
  },
  counsellor: {
    email: 'counsellor@demo.qualy.example',
    variable: 'QUALY_BASELINE_PASSWORD_COUNSELLOR',
  },
  lead: { email: 'assessment-lead@demo.qualy.example', variable: 'QUALY_BASELINE_PASSWORD_LEAD' },
} as const

/**
 * Fixed and local, never a deployment's: long enough for the password policy
 * and sharing nothing with the account it belongs to, which the policy also
 * refuses (a role's name is in its address).
 */
const PASSWORDS: Record<string, string> = {
  admin: 'harbor-willow-5813-quiet-lamp',
  student: 'copper-meadow-2947-slow-river',
  classLead: 'granite-orchard-7361-warm-bell',
  counsellor: 'silver-canyon-4082-soft-rain',
  lead: 'amber-lantern-9156-still-pond',
}
const passwordFor = (role: string) => PASSWORDS[role] ?? refuse(`no password for ${role}`)

const refuse = (message: string): never => {
  console.error(`e2e-stack: ${message}`)
  process.exit(1)
}

const compose = (args: readonly string[], timeoutMs = 300_000) => {
  const ran = spawnSync(
    'docker',
    ['compose', '--project-name', project, '--file', composeFile, '--env-file', envFile, ...args],
    {
      cwd: repoRoot,
      env: { ...process.env, QUALY_ENV_FILE: envFile },
      encoding: 'utf8',
      timeout: timeoutMs,
    },
  )
  return { code: ran.status ?? 1, out: `${ran.stdout ?? ''}${ran.stderr ?? ''}`.trim() }
}

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo
      server.close(() => resolve(port))
    })
  })

const option = (args: readonly string[], name: string) => {
  const at = args.indexOf(`--${name}`)
  return at >= 0 ? args[at + 1] : undefined
}

const down = () => {
  spawnSync('docker', ['rm', '-f', edgeName])
  if (!fs.existsSync(envFile)) return
  compose([...EVERY_PROFILE, 'down', '--volumes', '--remove-orphans'], 180_000)
  fs.rmSync(stackFile, { force: true })
  console.log('e2e-stack: down')
}

const up = async (args: readonly string[]) => {
  const release = option(args, 'release') ?? 'e2e'
  const baseline = path.resolve(
    option(args, 'baseline') ?? path.join(repoRoot, 'data/demo-baseline'),
  )
  for (const file of ['qualy-demo.dump', 'storage.tar.gz']) {
    if (!fs.existsSync(path.join(baseline, file))) {
      refuse(`${baseline} has no ${file}; run pnpm demo:seed and demo:snapshot, or pass --baseline`)
    }
  }
  for (const image of ['qualy-server', 'qualy-sandbox-runtime', 'qualy-sandbox-authoring']) {
    if (spawnSync('docker', ['image', 'inspect', `${image}:${release}`]).status !== 0) {
      refuse(`no ${image}:${release}; build it with pnpm release:build ${release}`)
    }
  }
  down()
  fs.mkdirSync(work, { recursive: true })
  const bluePort = await freePort()
  const greenPort = await freePort()
  const seedPort = await freePort()
  const edgePort = await freePort()
  const base = `https://localhost:${String(edgePort)}`
  fs.writeFileSync(
    envFile,
    [
      `QUALY_RELEASE=${release}`,
      'POSTGRES_USER=qualy',
      'POSTGRES_PASSWORD=e2e',
      'POSTGRES_DB=qualy',
      'DATABASE_URL=postgres://qualy:e2e@postgres:5432/qualy',
      `QUALY_SECRETS_MASTER_KEY=${randomBytes(32).toString('base64')}`,
      'QUALY_MAIL_FROM=Qualy <no-reply@qualy.invalid>',
      'QUALY_MAIL_SMTP_HOST=127.0.0.1',
      'QUALY_MAIL_SMTP_PORT=1025',
      'QUALY_MAIL_SMTP_TLS=none',
      'QUALY_MAIL_SMTP_ALLOW_PLAINTEXT=1',
      'QUALY_MAIL_RESEND_API_KEY=re_e2e_only',
      `QUALY_PUBLIC_URL=${base}`,
      // the edge stands on this network, and its forwarded headers are believed
      'QUALY_TRUSTED_PROXIES=172.30.55.0/24',
      `QUALY_PORT_BLUE=${String(bluePort)}`,
      `QUALY_PORT_GREEN=${String(greenPort)}`,
      `QUALY_SEED_PORT=${String(seedPort)}`,
      'QUALY_PROXY=none',
      'QUALY_DRAIN_SECONDS=2',
      // an address plan of its own, clear of the smoke's and a deployment's
      'QUALY_NETWORK_SUBNET=172.30.55.0/24',
      'QUALY_NETWORK_GATEWAY=172.30.55.1',
      'QUALY_LOG_FORMAT=json',
      'QUALY_LOG_LEVEL=info',
      ...Object.entries(E2E_ACCOUNTS).map(
        ([role, account]) => `${account.variable}=${passwordFor(role)}`,
      ),
      '',
    ].join('\n'),
  )
  const started = compose(['up', '-d', '--wait', 'postgres'])
  if (started.code !== 0) refuse(`postgres did not start:\n${started.out.slice(-2000)}`)
  fs.writeFileSync(
    path.join(work, 'Caddyfile'),
    `{\n  auto_https disable_redirects\n}\nhttps://localhost {\n  tls internal\n  reverse_proxy server-blue:3000\n}\n`,
  )
  const edge = spawnSync(
    'docker',
    [
      'run',
      '-d',
      '--name',
      edgeName,
      '--network',
      `${project}_default`,
      '-p',
      `127.0.0.1:${String(edgePort)}:443`,
      '-v',
      `${path.join(work, 'Caddyfile')}:/etc/caddy/Caddyfile:ro`,
      EDGE_IMAGE,
    ],
    { encoding: 'utf8' },
  )
  if (edge.status !== 0) refuse(`the edge did not start: ${edge.stderr}`)
  const restored = spawnSync(path.join(repoRoot, 'deploy/demo/restore.sh'), [baseline], {
    cwd: work,
    env: { ...process.env, COMPOSE_PROJECT_NAME: project, QUALY_ENV_FILE: envFile },
    encoding: 'utf8',
    timeout: 900_000,
  })
  if (restored.status !== 0) {
    refuse(
      `restore.sh exited ${String(restored.status)}:\n${`${restored.stdout}${restored.stderr}`.slice(-3000)}`,
    )
  }
  const direct = `http://127.0.0.1:${String(bluePort)}`
  const ready = await fetch(`${direct}/health/ready`).catch(() => undefined)
  if (ready?.status !== 200) refuse(`${direct}/health/ready answered ${String(ready?.status)}`)
  fs.writeFileSync(
    stackFile,
    `${JSON.stringify(
      {
        base,
        release,
        accounts: Object.fromEntries(
          Object.entries(E2E_ACCOUNTS).map(([role, account]) => [
            role,
            { email: account.email, password: passwordFor(role) },
          ]),
        ),
      },
      null,
      2,
    )}\n`,
  )
  console.log(`e2e-stack: ${release} serving the demonstration baseline at ${base}`)
}

const [command, ...rest] = process.argv.slice(2)
if (command === 'up') await up(rest)
else if (command === 'down') down()
else refuse('usage: e2e-stack.ts up [--release <name>] [--baseline <dir>] | down')
