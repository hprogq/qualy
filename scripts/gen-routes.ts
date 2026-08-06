import fs from 'node:fs'
import path from 'node:path'
import { writeGenerated } from './lib/codegen.ts'
import { readEntries } from './lib/read-entries.ts'
import { resolvePackageDir } from './lib/packages.ts'

// Routes that are not api endpoints.
//
// The api aggregate covers everything that has a schema and belongs in the
// document. A browser shell does not: it is a raw handler on the router's
// wildcard. Those still cannot be imported by name in the host, because which
// plugins an assembly contains is decided by the manifest, so they are
// collected the same way the handlers are.
//
// The active set: a disabled plugin must not keep serving.

const imports: string[] = []
const layers: string[] = []

for (const entry of (await readEntries({ all: false })).filter((e) =>
  e.name.startsWith('@qualy/'),
)) {
  const packageDir = resolvePackageDir(entry.name)
  const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')) as {
    qualy?: { runtime?: { entry?: string; routes?: boolean } }
  }
  if (!pkg.qualy?.runtime?.routes) continue
  const runtimeEntry = pkg.qualy.runtime.entry
  if (!runtimeEntry) {
    throw new Error(`${entry.name}: qualy.runtime.routes needs qualy.runtime.entry to import from`)
  }
  const owner = entry.name
    .split('/')
    .pop()!
    .replace(/^plugin-/, '')
  const alias = `${owner.replace(/[^a-zA-Z0-9]+(.)/g, (_m, c: string) => c.toUpperCase())}Routes`
  imports.push(
    `import { routes as ${alias} } from '${runtimeEntry === '.' ? entry.name : `${entry.name}/${runtimeEntry.replace(/^\.\//, '')}`}'`,
  )
  layers.push(`  ${alias},`)
}

writeGenerated(
  'apps/server/routes.gen.ts',
  [
    "import { Layer } from 'effect'",
    ...imports,
    '',
    '/** every non-api route this assembly serves */',
    layers.length > 0
      ? `export const pluginRoutes = Layer.mergeAll(\n${layers.join('\n')}\n)`
      : 'export const pluginRoutes = Layer.empty',
  ].join('\n'),
)

export {}
