// A local look at the demonstration, the way the server shows it.
//
//   pnpm demo:preview          restores the baseline, then starts `pnpm dev` on it
//   pnpm demo:preview --keep   starts on whatever the last preview left
//
// The baseline in data/demo-baseline (made by `pnpm demo:snapshot`) is
// restored into its own database, qualy_demo_preview in the demo container,
// and its attachments into data/demo-preview/storage. Never into qualy_demo:
// the next snapshot is taken from there, and signing in writes sessions and
// sign-ins that do not belong in it. Never into the development database
// either. What a preview writes is gone at the next restore, as it is on the
// server when the baseline is restored there.

import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { assertPresenterAccounts, demoAccountsFrom } from './accounts.ts'

const accounts = demoAccountsFrom(process.env)
const CONTAINER = 'qualy-postgres-demo'
const DATABASE = 'qualy_demo_preview'
const BASELINE = process.env.QUALY_DEMO_SNAPSHOT_ROOT ?? 'data/demo-baseline'
const STORAGE = path.resolve('data/demo-preview/storage')

const keep = process.argv.includes('--keep')

const running = (() => {
  try {
    return (
      execFileSync('docker', ['inspect', '-f', '{{.State.Running}}', CONTAINER], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() === 'true'
    )
  } catch {
    return false
  }
})()
if (!running) {
  console.error(
    `${CONTAINER} is not running. Start it with: docker compose --profile demo up -d postgres-demo`,
  )
  process.exit(1)
}

if (!keep) {
  const dump = path.join(BASELINE, 'qualy-demo.dump')
  const files = path.join(BASELINE, 'storage.tar.gz')
  for (const file of [dump, files]) {
    if (!fs.existsSync(file)) {
      console.error(`${file} is missing. Make the baseline first: pnpm demo:snapshot`)
      process.exit(1)
    }
  }
  console.log(`restoring ${dump} into ${DATABASE}`)
  const inContainer = (...args: string[]) =>
    execFileSync('docker', ['exec', '-i', CONTAINER, ...args], { stdio: 'inherit' })
  inContainer('dropdb', '-U', 'qualy', '--if-exists', '--force', DATABASE)
  inContainer('createdb', '-U', 'qualy', DATABASE)
  execFileSync(
    'docker',
    [
      'exec',
      '-i',
      CONTAINER,
      'pg_restore',
      '-U',
      'qualy',
      '-d',
      DATABASE,
      '--no-owner',
      '--no-acl',
    ],
    { input: fs.readFileSync(dump), stdio: ['pipe', 'inherit', 'inherit'] },
  )
  console.log(`restoring ${files} into ${STORAGE}`)
  fs.rmSync(STORAGE, { recursive: true, force: true })
  fs.mkdirSync(STORAGE, { recursive: true })
  execFileSync('tar', ['-xzf', files, '-C', STORAGE])
}

// An old baseline can still contain the previous addresses. Fail before
// starting the application rather than advertise accounts it cannot find.
const expectedEmails = Object.values(accounts.presenters).map(({ email }) => email)
const tenantSlug = process.env.QUALY_DEFAULT_TENANT || 'default'
const foundEmails = execFileSync(
  'docker',
  [
    'exec',
    '-i',
    CONTAINER,
    'psql',
    '-U',
    'qualy',
    '-d',
    DATABASE,
    '-XAt',
    '-v',
    'ON_ERROR_STOP=1',
    '-v',
    `tenant_slug=${tenantSlug}`,
    ...expectedEmails.flatMap((email, index) => ['-v', `email${index}=${email}`]),
  ],
  {
    input: `select u.email from users u join tenants t on t.id = u.tenant_id where t.slug = :'tenant_slug' and u.deleted_at is null and u.email = any(array[${expectedEmails.map((_, index) => `:'email${index}'`).join(', ')}]);\n`,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'inherit'],
  },
).trim()
assertPresenterAccounts(accounts, foundEmails === '' ? [] : foundEmails.split('\n'))

// Sign in privately with the credentials used to generate the baseline.
console.log('\nsign in at http://localhost:5173 with one of:')
for (const account of accounts.personas) {
  console.log(`  ${account.label}: ${account.email}`)
}
console.log('  (use the credentials stored in your private environment file)')
console.log('')

// This entry has already loaded .env. Every child inherits that same reading,
// with the database and storage pointing at the isolated preview copy.
const child = spawn(process.execPath, ['apps/server/src/dev/host.ts', '--inherit-env'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    DATABASE_URL: `postgres://qualy:qualy@localhost:5434/${DATABASE}`,
    QUALY_STORAGE_DEFAULT_BACKEND: 'local',
    QUALY_STORAGE_LOCAL_ROOT: STORAGE,
    QUALY_DEMO_ACCOUNTS: '',
  },
})
// the terminal's interrupt reaches the whole group; this only waits for it
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {})
child.on('exit', (code, signal) => process.exit(code ?? (signal === null ? 0 : 1)))
