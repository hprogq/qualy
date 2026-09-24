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
// server every six hours.

import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { PERSONA_ACCOUNTS, demoAccountsEnv } from './seed/personas.ts'

const CONTAINER = 'qualy-postgres-demo'
const DATABASE = 'qualy_demo_preview'
const BASELINE = 'data/demo-baseline'
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

console.log('\nsign in at http://localhost:5173 with one of:')
for (const account of PERSONA_ACCOUNTS) {
  console.log(`  ${account.label}: ${account.email} / ${account.password}`)
}
console.log('')

// the shell's variables win over .env in a development session, so these
// point the whole session at the preview copy and leave everything else as
// the developer's own .env has it
const child = spawn(process.execPath, ['apps/server/src/dev/host.ts'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    DATABASE_URL: `postgres://qualy:qualy@localhost:5434/${DATABASE}`,
    QUALY_STORAGE_DEFAULT_BACKEND: 'local',
    QUALY_STORAGE_LOCAL_ROOT: STORAGE,
    QUALY_DEMO_ACCOUNTS: demoAccountsEnv(),
  },
})
// the terminal's interrupt reaches the whole group; this only waits for it
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {})
child.on('exit', (code, signal) => process.exit(code ?? (signal === null ? 0 : 1)))
