import fs from 'node:fs'
import path from 'node:path'
import { defineCapabilityProvider, type ContributionInput } from '@qualy/assembly-contract'

// Everything the assembly knows about permissions lives behind this one
// module, and it disappears with rbac: an assembly with no authorization
// resolves no catalog.
//
// It generates nothing. The running catalog is declared at boot - each plugin
// registers its codes while its layer is built, and rbac mirrors the complete
// set at the assembled barrier - so what is left for the assembly is what only
// the assembly can do: refuse a broken declaration at `qualy resolve`, before
// anything has booted, and record who declares codes in the lock. The seed
// still reads the declared modules through `qualy.contributions.permissions`,
// because it writes permission rows without starting an application.
//
// Importing this module must stay free of side effects: it runs inside the
// CLI, which has agreed to open nothing.

export interface PermissionsContribution {
  /** the module whose `permissions` export is this plugin's catalog */
  entry: string
}

export interface PermissionsState {
  /** the plugins that declare codes, in a stable order */
  order: string[]
}

export function parsePermissionsContribution(input: ContributionInput): PermissionsContribution {
  const where = `${input.pluginId}: qualy.contributions.permissions`
  const raw = input.raw
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${where} must be a mapping`)
  }
  for (const key of Object.keys(raw)) {
    if (key !== 'entry') throw new Error(`${where}: unknown key ${key}`)
  }
  const entry = (raw as { entry?: unknown }).entry
  if (typeof entry !== 'string' || !entry.trim()) {
    throw new Error(`${where}.entry must be a path inside the package`)
  }
  if (path.isAbsolute(entry)) {
    throw new Error(`${where}.entry must be relative to the package, got ${entry}`)
  }
  return { entry }
}

const exportTarget = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return exportTarget(record.import ?? record.default)
  }
  return undefined
}

/**
 * The declaring module, checked against the subpath the seed will import.
 *
 * The seed reaches the catalog through `exports['./permissions']`, and the
 * running plugin declares the same module at boot, so a declaration pointing
 * somewhere else would mean two modules and two answers to what a code means.
 */
const catalogFile = (
  packageDir: string,
  pluginId: string,
  contribution: PermissionsContribution,
): string => {
  const file = path.resolve(packageDir, contribution.entry)
  const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')) as {
    exports?: Record<string, unknown>
  }
  const exported = exportTarget(pkg.exports?.['./permissions'])
  if (!exported || path.resolve(packageDir, exported) !== file) {
    throw new Error(
      `${pluginId}: exports["./permissions"] and qualy.contributions.permissions.entry must point at the same file`,
    )
  }
  return file
}

/**
 * A code claimed twice has no owner.
 *
 * The authoritative check is at boot, where rbac's registry refuses the
 * second declaration with both plugins named. This one is the early answer:
 * it runs at `qualy resolve`, which may not import plugin code - it also runs
 * at startup, where nothing can compile TypeScript - so it reads source text
 * and accepts that a determined declaration can evade it.
 */
function assertNoDuplicateCodes(files: readonly { pluginId: string; file: string }[]): void {
  const owners = new Map<string, string>()
  const clashes: string[] = []
  for (const entry of files) {
    const source = fs.readFileSync(entry.file, 'utf8')
    for (const [, code] of source.matchAll(/\bcode:\s*'([^']+)'/g) as Iterable<RegExpMatchArray>) {
      const previous = owners.get(code!)
      if (previous && previous !== entry.pluginId) {
        clashes.push(`${code} is declared by both ${previous} and ${entry.pluginId}`)
      } else {
        owners.set(code!, entry.pluginId)
      }
    }
  }
  if (clashes.length > 0) {
    throw new Error(`permission codes collide:\n  ${clashes.join('\n  ')}`)
  }
}

export default defineCapabilityProvider<PermissionsContribution, PermissionsState>({
  key: 'permissions',

  parseContribution: parsePermissionsContribution,

  // The ACTIVE set, deliberately. A disabled plugin keeps its tables, because
  // switching it off must not lose data; it must not keep its codes, because a
  // code that still authorizes against a surface nobody serves is a permission
  // granted for nothing. The two capabilities answer the same question
  // differently, which is why each answers it for itself.
  resolve: (context) => {
    const order = [...context.contributions.keys()]
      .filter((pluginId) => context.plugins.get(pluginId)?.state === 'active')
      .sort()
    assertNoDuplicateCodes(
      order.map((pluginId) => ({
        pluginId,
        file: catalogFile(
          context.resolvePackageDir(pluginId),
          pluginId,
          context.contributions.get(pluginId)!,
        ),
      })),
    )
    return { order }
  },

  // A catalog is a declaration, not a resource: a plugin that leaves takes its
  // codes with it, and the rows its codes named are rbac's to reconcile.
  retainsPlugin: () => false,

  plan: ({ nextState }) =>
    nextState.order.length > 0
      ? nextState.order.map((id) => `+ ${id}`)
      : ['no plugin declares permissions'],
})

export type { PermissionsContribution as Contribution, PermissionsState as State }
