import fs from 'node:fs'
import path from 'node:path'
import { writeGenerated } from './lib/codegen.ts'
import { repoRoot } from './lib/paths.ts'
import { readEntries } from './lib/read-entries.ts'
import { resolvePackageDir, resolvePluginModuleUrl } from './lib/packages.ts'

// The HttpApi definitions aggregate, and only that.
//
// It goes to @qualy/api, which the browser imports: pure schema, no handler,
// nothing that would drag a database driver into a bundle. It is the one api
// artifact that must be generated, because it is a TYPE - the client's method
// signatures and the openapi document are derived from it, and types do not
// exist at runtime.
//
// The handlers are not aggregated anywhere. Each plugin's entry layer carries
// its own group implementation, so the pairing check this generator used to
// do by export-name convention is the compiler's now: `HttpApiBuilder.layer`
// requires every group's handler service, and a group nobody implements is a
// missing service in the host composition rather than a 404 in production.
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
      JSON.parse(fs.readFileSync(path.join(repoRoot, 'packages/api/package.json'), 'utf8')) as {
        dependencies?: Record<string, string>
      }
    ).dependencies ?? {},
  ),
)

const groupImports: string[] = []
const groupNames: string[] = []
const seen = new Map<string, string>()

for (const entry of await readEntries({ all: false })) {
  if (!entry.name.startsWith('@qualy/')) continue
  const packageDir = resolvePackageDir(entry.name)
  const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')) as {
    exports?: Record<string, unknown>
  }
  // the ./api subpath is the declaration: pure schema the browser aggregate
  // imports, present exactly when the plugin serves an api group
  if (!pkg.exports?.['./api']) continue
  const api = './api'
  if (!apiDeps.has(entry.name)) {
    throw new Error(
      `${entry.name} contributes to the api but packages/api does not declare it; run pnpm plugin:add`,
    )
  }
  const apiSpecifier = `${entry.name}/${api.replace(/^\.\//, '')}`
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

export {}
