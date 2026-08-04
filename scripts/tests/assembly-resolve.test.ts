import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  lockDrift,
  lockFromResolution,
  lockPathFor,
  parseManifest,
  readLock,
  renderLock,
  renderRuntimePlan,
  resolveAssembly,
  writeLock,
} from '@qualy/assembly'
import { createWorkspace, renderManifestText } from './support/workspace.ts'

// What an assembly resolves to has to be a function of what it says, not of
// how it was written or of what ran before. Everything here is a property of
// that: the same selection resolves to the same bytes, a selection that
// cannot work is refused by name, and a plugin taken out of the manifest
// keeps whatever the database is holding for it.

const CORE = ['@qualy/plugin-database', '@qualy/plugin-server', '@qualy/plugin-ui-registry']
const WITH_TABLES = [...CORE, '@qualy/plugin-org', '@qualy/plugin-auth']

const resolve = (manifestPath: string) =>
  resolveAssembly({ manifestPath, previousLock: readLock(lockPathFor(manifestPath)) })

const commit = (manifestPath: string) => {
  const resolution = resolve(manifestPath)
  writeLock(lockPathFor(manifestPath), lockFromResolution(resolution))
  return resolution
}

describe('manifest', () => {
  const parse = (text: string) => () => parseManifest(text, 'qualy.yml')

  it('refuses the entry-array form it replaced', () => {
    // the old file is valid yaml, so without this it would parse as a
    // manifest with no plugins at all and quietly resolve to nothing
    expect(parse("- name: '@qualy/plugin-org'\n")).toThrow(/old entry-array format/)
  })

  it('refuses one plugin declared twice', () => {
    // yaml's own answer is last-one-wins, which leaves no single answer for
    // the plugin's config
    expect(parse("version: 1\nplugins:\n  '@a': {}\n  '@a': {}\n")).toThrow()
  })

  it('refuses keys it does not understand', () => {
    expect(parse('version: 1\nplugins: {}\nsetup: {}\n')).toThrow(/unknown top-level key setup/)
    expect(parse("version: 1\nplugins:\n  '@a':\n    enable: true\n")).toThrow(/unknown key enable/)
    expect(parse('version: 2\nplugins: {}\n')).toThrow(/version must be 1/)
  })

  it('reads a plugin with nothing after the colon as selected', () => {
    const manifest = parseManifest("version: 1\nplugins:\n  '@a':\n  '@b': {}\n", 'qualy.yml')
    expect([...manifest.plugins.keys()]).toEqual(['@a', '@b'])
    expect(manifest.plugins.get('@a')!.enabled).toBe(true)
  })
})

describe('resolution', () => {
  it('writes the same lock twice, and again in a different key order', () => {
    const first = createWorkspace(WITH_TABLES)
    const second = createWorkspace([...WITH_TABLES].reverse())
    try {
      const lock = renderLock(lockFromResolution(commit(first.manifestPath)))
      // a second resolve of an unchanged tree has nothing to write
      expect(
        writeLock(lockPathFor(first.manifestPath), lockFromResolution(resolve(first.manifestPath))),
      ).toBe(false)
      expect(renderLock(lockFromResolution(resolve(second.manifestPath)))).toBe(lock)
    } finally {
      first.dispose()
      second.dispose()
    }
  })

  it('refuses a selection that leaves a schema dependency behind', () => {
    // rbac's tables reference auth's. Without this the failure arrives from
    // postgres midway through applying a migration, naming a relation rather
    // than the plugin that owns it.
    const workspace = createWorkspace([...CORE, '@qualy/plugin-org', '@qualy/plugin-rbac'])
    try {
      expect(() => resolve(workspace.manifestPath)).toThrow(
        /@qualy\/plugin-rbac needs @qualy\/plugin-auth, which this assembly does not include/,
      )
    } finally {
      workspace.dispose()
    }
  })

  it('refuses a database dependency cycle and names the path', () => {
    const synthetic = [
      {
        id: '@fake/plugin-a',
        qualy: { database: { schemaEntry: 'index.js', dependsOn: ['@fake/plugin-b'] } },
      },
      {
        id: '@fake/plugin-b',
        qualy: { database: { schemaEntry: 'index.js', dependsOn: ['@fake/plugin-a'] } },
      },
    ]
    const workspace = createWorkspace(['@fake/plugin-a', '@fake/plugin-b'], { synthetic })
    try {
      expect(() => resolve(workspace.manifestPath)).toThrow(
        /database dependency cycle: @fake\/plugin-a -> @fake\/plugin-b -> @fake\/plugin-a/,
      )
    } finally {
      workspace.dispose()
    }
  })

  it('orders the database by declared dependency, not by the file', () => {
    const workspace = createWorkspace([...WITH_TABLES].reverse())
    try {
      const { databaseOrder } = resolve(workspace.manifestPath)
      expect(databaseOrder.indexOf('@qualy/plugin-org')).toBeLessThan(
        databaseOrder.indexOf('@qualy/plugin-auth'),
      )
    } finally {
      workspace.dispose()
    }
  })
})

