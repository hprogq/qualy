import path from 'node:path'
import { runtimePlanPathFor, writeRuntimePlan } from '@qualy/assembly'
import { currentResolution } from './lib/read-entries.ts'

// single generator entry: every generator runs in this process and reads the
// same argv, so `--all` reaches all of them. Chaining them in a package.json
// script would not work, pnpm appends passthrough args only to the tail
// command of the chain.

// The cordis loader takes a flat entry list; the manifest is a keyed product
// selection. This is the translation between them, generated for the same
// reason the other artifacts are: it is derived, so nobody should be editing
// it, and the loader gets deterministic entry ids instead of writing its own
// back into a file people maintain by hand.
const resolution = currentResolution()
const planPath = path.relative(process.cwd(), runtimePlanPathFor(resolution.manifest.source))
console.log(
  writeRuntimePlan(planPath, resolution) ? `${planPath} written` : `${planPath} unchanged, skipped`,
)

await import('./gen-contracts.ts')
await import('./gen-plugins.ts')

export {}
