import path from 'node:path'
import { runtimePlanPathFor, writeRuntimeModule, writeRuntimePlan } from '@qualy/assembly'
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
const resolution = await currentResolution()
const planPath = path.relative(process.cwd(), runtimePlanPathFor(resolution.manifest.source))
console.log(
  writeRuntimePlan(planPath, resolution) ? `${planPath} written` : `${planPath} unchanged, skipped`,
)

// the same selection as a TypeScript module, for the Effect runtime. Both
// exist while the runtime is being replaced; the cordis entry list goes when
// cordis does.
const modulePath = path.join(path.dirname(planPath), 'runtime.gen.ts')
console.log(
  writeRuntimeModule(modulePath, resolution)
    ? `${modulePath} written`
    : `${modulePath} unchanged, skipped`,
)

await import('./gen-contracts.ts')
await import('./gen-api.ts')
await import('./gen-permissions.ts')
await import('./gen-login-drivers.ts')
await import('./gen-ui.ts')
await import('./gen-plugins.ts')

export {}
