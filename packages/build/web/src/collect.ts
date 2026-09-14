import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { commonErrorCodes } from '@qualy/i18n-contract'
import { isPluginDescriptor, Plugin, type PluginDescriptor } from '@qualy/plugin-kit'
import {
  BrowserModules,
  I18nCatalogs,
  UiSurfaceDeclarations,
} from '@qualy/plugin-ui-registry/plugin'
import { LoginDriverDeclarations } from '@qualy/auth-contract/plugin'
import { surfaceLabel, type BrowserSurface, type ClientComponentRef } from '@qualy/ui-contract'
import { currentResolution, readEntries, resolvePackageDir } from '@qualy/assembly/host'
import { manifestPath, repoRoot } from './manifest.ts'

// The browser's plugin aggregate, as a module SOURCE rather than a file.
//
// What the descriptors declare is a binding: this page id, this layout
// contract, this item under this slot, this login driver type - and the
// module that renders it. The browser is given the left-hand side and the
// build keeps the right, so the aggregate is four tables of loaders keyed by
// surface, and a manifest that names a page can be resolved without anyone
// being told which package holds it.
//
// Every surface is claimed exactly once, here. The server registry refuses
// two claims too, but a build that let the second import overwrite the first
// would have shipped the wrong renderer before any server started - and the
// browser tests never start one.
//
// Where a plugin's modules come from is the ASSEMBLY's answer, not a
// dependency of the composition root. The collector resolves each package
// through the host resolver, from the workspace the manifest names, and
// writes relative imports into the aggregate - so apps/web never had to
// name a plugin for one to be built, and the check that made it name them
// only ever enforced a second list of the same facts.
//
// The registry follows the ACTIVE set, and the aggregate has no other mode:
// a disabled plugin's modules never enter the graph, in development or in a
// release, so nothing of it reaches a browser. `all` stays on the collector
// itself because tooling genuinely asks the other question - which module
// WOULD have implemented a surface nobody built - and answering it by
// guessing is what the chunk sentinel stopped doing.
//
// Localisation assets still come from the declared i18n module, and every
// other identity - catalog namespace, message id, error code - is claimed
// here for the same reason.

/** one public surface and the module this build resolved behind it */
export interface SurfaceBinding {
  readonly surface: BrowserSurface
  /** the module as its plugin declared it, relative to the plugin's src/ */
  readonly module: string
  readonly export: string
  /** the module on disk, absolute */
  readonly file: string
}

export interface WebPluginEntry {
  name: string
  /** what this plugin puts on screen, by the address the browser uses */
  surfaces: SurfaceBinding[]
  /** the declared localisation module, absolute, when the plugin ships one */
  i18nModule?: string
  hasCatalogs: boolean
  hasErrorMessages: boolean
  /** modules the browser imports at boot for their side effects, absolute */
  browserModules: string[]
}

/** every surface one descriptor declares, with the reference that implements it */
const declaredSurfaces = (
  descriptor: PluginDescriptor,
): { surface: BrowserSurface; ref: ClientComponentRef }[] => {
  const found: { surface: BrowserSurface; ref: ClientComponentRef }[] = []
  for (const surfaces of Plugin.contributionsOf(descriptor, UiSurfaceDeclarations)) {
    for (const page of surfaces.pages ?? []) {
      found.push({ surface: { kind: 'page', id: page.page.id }, ref: page.component })
    }
    for (const layout of surfaces.layouts ?? []) {
      found.push({ surface: { kind: 'layout', id: layout.contract }, ref: layout.component })
    }
    for (const slot of surfaces.slots ?? []) {
      found.push({
        surface: { kind: 'slot', slot: slot.key, id: slot.id },
        ref: slot.component,
      })
    }
  }
  for (const driver of Plugin.contributionsOf(descriptor, LoginDriverDeclarations)) {
    if (driver.presentation.mode === 'component') {
      found.push({
        surface: { kind: 'login', id: driver.type },
        ref: driver.presentation.component,
      })
    }
  }
  return found
}

