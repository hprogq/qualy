// Drops and recreates the demo database inside the demo container, then
// applies the committed migrations to it. It only ever names qualy_demo in
// qualy-postgres-demo; the development database lives in another cluster.

import { execFileSync } from 'node:child_process'

const CONTAINER = 'qualy-postgres-demo'
const DATABASE = 'qualy_demo'
const URL = `postgres://qualy:qualy@localhost:5434/${DATABASE}`

const run = (command: string, args: readonly string[], env?: NodeJS.ProcessEnv) =>
  execFileSync(command, args, { stdio: 'inherit', env: { ...process.env, ...env } })

run('docker', ['exec', CONTAINER, 'dropdb', '-U', 'qualy', '--if-exists', '--force', DATABASE])
run('docker', ['exec', CONTAINER, 'createdb', '-U', 'qualy', DATABASE])
run(process.execPath, ['apps/cli/src/main.ts', 'deploy'], { DATABASE_URL: URL })
