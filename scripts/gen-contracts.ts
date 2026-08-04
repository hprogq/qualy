import fs from 'node:fs'
import path from 'node:path'
import { writeGenerated } from './lib/codegen.ts'
import { readEntries } from './lib/read-entries.ts'
import { resolvePackageDir, resolvePluginModuleUrl } from './lib/packages.ts'

// contract aggregation follows the ACTIVE set: a disabled plugin loses its
// routes at runtime, so its contract disappears from the client and the web
// bundle tree-shakes it away; release builds pass --all for the superset.
// A plugin exposes a contract by declaring exports["./contract"]; the module
// must have exactly one `<ns>Contract` export, whose name defines the client
// namespace.

const all = process.argv.includes('--all')

const apiClientDeps = new Set(
  Object.keys(
    (
      JSON.parse(fs.readFileSync('packages/api-client/package.json', 'utf8')) as {
        dependencies?: Record<string, string>
      }
    ).dependencies ?? {},
  ),
)

const imports: string[] = []
const fields: string[] = []
const seen = new Map<string, string>()
for (const entry of await readEntries({ all })) {
  if (!entry.name.startsWith('@qualy/')) continue
  const packageDir = resolvePackageDir(entry.name)
  const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')) as {
    exports?: Record<string, unknown>
  }
  if (!pkg.exports?.['./contract']) continue
  if (!apiClientDeps.has(entry.name)) {
    throw new Error(
      `${entry.name} aggregates a contract but packages/api-client does not declare it; run pnpm plugin:add`,
    )
  }
  const module = (await import(resolvePluginModuleUrl(`${entry.name}/contract`))) as Record<
    string,
    unknown
  >
  // a plugin may expose several contracts, each becoming its own client
  // namespace: one surface for the session core, another for the
  // administration api it also owns
  const exportNames = Object.keys(module)
    .filter((name) => name.endsWith('Contract'))
    .sort()
  if (exportNames.length === 0) {
    throw new Error(`${entry.name}: contract module must export at least one <ns>Contract`)
  }
  for (const exportName of exportNames) {
    // the namespace is the export name, so the export name must be able to
    // be one: a namespace reaches client call sites as api.<ns>.method()
    if (!/^[a-z][A-Za-z0-9]*Contract$/.test(exportName)) {
      throw new Error(
        `${entry.name}: contract export ${exportName} must be named <ns>Contract in camelCase`,
      )
    }
    const ns = exportName.slice(0, -'Contract'.length)
    const previous = seen.get(ns)
    if (previous) {
      throw new Error(`duplicate contract namespace ${ns}: ${previous} and ${entry.name}`)
    }
    seen.set(ns, entry.name)
    // aliased on import: a plugin is free to export `appContract`, and the
    // aggregate this file declares is called that too
    imports.push(`import { ${exportName} as ${ns}Namespace } from '${entry.name}/contract'`)
    fields.push(`  ${ns}: ${ns}Namespace,`)
  }
}

const body = [
  ...imports,
  '',
  'export const appContract = {',
  ...fields,
  '} as const',
  '',
  'export type AppContract = typeof appContract',
].join('\n')

writeGenerated('packages/api-client/src/contracts.gen.ts', body)
