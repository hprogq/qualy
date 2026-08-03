import fs from 'node:fs'
import path from 'node:path'
import { validateComponentKeys } from './lib/component-keys.ts'
import { writeGenerated } from './lib/codegen.ts'
import { readEntries } from './lib/read-entries.ts'
import { resolvePackageDir, resolvePluginModuleUrl } from './lib/schema-entries.ts'

// frontend component registry follows the ACTIVE set: a disabled plugin's
// thunks never enter the module graph, so its chunks tree-shake away;
// release builds pass --all for the superset. A plugin exposes components by
// declaring exports["./client"], whose module must export a `components`
// thunk table (no top-level side effects).

const all = process.argv.includes('--all')

const webDeps = new Set(
  Object.keys(
    (
      JSON.parse(fs.readFileSync('apps/web/package.json', 'utf8')) as {
        dependencies?: Record<string, string>
      }
    ).dependencies ?? {},
  ),
)

const imports: string[] = []
const spreads: string[] = []
const catalogEntries: string[] = []
const errorSpreads: string[] = []
for (const entry of readEntries({ all })) {
  if (!entry.name.startsWith('@qualy/')) continue
  const packageDir = resolvePackageDir(entry.name)
  const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')) as {
    exports?: Record<string, unknown>
  }
  if (!pkg.exports?.['./client']) continue
  if (!webDeps.has(entry.name)) {
    throw new Error(
      `${entry.name} contributes components but apps/web does not declare it; run pnpm plugin:add`,
    )
  }
  // enforce the "<plugin>/<Component>" key namespace at generation time,
  // so merged registries can never silently shadow one another
  const module = (await import(resolvePluginModuleUrl(`${entry.name}/client`))) as {
    components?: Record<string, unknown>
    catalogs?: unknown
    errorMessages?: unknown
  }
  validateComponentKeys(entry.name, Object.keys(module.components ?? {}))
  const ns = entry.name.split('/').pop()!.replace('plugin-', '').replaceAll('-', '_')
  imports.push(`import { components as ${ns}Components } from '${entry.name}/client'`)
  spreads.push(`  ...${ns}Components,`)
  // localization assets are optional per plugin: a plugin without user
  // facing text ships neither, and the host aggregates whatever exists
  if (module.catalogs) {
    imports.push(`import { catalogs as ${ns}Catalogs } from '${entry.name}/client'`)
    catalogEntries.push(`  ${ns}Catalogs,`)
  }
  if (module.errorMessages) {
    imports.push(`import { errorMessages as ${ns}ErrorMessages } from '${entry.name}/client'`)
    errorSpreads.push(`  ...${ns}ErrorMessages,`)
  }
}

const body = [
  ...imports,
  '',
  'export const components = {',
  ...spreads,
  '}',
  '',
  'export const catalogs = [',
  ...catalogEntries,
  ']',
  '',
  'export const errorMessages = {',
  ...errorSpreads,
  '}',
].join('\n')

writeGenerated('apps/web/src/plugins.gen.ts', body)
