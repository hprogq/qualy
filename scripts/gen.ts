import { capabilityModules, writeAtomic, writeRuntimeModule } from '@qualy/assembly'
import { currentResolution } from './lib/read-entries.ts'
import { RUNTIME_MODULE, generatedPath } from './lib/paths.ts'
import { collectReport, report } from './lib/report.ts'

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
export async function generateAll(): Promise<void> {
  const resolution = await currentResolution()
  if (writeRuntimeModule(generatedPath(RUNTIME_MODULE), resolution)) {
    report(`generated ${RUNTIME_MODULE}`)
  }

  // Whatever the capabilities derive, written by a caller that does not know
  // what any of it says. A capability with tables emits a module about tables
  // here; an assembly without one emits nothing and never mentions a database.
  for (const module of capabilityModules(resolution)) {
    if (writeAtomic(generatedPath(module.path), module.content)) {
      report(`generated ${module.path}`)
    }
  }

  // side-effecting modules, and imports are cached: this runs them once per
  // process, which is what both callers want
  await import('./gen-api.ts')
  await import('./gen-routes.ts')
  await import('./gen-permissions.ts')
  await import('./gen-plugins.ts')
}

/** the same run, with what it wrote returned instead of printed */
export const generateAllQuietly = (): Promise<string[]> => collectReport(generateAll)

// run directly by `pnpm gen` and by every script that prefixes it
if (import.meta.url === `file://${process.argv[1]}`) {
  await generateAll()
}
