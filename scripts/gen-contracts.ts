import fs from 'node:fs'
import path from 'node:path'
import { writeGenerated } from './lib/codegen.ts'
import { readEntries } from './lib/read-entries.ts'
import { resolvePackageDir } from './lib/schema-entries.ts'

// contract aggregation follows the ACTIVE set: a disabled plugin loses its
// routes at runtime, so its contract disappears from the client and the web
// bundle tree-shakes it away; release builds pass --all for the superset.
// A plugin exposes a contract by declaring exports["./contract"], whose
// module must export `<ns>Contract` (ns = package name without the prefix).

const all = process.argv.includes('--all')

const imports: string[] = []
const fields: string[] = []
for (const entry of readEntries({ all })) {
  if (!entry.name.startsWith('@qualy/')) continue
  const packageDir = resolvePackageDir(entry.name)
  const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')) as {
    exports?: Record<string, unknown>
  }
  if (!pkg.exports?.['./contract']) continue
  const ns = entry.name.split('/').pop()!.replace('plugin-', '')
  imports.push(`import { ${ns}Contract } from '${entry.name}/contract'`)
  fields.push(`  ${ns}: ${ns}Contract,`)
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
