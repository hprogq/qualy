import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { commonErrorCodes } from '@qualy/i18n-contract'
import { isPluginDescriptor, Plugin, type PluginDescriptor } from '@qualy/plugin-kit'
import { I18nCatalogs, UiSurfaceDeclarations } from '@qualy/plugin-ui-registry/plugin'
import { LoginDriverDeclarations } from '@qualy/auth-contract/plugin'
import { componentKey, type ClientComponentRef } from '@qualy/ui-contract'
import { currentResolution, readEntries, resolvePackageDir } from '@qualy/assembly/host'
import { manifestPath, repoRoot } from './manifest.ts'

// The browser's plugin aggregate, as a module SOURCE rather than a file.
//
// Components come from the descriptors: every Ui.page / Ui.layout / Ui.slot
// and login driver declares a ClientComponentRef, and this collector turns
// each into a statically analysable import under its derived registry key -
// the same `componentKey` the manifest projects, so the wire and the bundle
// cannot disagree. Localisation assets still come from the ./client entry,
// which is what that entry is for now that the registry left it.
//
// The registry follows the ACTIVE set: a disabled plugin's modules never
// enter the graph, so its chunks tree-shake away; release builds pass `all`
// for the superset. Every identity - registry key, catalog namespace,
// message id, error code - is claimed exactly once here, because an object
// spread would let a later plugin silently shadow an earlier one.

export interface WebPluginEntry {
  name: string
  /** derived registry key to the module file it loads */
  components: Record<string, string>
  /** the declared localisation module, absolute, when the plugin ships one */
  i18nModule?: string
  hasCatalogs: boolean
  hasErrorMessages: boolean
}

const componentRefs = (descriptor: PluginDescriptor): ClientComponentRef[] => {
  const refs: ClientComponentRef[] = []
  for (const surfaces of Plugin.contributionsOf(descriptor, UiSurfaceDeclarations)) {
    for (const page of surfaces.pages ?? []) refs.push(page.component)
    for (const layout of surfaces.layouts ?? []) refs.push(layout.component)
    for (const slot of surfaces.slots ?? []) refs.push(slot.component)
  }
  for (const driver of Plugin.contributionsOf(descriptor, LoginDriverDeclarations)) {
    if (driver.presentation.mode === 'component') refs.push(driver.presentation.component)
  }
  return refs
}

export async function collectWebPlugins(
  options: { all?: boolean; ymlPath?: string } = {},
): Promise<WebPluginEntry[]> {
  const webDeps = new Set(
    Object.keys(
      (
        JSON.parse(fs.readFileSync(path.join(repoRoot, 'apps/web/package.json'), 'utf8')) as {
          dependencies?: Record<string, string>
        }
      ).dependencies ?? {},
    ),
  )

  const manifest = manifestPath(options.ymlPath)
  const resolution = await currentResolution(manifest)
  const found: WebPluginEntry[] = []
  const claimedKeys = new Map<string, string>()
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

    const components: Record<string, string> = {}
    for (const ref of componentRefs(descriptor)) {
      const key = componentKey(entry.name, ref)
      // relative to src/, where the descriptor that declared it lives
      const file = path.resolve(packageDir, 'src', ref.module)
      if (!file.startsWith(packageDir + path.sep) || !fs.existsSync(file)) {
        throw new Error(`${entry.name}: component module ${ref.module} does not exist`)
      }
      claim(claimedKeys, key, entry.name, 'component key')
      components[key] = file
    }
    if (Object.keys(components).length > 0 && !webDeps.has(entry.name)) {
      throw new Error(
        `${entry.name} contributes components but apps/web does not declare it; run pnpm plugin:add`,
      )
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

    if (Object.keys(components).length > 0 || hasCatalogs || hasErrorMessages) {
      found.push({
        name: entry.name,
        components,
        ...(i18nModule === undefined ? {} : { i18nModule }),
        hasCatalogs,
        hasErrorMessages,
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

/** the virtual module's source, from the validated collection */
export async function buildPluginModuleSource(
  options: { all?: boolean; ymlPath?: string; fromDir?: string } = {},
): Promise<string> {
  const imports: string[] = []
  const componentEntries: string[] = []
  const catalogEntries: string[] = []
  const errorSpreads: string[] = []
  for (const entry of await collectWebPlugins(options)) {
    const ns = entry.name.split('/').pop()!.replace('plugin-', '').replaceAll('-', '_')
    for (const [key, file] of Object.entries(entry.components)) {
      // a real dynamic import per key: the edge Vite splits chunks on
      componentEntries.push(
        `  ${JSON.stringify(key)}: () => import(${JSON.stringify(specifier(file, options.fromDir))}),`,
      )
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
  return [
    ...imports,
    '',
    'export const components = {',
    ...componentEntries,
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
  options: { all?: boolean; ymlPath?: string; fromDir?: string } = {},
): Promise<string> {
  const modules = new Set<string>()
  for (const entry of await collectWebPlugins(options)) {
    for (const file of Object.values(entry.components))
      modules.add(specifier(file, options.fromDir))
    if (entry.i18nModule) modules.add(specifier(entry.i18nModule, options.fromDir))
  }
  return [...modules].map((file) => `import ${JSON.stringify(file)}`).join('\n') + '\n'
}
