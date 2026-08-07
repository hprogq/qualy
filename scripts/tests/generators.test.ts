import { describe, expect, it } from 'vitest'
import { createWorkspace, resolveWorkspace } from '@qualy/assembly/testkit'
import { buildPluginModuleSource } from '../lib/web-plugins.ts'

// There is no generator left: the browser aggregate is a virtual module the
// Vite plugin computes from the verified resolution, and the typed clients
// are per plugin. What remains to assert is the aggregation behaviour itself
// - which set it follows - and the resolution-level facts the old generator
// suite pinned.

describe('the browser aggregate', () => {
  it('drops disabled plugins from the active set but keeps them under all', async () => {
    // ping owns tables, so the selection has to include the capability that
    // accepts them or resolution refuses the manifest
    const workspace = createWorkspace(
      ['@qualy/plugin-database', '@qualy/plugin-ui-registry', '@qualy/plugin-ping'],
      { disabled: ['@qualy/plugin-ping'] },
    )
    try {
      expect(await buildPluginModuleSource({ ymlPath: workspace.manifestPath })).not.toContain(
        'ping/PingPage',
      )
      // the superset a release build carries, so enabling a plugin needs no
      // rebuild of the assets
      expect(
        await buildPluginModuleSource({ all: true, ymlPath: workspace.manifestPath }),
      ).toContain('ping/PingPage')
    } finally {
      workspace.dispose()
    }
  })

  // Which plugins the permission catalog counts is a security property. A
  // disabled plugin whose codes kept authorizing would be authorizing against
  // a surface nobody serves; its layer never builds, so it never declares,
  // and this pins the resolution-level record of the same fact.
  it('drops a disabled plugin from the permission set, and keeps its tables', async () => {
    const workspace = createWorkspace(
      [
        '@qualy/plugin-database',
        '@qualy/plugin-ui-registry',
        '@qualy/plugin-org',
        '@qualy/plugin-auth',
        '@qualy/plugin-rbac',
      ],
      { disabled: ['@qualy/plugin-org'] },
    )
    try {
      const resolution = await resolveWorkspace(workspace)
      const permissions = resolution.capabilities.get('permissions')?.state as { order: string[] }
      expect(permissions.order).not.toContain('@qualy/plugin-org')
      expect(permissions.order).toContain('@qualy/plugin-rbac')
      // the database capability answers the same question the other way:
      // switching a plugin off must not lose data, so its tables stay
      const database = resolution.capabilities.get('database')?.state as { order: string[] }
      expect(database.order).toContain('@qualy/plugin-org')
    } finally {
      workspace.dispose()
    }
  })
})
