import fs from 'node:fs'
import path from 'node:path'
import { writeGenerated } from './lib/codegen.ts'
import { readEntries } from './lib/read-entries.ts'
import { resolvePackageDir } from './lib/schema-entries.ts'

// frontend component registry follows the ACTIVE set: a disabled plugin's
// thunks never enter the module graph, so its chunks tree-shake away;
// release builds pass --all for the superset. A plugin exposes components by
// declaring exports["./client"], whose module must export a `components`
// thunk table (no top-level side effects).

const all = process.argv.includes('--all')

const imports: string[] = []
const spreads: string[] = []
for (const entry of readEntries({ all })) {
  if (!entry.name.startsWith('@qualy/')) continue
  const packageDir = resolvePackageDir(entry.name)
  const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')) as {
    exports?: Record<string, unknown>
  }
  if (!pkg.exports?.['./client']) continue
  const ns = entry.name.split('/').pop()!.replace('plugin-', '').replaceAll('-', '_')
  imports.push(`import { components as ${ns}Components } from '${entry.name}/client'`)
  spreads.push(`  ...${ns}Components,`)
}

const body = [...imports, '', 'export const components = {', ...spreads, '}'].join('\n')

writeGenerated('apps/web/src/plugins.gen.ts', body)
