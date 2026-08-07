import fs from 'node:fs'
import path from 'node:path'
import { runtimeLayers, runtimeLevels } from '@qualy/assembly'
import { ApiGroups } from '@qualy/api-kit/plugin'
import { Plugin } from '@qualy/plugin-kit'
import { writeGenerated } from './lib/codegen.ts'
import { repoRoot } from './lib/paths.ts'
import { currentResolution } from './lib/read-entries.ts'
import { resolvePluginModuleUrl } from './lib/packages.ts'

// The HttpApi definitions aggregate, and only that.
//
// It goes to @qualy/api, which the browser imports: pure schema, no handler,
// nothing that would drag a database driver into a bundle. It is the one api
// artifact that must be generated, because it is a TYPE - the client's method
// signatures and the openapi document are derived from it, and types do not
// exist at runtime.
//
// What is aggregated, and in which order, comes from the descriptors: the
// same Api.group features the runtime provider compiles, walked in the same
// dependency order the boot assembler walks. One order matters more than it
// looks - the openapi generator names anonymous schemas by traversal, so a
// static aggregate built in any other order describes the same contract under
// different component names, and the document equality gate reads that as
// drift. The ./api export is where the CLIENT reaches the schema; a package
// exporting one without contributing the group - or contributing without
// exporting - is refused here, because the two must be the same face.
//
// The active set, and this generator ignores --all on purpose. That flag means
// "the superset" for the web bundle, where carrying a disabled plugin's code
// costs a few unreachable bytes. Here the output IS the server's route graph:
// a disabled plugin whose dependencies are still present would have its
// endpoints genuinely served.

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

const resolution = await currentResolution()
for (const entry of runtimeLevels(runtimeLayers(resolution)).flat()) {
  const descriptor = resolution.descriptors.get(entry.id)!
  const contributions = Plugin.contributionsOf(descriptor, ApiGroups)

  const packageJson = JSON.parse(
    fs.readFileSync(
      new URL('package.json', resolvePluginModuleUrl(`${entry.id}/package.json`)),
      'utf8',
    ),
  ) as { exports?: Record<string, unknown> }
  const exportsApi = Boolean(packageJson.exports?.['./api'])

  if (contributions.length === 0) {
    if (exportsApi) {
      throw new Error(
        `${entry.id} declares exports["./api"] but its descriptor contributes no Api.group; the client would be built from schema the server never serves`,
      )
    }
    continue
  }
  if (!exportsApi) {
    throw new Error(
      `${entry.id} contributes api groups but declares no exports["./api"]; the client aggregate cannot reach its schema`,
    )
  }
  if (!apiDeps.has(entry.id)) {
    throw new Error(
      `${entry.id} contributes to the api but packages/api does not declare it; run pnpm plugin:add`,
    )
  }

  const apiSpecifier = `${entry.id}/api`
  const module = (await import(resolvePluginModuleUrl(apiSpecifier))) as Record<string, unknown>
  for (const contribution of contributions) {
    // the export carries the same VALUE the descriptor contributes - the
    // descriptor imports it from the module the subpath points at - so
    // identity is the match, and a rebound export cannot pass silently
    const exportName = Object.entries(module).find(
      ([name, value]) => name.endsWith('ApiGroup') && value === contribution.group,
    )?.[0]
    if (!exportName) {
      throw new Error(
        `${entry.id}: the descriptor contributes group ${String(contribution.group.identifier)} but ./api exports no <ns>ApiGroup with that value`,
      )
    }
    if (!/^[a-z][A-Za-z0-9]*ApiGroup$/.test(exportName)) {
      throw new Error(
        `${entry.id}: api export ${exportName} must be named <ns>ApiGroup in camelCase`,
      )
    }
    const ns = exportName.slice(0, -'ApiGroup'.length)
    // group identifiers are how the aggregate finds handlers at runtime, so a
    // collision would mean one plugin's routes silently replacing another's
    const previous = seen.get(ns)
    if (previous) {
      throw new Error(`duplicate api group ${ns}: ${previous} and ${entry.id}`)
    }
    seen.set(ns, entry.id)
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
