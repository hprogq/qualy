import fs from 'node:fs'
import path from 'node:path'
import { validateComponentKeys } from './component-keys.ts'
import { commonErrorCodes } from '@qualy/i18n-contract'
import { readEntries } from './read-entries.ts'
import { repoRoot } from './paths.ts'
import { resolvePackageDir, resolvePluginModuleUrl } from './packages.ts'

// The browser's plugin aggregate, as a module SOURCE rather than a file.
//
// Vite has to see a statically analysable import for every module that may
// enter the browser, so the aggregation itself cannot disappear - but nothing
// says it has to land in the working tree. The Vite plugin serves this source
// as `virtual:qualy/plugins`, dev and build alike, and the server never
// generates frontend code again.
//
// The registry follows the ACTIVE set: a disabled plugin's thunks never enter
// the module graph, so its chunks tree-shake away; release builds pass `all`
// for the superset. A plugin exposes components by declaring
// exports["./client"], whose module must export a `components` thunk table
// (no top-level side effects). Every localization identity is claimed exactly
// once here, because an object spread would let a later plugin silently
// shadow an earlier one.

export interface WebPluginEntry {
  name: string
  /** the "<plugin>/<Component>" keys its client module registers */
  componentKeys: string[]
  hasCatalogs: boolean
  hasErrorMessages: boolean
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

  const found: WebPluginEntry[] = []
  const claimedNamespaces = new Map<string, string>()
  const claimedMessageIds = new Map<string, string>()
  const claimedErrorCodes = new Map<string, string>()
  const COMMON_ERROR_CODES = new Set<string>(commonErrorCodes)
  const claim = (registry: Map<string, string>, key: string, owner: string, what: string) => {
    const existing = registry.get(key)
    if (existing) throw new Error(`${what} conflict: ${key} claimed by ${existing} and ${owner}`)
    registry.set(key, owner)
  }

  for (const entry of await readEntries({ all: options.all ?? false, ymlPath: options.ymlPath })) {
    if (!entry.name.startsWith('@qualy/')) continue
    const packageDir = resolvePackageDir(entry.name, options.ymlPath)
    const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')) as {
      exports?: Record<string, unknown>
    }
    if (!pkg.exports?.['./client']) continue
    if (!webDeps.has(entry.name)) {
      throw new Error(
        `${entry.name} contributes components but apps/web does not declare it; run pnpm plugin:add`,
      )
    }
    // enforce the "<plugin>/<Component>" key namespace at collection time,
    // so merged registries can never silently shadow one another
    const module = (await import(resolvePluginModuleUrl(`${entry.name}/client`))) as {
      components?: Record<string, unknown>
      catalogs?: unknown
      errorMessages?: unknown
    }
    const componentKeys = Object.keys(module.components ?? {})
    validateComponentKeys(entry.name, componentKeys)
    // localization assets are optional per plugin: a plugin without user
    // facing text ships neither, and the host aggregates whatever exists
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
    }
    if (module.errorMessages) {
      for (const code of Object.keys(module.errorMessages as Record<string, unknown>)) {
        if (COMMON_ERROR_CODES.has(code)) {
          throw new Error(`${entry.name}: ${code} is a common error code and cannot be overridden`)
        }
        claim(claimedErrorCodes, code, entry.name, 'error code')
      }
    }
    found.push({
      name: entry.name,
      componentKeys,
      hasCatalogs: Boolean(module.catalogs),
      hasErrorMessages: Boolean(module.errorMessages),
    })
  }
  return found
}

/** the virtual module's source, from the validated collection */
export async function buildPluginModuleSource(
  options: { all?: boolean; ymlPath?: string } = {},
): Promise<string> {
  const imports: string[] = []
  const spreads: string[] = []
  const catalogEntries: string[] = []
  const errorSpreads: string[] = []
  for (const entry of await collectWebPlugins(options)) {
    const ns = entry.name.split('/').pop()!.replace('plugin-', '').replaceAll('-', '_')
    imports.push(`import { components as ${ns}Components } from '${entry.name}/client'`)
    spreads.push(`  ...${ns}Components,`)
    if (entry.hasCatalogs) {
      imports.push(`import { catalogs as ${ns}Catalogs } from '${entry.name}/client'`)
      catalogEntries.push(`  ${ns}Catalogs,`)
    }
    if (entry.hasErrorMessages) {
      imports.push(`import { errorMessages as ${ns}ErrorMessages } from '${entry.name}/client'`)
      errorSpreads.push(`  ...${ns}ErrorMessages,`)
    }
  }
  return [
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
    '',
  ].join('\n')
}
