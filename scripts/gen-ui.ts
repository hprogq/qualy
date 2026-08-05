import fs from 'node:fs'
import path from 'node:path'
import { writeGenerated } from './lib/codegen.ts'
import { readEntries } from './lib/read-entries.ts'
import { resolvePackageDir, resolvePluginModuleUrl } from './lib/packages.ts'

// The shell's surfaces, pulled instead of pushed.
//
// A page, a layout and a slot item are descriptors: nothing here runs or reads
// a database, so the assembly can collect them without constructing anything.
// The registry stops being downstream of every plugin that puts a screen in
// it, which is the same inversion the permission catalog went through.
//
// The active set: a disabled plugin's screens must stop being served.

const imports: string[] = []
const surfaces: string[] = []
const pageIds = new Map<string, string>()
const pagePaths = new Map<string, string>()
const layouts = new Map<string, string>()

for (const entry of (await readEntries({ all: false })).filter((e) =>
  e.name.startsWith('@qualy/'),
)) {
  const packageDir = resolvePackageDir(entry.name)
  const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')) as {
    exports?: Record<string, unknown>
  }
  if (typeof pkg.exports?.['./ui'] !== 'string') continue
  const module = (await import(resolvePluginModuleUrl(`${entry.name}/ui`))) as {
    surfaces?: {
      pages?: { page: { id: string; path: string }; layout: string }[]
      layouts?: { contract: string; provider: string }[]
    }
  }
  if (!module.surfaces) continue
  const owner = entry.name.split('/').pop()!.replace(/^plugin-/, '')

  // An id or a path claimed twice has no owner, and the router would mount
  // whichever won. The registry throws on this at boot; catching it here moves
  // the failure to whoever assembles the release.
  for (const page of module.surfaces.pages ?? []) {
    const byId = pageIds.get(page.page.id)
    if (byId) throw new Error(`duplicate page id ${page.page.id}: ${byId} and ${owner}`)
    pageIds.set(page.page.id, owner)
    const byPath = pagePaths.get(page.page.path)
    if (byPath) throw new Error(`duplicate page path ${page.page.path}: ${byPath} and ${owner}`)
    pagePaths.set(page.page.path, owner)
  }
  // One implementation per layout contract: two providers for one contract is
  // an assembly that cannot say which shell frames a page.
  for (const layout of module.surfaces.layouts ?? []) {
    const previous = layouts.get(layout.contract)
    if (previous) {
      throw new Error(`layout contract ${layout.contract} claimed twice: ${previous} and ${owner}`)
    }
    layouts.set(layout.contract, owner)
  }

  const alias = `${owner.replace(/[^a-zA-Z0-9]+(.)/g, (_m, c: string) => c.toUpperCase())}Surfaces`
  imports.push(`import { surfaces as ${alias} } from '${entry.name}/ui'`)
  surfaces.push(`  ${alias},`)
}

writeGenerated(
  'apps/server/ui.gen.ts',
  [
    "import type { UiSurfaces } from '@qualy/ui-contract'",
    ...imports,
    '',
    '/** every surface this assembly serves, in manifest order */',
    surfaces.length > 0
      ? `export const uiSurfaces: readonly UiSurfaces[] = [\n${surfaces.join('\n')}\n]`
      : 'export const uiSurfaces: readonly UiSurfaces[] = []',
  ].join('\n'),
)

export {}
