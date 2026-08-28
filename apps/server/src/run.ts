import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// The two ways this server runs, as explicit commands.
//
// `pnpm dev` and `pnpm start` differ in exactly one variable, and leaving
// that variable to whoever types the command is how a production start ends
// up in a development shape. The runner sets the mode, refuses a
// contradicting environment instead of silently obeying one half of it, and
// defaults production migrations to `off`: replicas racing to apply a
// lineage is not a default, it is `pnpm qualy deploy`'s job - set
// QUALY_MIGRATIONS=apply explicitly for a single-box convenience start.

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

if (mode === 'production') process.env.QUALY_MIGRATIONS ??= 'off'

await import(
  pathToFileURL(path.resolve(fileURLToPath(new URL('.', import.meta.url)), 'main.ts')).href
)
