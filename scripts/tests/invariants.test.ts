import { describe, expect, it } from 'vitest'
import { resolveSchemaEntries } from '../lib/schema-entries.ts'
import { commitLock, createWorkspace } from './support/workspace.ts'

// Neither switching a plugin off nor taking it out of the manifest may change
// what the database owns: tables outlive both.

const SELECTION = [
  '@qualy/plugin-database',
  '@qualy/plugin-server',
  '@qualy/plugin-ui-registry',
  '@qualy/plugin-org',
  '@qualy/plugin-ping',
]

describe('schema aggregation invariants', () => {
  it('disabling a plugin does not change the schema entry set', () => {
    const enabled = createWorkspace(SELECTION)
    const disabled = createWorkspace(SELECTION, { disabled: ['@qualy/plugin-ping'] })
    try {
      expect(
        resolveSchemaEntries({ ymlPath: disabled.manifestPath }),
        'Disabling a plugin must not alter the aggregated database schema',
      ).toEqual(resolveSchemaEntries({ ymlPath: enabled.manifestPath }))
    } finally {
      enabled.dispose()
      disabled.dispose()
    }
  })

  it('removing a plugin from the manifest does not change it either', () => {
    const workspace = createWorkspace(SELECTION)
    try {
      commitLock(workspace)
      const before = resolveSchemaEntries({ ymlPath: workspace.manifestPath })
      workspace.writeManifest(SELECTION.filter((id) => id !== '@qualy/plugin-ping'))
      commitLock(workspace)
      expect(
        resolveSchemaEntries({ ymlPath: workspace.manifestPath }),
        'A detached plugin still owns its tables, so its schema stays in the set',
      ).toEqual(before)
    } finally {
      workspace.dispose()
    }
  })
})
