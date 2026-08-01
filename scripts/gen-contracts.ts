import fs from 'node:fs'
import path from 'node:path'
import { writeGenerated } from './lib/codegen.ts'
import { readEntries } from './lib/read-entries.ts'
import { resolvePackageDir } from './lib/schema-entries.ts'

// contract aggregation follows the ACTIVE set: a disabled plugin loses its
// routes at runtime, so its contract disappears from the client and the web
// bundle tree-shakes it away; release builds pass --all for the superset.
// A plugin exposes a contract by declaring exports["./contract"]; the module
// must have exactly one `<ns>Contract` export, whose name defines the client
// namespace.

const all = process.argv.includes('--all')

const imports: string[] = []
const fields: string[] = []
const seen = new Set<string>()
for (const entry of readEntries({ all })) {
  if (!entry.name.startsWith('@qualy/')) continue
  const packageDir = resolvePackageDir(entry.name)
  const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')) as {
    exports?: Record<string, unknown>
  }
  if (!pkg.exports?.['./contract']) continue
  const module = (await import(`${entry.name}/contract`)) as Record<string, unknown>
  const exportNames = Object.keys(module).filter((name) => name.endsWith('Contract'))
  if (exportNames.length !== 1) {
    throw new Error(`${entry.name}: contract module must have exactly one <ns>Contract export`)
  }
  const exportName = exportNames[0]!
  const ns = exportName.slice(0, -'Contract'.length)
  if (seen.has(ns)) throw new Error(`duplicate contract namespace: ${ns}`)
  seen.add(ns)
  imports.push(`import { ${exportName} } from '${entry.name}/contract'`)
  fields.push(`  ${ns}: ${exportName},`)
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