export async function collectWebPlugins(
  options: { all?: boolean; ymlPath?: string } = {},
): Promise<WebPluginEntry[]> {
  const manifest = manifestPath(options.ymlPath)
  const resolution = await currentResolution(manifest)
  const found: WebPluginEntry[] = []
  const claimedSurfaces = new Map<string, string>()
  const claimedNamespaces = new Map<string, string>()
  const claimedMessageIds = new Map<string, string>()
  const claimedErrorCodes = new Map<string, string>()
  const COMMON_ERROR_CODES = new Set<string>(commonErrorCodes)
  const claim = (registry: Map<string, string>, key: string, owner: string, what: string) => {
    const existing = registry.get(key)
    if (existing) throw new Error(`${what} conflict: ${key} claimed by ${existing} and ${owner}`)
    registry.set(key, owner)
  }

  for (const entry of await readEntries({ manifestPath: manifest, all: options.all ?? false })) {
    if (!entry.name.startsWith('@qualy/')) continue
    const descriptor = resolution.descriptors.get(entry.name)
    if (!isPluginDescriptor(descriptor)) continue
    const packageDir = resolvePackageDir(entry.name, manifest)

    const surfaces: SurfaceBinding[] = []
    for (const { surface, ref } of declaredSurfaces(descriptor)) {
      // relative to src/, where the descriptor that declared it lives
      const file = path.resolve(packageDir, 'src', ref.module)
      if (!file.startsWith(packageDir + path.sep) || !fs.existsSync(file)) {
        throw new Error(`${entry.name}: component module ${ref.module} does not exist`)
      }
      claim(claimedSurfaces, surfaceLabel(surface), entry.name, 'surface')
      surfaces.push({ surface, module: ref.module, export: ref.export, file })
    }

    // localization assets are optional per plugin: a plugin without user
    // facing text declares no module, and the host aggregates whatever exists
    const declaredI18n = Plugin.contributionsOf(descriptor, I18nCatalogs)
    if (declaredI18n.length > 1) {
      throw new Error(`${entry.name} declares Ui.i18n twice; one module carries everything`)
    }
    let hasCatalogs = false
    let hasErrorMessages = false
    let i18nModule: string | undefined
    if (declaredI18n.length === 1) {
      i18nModule = path.resolve(packageDir, 'src', declaredI18n[0]!.module)
      if (!i18nModule.startsWith(packageDir + path.sep) || !fs.existsSync(i18nModule)) {
        throw new Error(`${entry.name}: i18n module ${declaredI18n[0]!.module} does not exist`)
      }
      const module = (await import(pathToFileURL(i18nModule).href)) as {
        catalogs?: unknown
        errorMessages?: unknown
      }
      if (module.catalogs) {
        const catalogs = module.catalogs as {
          namespace: string
          messages: readonly { id: string }[]
        }
        claim(claimedNamespaces, catalogs.namespace, entry.name, 'catalog namespace')
        for (const declared of catalogs.messages) {
          if (!declared.id.startsWith(`${catalogs.namespace}/`)) {
            throw new Error(
              `${entry.name}: message ${declared.id} is outside its namespace ${catalogs.namespace}/`,
            )
          }
          claim(claimedMessageIds, declared.id, entry.name, 'message id')
        }
        hasCatalogs = true
      }
      if (module.errorMessages) {
        for (const code of Object.keys(module.errorMessages as Record<string, unknown>)) {
          if (COMMON_ERROR_CODES.has(code)) {
            throw new Error(
              `${entry.name}: ${code} is a common error code and cannot be overridden`,
            )
          }
          claim(claimedErrorCodes, code, entry.name, 'error code')
        }
        hasErrorMessages = true
      }
      if (!module.catalogs && !module.errorMessages) {
        throw new Error(`${entry.name}: the declared i18n module exports no catalogs`)
      }
    }

    const browserModules: string[] = []
    for (const declared of Plugin.contributionsOf(descriptor, BrowserModules)) {
      const resolved = path.resolve(packageDir, 'src', declared.module)
      if (!resolved.startsWith(packageDir + path.sep) || !fs.existsSync(resolved)) {
        throw new Error(`${entry.name}: browser module ${declared.module} does not exist`)
      }
      browserModules.push(resolved)
    }

    if (surfaces.length > 0 || hasCatalogs || hasErrorMessages || browserModules.length > 0) {
      found.push({
        name: entry.name,
        surfaces,
        ...(i18nModule === undefined ? {} : { i18nModule }),
        hasCatalogs,
        hasErrorMessages,
        browserModules,
      })
    }
  }
  return found
}

// Import specifiers in the generated modules are RELATIVE to the directory
// the module is written into. An absolute filesystem path reads as a
// root-relative URL to vite, so neither the dependency scanner nor the dev
// server follows it; a relative path is one both agree on.
const specifier = (file: string, fromDir: string | undefined): string => {
  if (fromDir === undefined) return pathToFileURL(file).pathname
  const relative = path.relative(fromDir, file).split(path.sep).join('/')
  return relative.startsWith('.') ? relative : `./${relative}`
}

/** a loader entry: one surface's address, and the import edge behind it */
const loader = (key: string, file: string, fromDir: string | undefined, indent = '  ') =>
  `${indent}${JSON.stringify(key)}: () => import(${JSON.stringify(specifier(file, fromDir))}),`

