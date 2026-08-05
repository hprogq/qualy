import fs from 'node:fs'
import path from 'node:path'
import { writeGenerated } from './lib/codegen.ts'
import { readEntries } from './lib/read-entries.ts'
import { resolvePackageDir, resolvePluginModuleUrl } from './lib/packages.ts'

// The HttpApi aggregate, in two halves that must not be one file.
//
// The definitions go to @qualy/api, which the browser imports: pure schema,
// no handler, nothing that would drag a database driver into a bundle. The
// handlers go to the host, because that is the only place they can run.
//
// A plugin declares qualy.runtime.api pointing at the module holding its
// groups. Each `<ns>ApiGroup` export there is paired with a `<ns>ApiHandlers`
// export from the plugin's runtime entry, so a group that nothing implements
// is a missing import at build time rather than a 404 in production.
//
// The active set, and this generator ignores --all on purpose. That flag means
// "the superset" for the client contract and the web bundle, where carrying a
// disabled plugin's code costs a few unreachable bytes. Here the output IS the
// server's route graph: a disabled plugin whose dependencies are still present
// would have its endpoints genuinely served. Since --all reaches every
// generator through one argv, and `pnpm build` passes it, ignoring it has to
// be deliberate rather than inherited.

const apiDeps = new Set(
  Object.keys(
    (
      JSON.parse(fs.readFileSync('packages/api/package.json', 'utf8')) as {
        dependencies?: Record<string, string>
      }
    ).dependencies ?? {},
  ),
)

const groupImports: string[] = []
const groupNames: string[] = []
const handlerImports: string[] = []
const handlerNames: string[] = []
const seen = new Map<string, string>()

for (const entry of await readEntries({ all: false })) {
  if (!entry.name.startsWith('@qualy/')) continue
  const packageDir = resolvePackageDir(entry.name)
  const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')) as {
    qualy?: { runtime?: { entry?: string; api?: string } }
  }
  const api = pkg.qualy?.runtime?.api
  if (!api) continue
  const runtimeEntry = pkg.qualy?.runtime?.entry
  if (!runtimeEntry) {
    throw new Error(`${entry.name} declares qualy.runtime.api but no qualy.runtime.entry to implement it`)
  }
  if (!apiDeps.has(entry.name)) {
    throw new Error(
      `${entry.name} contributes to the api but packages/api does not declare it; run pnpm plugin:add`,
    )
  }
  const apiSpecifier = `${entry.name}/${api.replace(/^\.\//, '')}`
  const entrySpecifier = `${entry.name}/${runtimeEntry.replace(/^\.\//, '')}`
  const module = (await import(resolvePluginModuleUrl(apiSpecifier))) as Record<string, unknown>
  const exportNames = Object.keys(module)
    .filter((name) => name.endsWith('ApiGroup'))
    .sort()
  if (exportNames.length === 0) {
    throw new Error(`${entry.name}: api module must export at least one <ns>ApiGroup`)
  }
  for (const exportName of exportNames) {
    if (!/^[a-z][A-Za-z0-9]*ApiGroup$/.test(exportName)) {
      throw new Error(
        `${entry.name}: api export ${exportName} must be named <ns>ApiGroup in camelCase`,
      )
    }
    const ns = exportName.slice(0, -'ApiGroup'.length)
    // group identifiers are how the aggregate finds handlers at runtime, so a
    // collision would mean one plugin's routes silently replacing another's
    const previous = seen.get(ns)
    if (previous) {
      throw new Error(`duplicate api group ${ns}: ${previous} and ${entry.name}`)
    }
    seen.set(ns, entry.name)
    groupImports.push(`import { ${exportName} } from '${apiSpecifier}'`)
    groupNames.push(exportName)
    handlerImports.push(`import { ${ns}ApiHandlers } from '${entrySpecifier}'`)
    handlerNames.push(`${ns}ApiHandlers`)
  }
}

writeGenerated(
  'packages/api/src/api.gen.ts',
  [
    "import { HttpApi } from 'effect/unstable/httpapi'",
    "import { QUALY_API_ID, QUALY_API_PREFIX } from '@qualy/api-kit'",
    ...groupImports,
    '',
    '/** every endpoint this assembly serves, as a definition a client can be built from */',
    groupNames.length > 0
      ? `export const qualyApi = HttpApi.make(QUALY_API_ID)\n  .add(\n${groupNames
          .map((name) => `    ${name},`)
          .join('\n')}\n  )\n  .prefix(QUALY_API_PREFIX)`
      : 'export const qualyApi = HttpApi.make(QUALY_API_ID)',
  ].join('\n'),
)

writeGenerated(
  'apps/server/api-handlers.gen.ts',
  [
    "import { Layer } from 'effect'",
    ...handlerImports,
    '',
    '/** the implementations behind qualyApi, which only the host can run */',
    handlerNames.length > 0
      ? `export const apiHandlers = Layer.mergeAll(\n${handlerNames
          .map((name) => `  ${name},`)
          .join('\n')}\n)`
      : 'export const apiHandlers = Layer.empty',
  ].join('\n'),
)

export {}