describe('removal', () => {
  it('keeps a removed plugin that owns tables, and its schema with it', () => {
    const workspace = createWorkspace(WITH_TABLES)
    try {
      const before = commit(workspace.manifestPath)
      expect(before.plugins.get('@qualy/plugin-auth')!.state).toBe('active')

      // auth leaves the manifest; its tables do not leave the database
      workspace.writeManifest([...CORE, '@qualy/plugin-org'])
      const after = commit(workspace.manifestPath)
      expect(after.plugins.get('@qualy/plugin-auth')!.state).toBe('detached')
      expect(after.runtimeOrder).not.toContain('@qualy/plugin-auth')
      expect(after.databaseOrder).toContain('@qualy/plugin-auth')

      // and putting it back is just the manifest again
      workspace.writeManifest(WITH_TABLES)
      expect(commit(workspace.manifestPath).plugins.get('@qualy/plugin-auth')!.state).toBe('active')
    } finally {
      workspace.dispose()
    }
  })

  it('lets a removed plugin with no tables go', () => {
    // detaching one that owns nothing would park a dead entry in the lock
    // with no way to ever take it out
    const workspace = createWorkspace([...CORE, '@qualy/plugin-api-reference'])
    try {
      commit(workspace.manifestPath)
      workspace.writeManifest(CORE)
      expect(commit(workspace.manifestPath).plugins.has('@qualy/plugin-api-reference')).toBe(false)
    } finally {
      workspace.dispose()
    }
  })

  it('refuses to resolve when a detached plugin has been uninstalled', () => {
    const workspace = createWorkspace(WITH_TABLES)
    try {
      commit(workspace.manifestPath)
      workspace.writeManifest([...CORE, '@qualy/plugin-org'])
      commit(workspace.manifestPath)
      fs.rmSync(path.join(workspace.dir, 'node_modules/@qualy/plugin-auth'), { recursive: true })
      expect(() => resolve(workspace.manifestPath)).toThrow(
        /@qualy\/plugin-auth[\s\S]*Reinstall them/,
      )
    } finally {
      workspace.dispose()
    }
  })

  it('does not confuse switching a plugin off with taking it out', () => {
    const workspace = createWorkspace(WITH_TABLES, { disabled: ['@qualy/plugin-auth'] })
    try {
      const resolution = commit(workspace.manifestPath)
      expect(resolution.plugins.get('@qualy/plugin-auth')!.state).toBe('disabled')
      expect(resolution.runtimeOrder).not.toContain('@qualy/plugin-auth')
      expect(resolution.databaseOrder).toContain('@qualy/plugin-auth')
    } finally {
      workspace.dispose()
    }
  })
})