/**
 * The virtual module's source: four tables of loaders, keyed by surface.
 *
 * Four rather than one, because the four address spaces are different - a
 * page id, a layout contract, a slot and the item under it, a login driver
 * type - and a single table would have to invent a prefix to keep them
 * apart. The values are the only place a module path appears in what the
 * browser runs, and they are erased by the bundler into chunk urls.
 */
export async function buildPluginModuleSource(
  options: { ymlPath?: string; fromDir?: string } = {},
): Promise<string> {
  const imports: string[] = []
  const pageEntries: string[] = []
  const layoutEntries: string[] = []
  const slotEntries = new Map<string, string[]>()
  const loginEntries: string[] = []
  const catalogEntries: string[] = []
  const errorSpreads: string[] = []
  for (const entry of await collectWebPlugins(options)) {
    const ns = entry.name.split('/').pop()!.replace('plugin-', '').replaceAll('-', '_')
    for (const module of entry.browserModules) {
      // for its side effects: a provider half announcing itself at boot
      imports.push(`import ${JSON.stringify(specifier(module, options.fromDir))}`)
    }
    for (const binding of entry.surfaces) {
      // a real dynamic import per surface: the edge Vite splits chunks on
      const { surface, file } = binding
      if (surface.kind === 'page') pageEntries.push(loader(surface.id, file, options.fromDir))
      else if (surface.kind === 'layout') {
        layoutEntries.push(loader(surface.id, file, options.fromDir))
      } else if (surface.kind === 'login') {
        loginEntries.push(loader(surface.id, file, options.fromDir))
      } else {
        const items = slotEntries.get(surface.slot) ?? []
        items.push(loader(surface.id, file, options.fromDir, '    '))
        slotEntries.set(surface.slot, items)
      }
    }
    if (entry.hasCatalogs) {
      imports.push(
        `import { catalogs as ${ns}Catalogs } from ${JSON.stringify(specifier(entry.i18nModule!, options.fromDir))}`,
      )
      catalogEntries.push(`  ${ns}Catalogs,`)
    }
    if (entry.hasErrorMessages) {
      imports.push(
        `import { errorMessages as ${ns}ErrorMessages } from ${JSON.stringify(specifier(entry.i18nModule!, options.fromDir))}`,
      )
      errorSpreads.push(`  ...${ns}ErrorMessages,`)
    }
  }
  const slotTable = [...slotEntries].flatMap(([key, items]) => [
    `  ${JSON.stringify(key)}: {`,
    ...items,
    '  },',
  ])
  return [
    ...imports,
    '',
    'export const pageComponents = {',
    ...pageEntries,
    '}',
    '',
    'export const layoutComponents = {',
    ...layoutEntries,
    '}',
    '',
    'export const slotComponents = {',
    ...slotTable,
    '}',
    '',
    'export const loginComponents = {',
    ...loginEntries,
    '}',
    '',
    'export const catalogs = [',
    ...catalogEntries,
    ']',
    '',
    'export const errorMessages = {',
    ...errorSpreads,
    '}',
    '',
  ].join('\n')
}

/**
 * The private map from a public surface to the module behind it.
 *
 * Surface addressing takes the implementation off the wire; it must not take
 * it out of existence, or a `surface-missing` report and a question about
 * which chunk a page landed in become unanswerable. So the build writes the
 * answer down beside its output, under the same rule as a source map:
 * archived with the build, never installed into a release, never served.
 */
export async function buildSurfaceMapSource(options: { ymlPath?: string } = {}): Promise<string> {
  const map: Record<string, { owner: string; module: string; export: string }> = {}
  for (const entry of await collectWebPlugins(options)) {
    for (const binding of entry.surfaces) {
      map[surfaceLabel(binding.surface)] = {
        owner: entry.name,
        module: binding.module,
        export: binding.export,
      }
    }
  }
  return `${JSON.stringify(map, null, 2)}\n`
}

/**
 * The same modules as static imports, for the dependency scanner only.
 *
 * The aggregate reaches components through dynamic imports so vite can split
 * chunks on them - but the cold-start dependency scanner does not follow a
 * dynamic import to an absolute path, so any third-party package reached only
 * through a component was discovered mid-run, and the re-optimize reload tore
 * down every mounted test. This module is never executed; it exists so the
 * scanner sees the whole component tree before anything runs.
 */
export async function buildPluginScanSource(
  options: { ymlPath?: string; fromDir?: string } = {},
): Promise<string> {
  const modules = new Set<string>()
  for (const entry of await collectWebPlugins(options)) {
    for (const binding of entry.surfaces) modules.add(specifier(binding.file, options.fromDir))
    if (entry.i18nModule) modules.add(specifier(entry.i18nModule, options.fromDir))
    for (const module of entry.browserModules) modules.add(specifier(module, options.fromDir))
  }
  return [...modules].map((file) => `import ${JSON.stringify(file)}`).join('\n') + '\n'
}
