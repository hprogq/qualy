import path from 'node:path'
import { writeRuntimeModule } from '@qualy/assembly'
import { currentResolution } from './lib/read-entries.ts'

// single generator entry: every generator runs in this process and reads the
// same argv, so `--all` reaches all of them. Chaining them in a package.json
// script would not work, pnpm appends passthrough args only to the tail
// command of the chain.

// the selection as a TypeScript module: derived like every other artifact
// here, so nobody should be editing it, and the layers a host composes are the
// ones the reviewed lock names.
const resolution = await currentResolution()
const modulePath = path.relative(
  process.cwd(),
  path.join(path.dirname(resolution.manifest.source), 'runtime.gen.ts'),
)
console.log(
  writeRuntimeModule(modulePath, resolution)
    ? `${modulePath} written`
    : `${modulePath} unchanged, skipped`,
)

await import('./gen-api.ts')
await import('./gen-routes.ts')
await import('./gen-permissions.ts')
await import('./gen-login-drivers.ts')
await import('./gen-ui.ts')
await import('./gen-plugins.ts')

export {}