describe('frozen lockfile', () => {
  it('accepts a lock that matches', () => {
    const workspace = createWorkspace(WITH_TABLES)
    try {
      commit(workspace.manifestPath)
      expect(
        lockDrift(readLock(lockPathFor(workspace.manifestPath)), resolve(workspace.manifestPath)),
      ).toEqual([])
    } finally {
      workspace.dispose()
    }
  })

  it('rejects an edited manifest', () => {
    const workspace = createWorkspace(WITH_TABLES)
    try {
      commit(workspace.manifestPath)
      const lock = readLock(lockPathFor(workspace.manifestPath))
      workspace.writeManifest(WITH_TABLES, { disabled: ['@qualy/plugin-auth'] })
      expect(lockDrift(lock, resolve(workspace.manifestPath))).toEqual([
        expect.stringContaining('changed since the lock was written'),
        expect.stringContaining('does not match'),
      ])
    } finally {
      workspace.dispose()
    }
  })

  it('rejects an edited lock', () => {
    const workspace = createWorkspace(WITH_TABLES)
    try {
      commit(workspace.manifestPath)
      const lockPath = lockPathFor(workspace.manifestPath)
      const lock = readLock(lockPath)!
      lock.plugins['@qualy/plugin-org']!.state = 'disabled'
      fs.writeFileSync(lockPath, renderLock(lock))
      expect(lockDrift(readLock(lockPath), resolve(workspace.manifestPath))).toEqual([
        expect.stringContaining('has been edited'),
      ])
    } finally {
      workspace.dispose()
    }
  })

  it('reports a missing lock rather than inventing one', () => {
    const workspace = createWorkspace(WITH_TABLES)
    try {
      expect(lockDrift(undefined, resolve(workspace.manifestPath))).toEqual([
        expect.stringContaining('no lock file'),
      ])
    } finally {
      workspace.dispose()
    }
  })
})

describe('runtime plan', () => {
  it('gives every entry an id derived from its name', () => {
    // the loader invents random ids for entries that lack them and writes
    // them back into the file it read; a derived id leaves nothing to write
    const workspace = createWorkspace(CORE)
    try {
      const plan = renderRuntimePlan(resolve(workspace.manifestPath))
      expect(plan).toBe(renderRuntimePlan(resolve(workspace.manifestPath)))
      expect(plan.match(/^- id: /gm)).toHaveLength(CORE.length)
    } finally {
      workspace.dispose()
    }
  })

  it('carries plugin config through unchanged', () => {
    const workspace = createWorkspace(CORE, { configs: { '@qualy/plugin-server': { port: 4000 } } })
    try {
      expect(renderRuntimePlan(resolve(workspace.manifestPath))).toContain('port: 4000')
    } finally {
      workspace.dispose()
    }
  })

  it('leaves out what is not running', () => {
    const workspace = createWorkspace(WITH_TABLES, { disabled: ['@qualy/plugin-auth'] })
    try {
      expect(renderRuntimePlan(resolve(workspace.manifestPath))).not.toContain('plugin-auth')
    } finally {
      workspace.dispose()
    }
  })
})

describe('the manifest this repository ships', () => {
  it('has a lock that matches it', () => {
    // the committed lock is what a deployment runs with; a stale one turns
    // every frozen start into a puzzle
    const manifestPath = path.resolve('packages/app/qualy.yml')
    expect(lockDrift(readLock(lockPathFor(manifestPath)), resolve(manifestPath))).toEqual([])
  })

  it('is rendered the way this test renders manifests', () => {
    // the workspace helper writes manifests by hand; if that drifted from
    // the real format every test above would be exercising a fiction
    const text = renderManifestText(['@qualy/plugin-org'], {
      configs: { '@qualy/plugin-org': { a: 1 } },
    })
    const manifest = parseManifest(text, 'generated')
    expect(manifest.plugins.get('@qualy/plugin-org')).toEqual({ enabled: true, config: { a: 1 } })
  })
})
