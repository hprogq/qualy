// Drops and recreates the demo database inside the demo container, then
// applies the committed migrations to it. It only ever names qualy_demo in
// qualy-postgres-demo; the development database lives in another cluster.
// The attachments that database cites go with it: files an earlier run left
// would otherwise ride along into the next baseline's archive.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { DEMO_STORAGE_ROOT } from './runtime.ts'

const CONTAINER = 'qualy-postgres-demo'
const DATABASE = 'qualy_demo'
const URL = `postgres://qualy:qualy@localhost:5434/${DATABASE}`

const run = (command: string, args: readonly string[], env?: NodeJS.ProcessEnv) =>
  execFileSync(command, args, { stdio: 'inherit', env: { ...process.env, ...env } })

run('docker', ['exec', CONTAINER, 'dropdb', '-U', 'qualy', '--if-exists', '--force', DATABASE])
run('docker', ['exec', CONTAINER, 'createdb', '-U', 'qualy', DATABASE])
fs.rmSync(DEMO_STORAGE_ROOT, { recursive: true, force: true })
run(process.execPath, ['apps/cli/src/main.ts', 'deploy'], { DATABASE_URL: URL })
