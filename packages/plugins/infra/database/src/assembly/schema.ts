import fs from 'node:fs'
import path from 'node:path'
import type { CapabilityResolveContext } from '@qualy/assembly-contract'
import type { DatabaseContribution } from './contribution.ts'
import type { DatabaseState } from './state.ts'

// The aggregated schema drizzle diffs against, with no generated file in
// between: the set is the retained plugins' declared entries, in database
// dependency order.
//
// Switching a plugin off or taking it out of the manifest never changes this
// set, because neither removes its tables. Reading the running set here would
// make drizzle see tables disappear and generate a DROP for data nobody
// agreed to lose.

const exportTarget = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return exportTarget(record.import ?? record.default)
  }
  return undefined
}

export function schemaEntries(
  context: Pick<
    CapabilityResolveContext<DatabaseContribution, DatabaseState>,
    'contributions' | 'resolvePackageDir'
  >,
  state: DatabaseState,
): string[] {
  const files: string[] = []
  for (const pluginId of state.order) {
    const contribution = context.contributions.get(pluginId)
    const schemaEntry = contribution?.schemaEntry
    if (!schemaEntry) continue
    const packageDir = context.resolvePackageDir(pluginId)
    const file = path.resolve(packageDir, schemaEntry)
    // cross-plugin imports and kit aggregation must share one file, or a
    // table can exist twice with two identities
    const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')) as {
      exports?: Record<string, unknown>
    }
    const exported = exportTarget(pkg.exports?.['./schema'])
    if (exported && path.resolve(packageDir, exported) !== file) {
      throw new Error(
        `${pluginId}: exports["./schema"] and qualy.contributions.database.schemaEntry must point at the same file`,
      )
    }
    files.push(file)
  }
  return files
}
