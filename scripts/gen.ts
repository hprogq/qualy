import path from 'node:path'
import { capabilityModules, writeAtomic, writeRuntimeModule } from '@qualy/assembly'
import { currentResolution } from './lib/read-entries.ts'
import { RUNTIME_MODULE, generatedPath } from './lib/paths.ts'

// single generator entry: every generator runs in this process and reads the
// same argv, so `--all` reaches all of them. Chaining them in a package.json
// script would not work, pnpm appends passthrough args only to the tail
// command of the chain.

// The selection as a TypeScript module: derived like every other artifact
// here, so nobody should be editing it, and the layers a host composes are the
// ones the reviewed lock names.
//
// Written where the host imports it from, not beside whatever manifest --yml
// named. Every generated artifact is reached by a static import, so none of
// them can move; deriving this one path from the manifest meant `--yml` sent
// the layers somewhere else while the permissions, routes, handlers and web
// bundle were still rewritten here, and the assembly that shipped was half of
// each.
const resolution = await currentResolution()
const modulePath = generatedPath(RUNTIME_MODULE)
console.log(
  writeRuntimeModule(modulePath, resolution)
    ? `${RUNTIME_MODULE} written`
    : `${RUNTIME_MODULE} unchanged, skipped`,
)

// Whatever the capabilities derive, written by a caller that does not know
// what any of it says. A capability with tables emits a module about tables
// here; an assembly without one emits nothing and never mentions a database.
for (const module of capabilityModules(resolution)) {
  console.log(
    writeAtomic(generatedPath(module.path), module.content)
      ? `${module.path} written`
      : `${module.path} unchanged, skipped`,
  )
}

await import('./gen-api.ts')
await import('./gen-routes.ts')
await import('./gen-permissions.ts')
await import('./gen-login-drivers.ts')
await import('./gen-ui.ts')
await import('./gen-plugins.ts')

export {}
