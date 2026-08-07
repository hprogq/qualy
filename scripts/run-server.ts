import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { repoRoot } from './lib/paths.ts'

// The two ways this server runs, as explicit commands.
//
// `pnpm dev` and `pnpm start` differ in exactly one variable, but leaving
// that variable to whoever types the command meant production was one
// forgotten export away from booting a Vite dev server. The runner sets the
// mode, refuses a contradicting environment instead of silently obeying one
// half of it, and defaults production migrations to `off`: replicas racing
// to apply a lineage is not a default, it is `pnpm qualy deploy`'s job -
// set QUALY_MIGRATIONS=apply explicitly for a single-box convenience start.

const mode = process.argv[2]
if (mode !== 'development' && mode !== 'production') {
  console.error('usage: run-server.ts <development|production>')
  process.exit(1)
}
if (process.env.NODE_ENV && process.env.NODE_ENV !== mode) {
  console.error(`NODE_ENV=${process.env.NODE_ENV} contradicts the ${mode} command; unset it`)
  process.exit(1)
}
process.env.NODE_ENV = mode

if (mode === 'production') {
  if (process.env.QUALY_WEB_MODE === 'development') {
    console.error('a production start cannot serve the Vite development mode; unset QUALY_WEB_MODE')
    process.exit(1)
  }
  process.env.QUALY_MIGRATIONS ??= 'off'
}

await import(pathToFileURL(path.join(repoRoot, 'apps/server/src/main.ts')).href)
