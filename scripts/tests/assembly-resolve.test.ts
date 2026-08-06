import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  capabilityModules,
  lockDrift,
  lockFromResolution,
  lockPathFor,
  manifestHash,
  parseManifest,
  renderManifest,
  readLock,
  renderLock,
  runtimeLayers,
  resolveAssembly,
  writeLock,
} from '@qualy/assembly'
import { createWorkspace, renderManifestText, type SyntheticPackage } from '@qualy/assembly/testkit'

// What an assembly resolves to has to be a function of what it says, not of
// how it was written or of what ran before. Everything here is a property of
// that: the same selection resolves to the same bytes, a selection that cannot
// work is refused by name, and a plugin taken out of the manifest keeps
// whatever some capability is still holding for it.
//
// The core is asserted here; what a capability makes of a contribution is
// asserted next to the plugin that owns the capability.

const INFRA = ['@qualy/plugin-database', '@qualy/plugin-ui-registry']
// org, auth and rbac are one selection, not three: they contribute codes to
// the permissions capability rbac provides, and rbac's tables reference
// auth's, so any of them alone is an assembly resolution refuses
const WITH_TABLES = [...INFRA, '@qualy/plugin-org', '@qualy/plugin-auth', '@qualy/plugin-rbac']

const resolve = (manifestPath: string) =>
  resolveAssembly({ manifestPath, previousLock: readLock(lockPathFor(manifestPath)) })

const commit = async (manifestPath: string) => {
  const resolution = await resolve(manifestPath)
  writeLock(lockPathFor(manifestPath), lockFromResolution(resolution))
  return resolution
}

// where a host would write the module; only its directory matters, for the
// relative anchor back to the manifest

describe('manifest', () => {
  const parse = (text: string) => () => parseManifest(text, 'qualy.yml')
  /** a v2 body, so a case about one rule is not also a case about the header */
  const v2 = (body: string) => `version: 2\napplication:\n  workspace: .\n${body}`

  it('refuses the entry-array form it replaced', () => {
    // the old file is valid yaml, so without this it would parse as a manifest
    // with no plugins at all and quietly resolve to nothing
    expect(parse("- name: '@qualy/plugin-org'\n")).toThrow(/old entry-array format/)
  })

  it('refuses one plugin declared twice', () => {
    // yaml's own answer is last-one-wins, which leaves no single answer for the
    // plugin's config
    expect(parse(v2("plugins:\n  '@a': {}\n  '@a': {}\n"))).toThrow()
  })

  it('refuses keys it does not understand', () => {
    expect(parse(v2('plugins: {}\nsetup: {}\n'))).toThrow(/unknown top-level key setup/)
    expect(parse(v2("plugins:\n  '@a':\n    enable: true\n"))).toThrow(/unknown key enable/)
    expect(parse('version: 2\napplication:\n  root: .\nplugins: {}\n')).toThrow(
      /application: unknown key root/,
    )
    expect(parse('version: 3\nplugins: {}\n')).toThrow(/version must be 2/)
  })

  it('refuses a manifest that will not say where its plugins are installed', () => {
    // The version bump exists for this. A v1 parser refuses `application` as an
    // unknown top-level key, so a file carrying one was never readable as v1 -
    // and leaving the field optional would have kept the guess it replaces:
    // that the manifest's own directory is the host, which is right until
    // somebody puts the manifest where its readers can find it.
    expect(parse('version: 2\nplugins: {}\n')).toThrow(/application.workspace is required/)
    expect(parse('version: 2\napplication: {}\nplugins: {}\n')).toThrow(
      /application.workspace is required/,
    )
    expect(parse('version: 2\napplication:\n  workspace: /srv\nplugins: {}\n')).toThrow(
      /must be relative/,
    )
  })

  it('reads the host it names', () => {
    const manifest = parseManifest(v2('plugins: {}\n'), 'qualy.yml')
    expect(manifest.version).toBe(2)
    expect(manifest.workspace).toBe('.')
  })

  it('reads a plugin with nothing after the colon as selected', () => {
    const manifest = parseManifest(v2("plugins:\n  '@a':\n  '@b': {}\n"), 'qualy.yml')
    expect([...manifest.plugins.keys()]).toEqual(['@a', '@b'])
    expect(manifest.plugins.get('@a')!.enabled).toBe(true)
  })

  it('hashes the host it names, and spells it one way', () => {
    // Pointing the workspace at another package selects different installed
    // versions of the same plugin ids, so a hash that ignored it would call
    // that the same assembly and a frozen start would accept it. Equivalent
    // spellings must NOT drift, or a whitespace-level edit reads as a change.
    const hashOf = (workspace: string) =>
      manifestHash(
        parseManifest(
          `version: 2\napplication:\n  workspace: ${workspace}\nplugins: {}\n`,
          'qualy.yml',
        ),
      )
    expect(hashOf('./apps/server')).toBe(hashOf('apps/server'))
    expect(hashOf('./apps/server')).toBe(hashOf('./apps/./server'))
    expect(hashOf('./apps/server')).toBe(hashOf('apps/server/'))
    expect(hashOf('./apps/server')).not.toBe(hashOf('./apps/web'))
    expect(hashOf('.')).toBe(hashOf('./'))
  })

  it('survives a round trip through the renderer', () => {
    // renderManifest is what rewrites a manifest; dropping the application
    // block would silently turn a hosted assembly into a standalone one
    const original = parseManifest(
      v2("plugins:\n  '@a': {}\n  '@b':\n    enabled: false\n"),
      'qualy.yml',
    )
    const again = parseManifest(renderManifest(original), 'qualy.yml')
    expect(again.workspace).toBe(original.workspace)
    expect(again.version).toBe(2)
    expect(manifestHash(again)).toBe(manifestHash(original))
  })

  it('is rendered the way the testkit renders manifests', () => {
    // the testkit writes manifests by hand; if that drifted from the real
    // format every workspace test would be exercising a fiction
    const text = renderManifestText(['@qualy/plugin-org'], {
      configs: { '@qualy/plugin-org': { a: 1 } },
    })
    expect(parseManifest(text, 'generated').plugins.get('@qualy/plugin-org')).toEqual({
      enabled: true,
      config: { a: 1 },
    })
  })
})

describe('resolution', () => {
  it('writes the same lock twice, and again in a different key order', async () => {
    const first = createWorkspace(WITH_TABLES)
    const second = createWorkspace([...WITH_TABLES].reverse())
    try {
      const lock = renderLock(lockFromResolution(await commit(first.manifestPath)))
      // a second resolve of an unchanged tree has nothing to write
      const again = lockFromResolution(await resolve(first.manifestPath))
      expect(writeLock(lockPathFor(first.manifestPath), again)).toBe(false)
      expect(renderLock(lockFromResolution(await resolve(second.manifestPath)))).toBe(lock)
    } finally {
      first.dispose()
      second.dispose()
    }
  })

  it('hands each capability its own section of the lock', async () => {
    const workspace = createWorkspace(WITH_TABLES)
    try {
      const lock = lockFromResolution(await commit(workspace.manifestPath))
      // two of them, each with its own provider and its own opaque state
      expect(Object.keys(lock.capabilities).sort()).toEqual(['database', 'permissions'])
      expect(lock.capabilities.database!.provider).toBe('@qualy/plugin-database')
      expect(lock.capabilities.permissions!.provider).toBe('@qualy/plugin-rbac')
      // the plugin's own declaration travels with the plugin, not the capability
      expect(lock.plugins['@qualy/plugin-auth']!.contributions).toHaveProperty('database')
      expect(lock.plugins['@qualy/plugin-ui-registry']!.contributions).toBeUndefined()
    } finally {
      workspace.dispose()
    }
  })

  it('refuses a contribution no capability in the assembly can accept', async () => {
    // a plugin that owns tables in an assembly with no database plugin would
    // otherwise sit there never activating, since cordis gates it on inject
    const workspace = createWorkspace(['@qualy/plugin-ui-registry', '@qualy/plugin-org'])
    try {
      await expect(resolve(workspace.manifestPath)).rejects.toThrow(
        /@qualy\/plugin-org contributes to capability database, which no plugin in this assembly provides/,
      )
    } finally {
      workspace.dispose()
    }
  })

  it('resolves an assembly that needs no capability at all', async () => {
    // this is what "the database plugin is optional" means: a selection whose
    // plugins own nothing never loads a provider and never mentions one
    const workspace = createWorkspace(['@qualy/plugin-web', '@qualy/plugin-layout-default'])
    try {
      const lock = lockFromResolution(await commit(workspace.manifestPath))
      expect(lock.capabilities).toEqual({})
      expect(Object.keys(lock.plugins)).toHaveLength(2)
    } finally {
      workspace.dispose()
    }
  })

  it('refuses a declaration written outside contributions', async () => {
    // ignoring it would leave the plugin contributing nothing, and the first
    // sign of that is whatever the capability generates once the plugin has
    // dropped out of its set
    const workspace = createWorkspace([...INFRA, '@fake/plugin-legacy'], {
      synthetic: [
        { id: '@fake/plugin-legacy', qualy: { database: { entitiesEntry: 'index.js' } } },
      ],
    })
    try {
      await expect(resolve(workspace.manifestPath)).rejects.toThrow(
        /@fake\/plugin-legacy declares qualy\.database, which belongs under qualy\.contributions\.database/,
      )
    } finally {
      workspace.dispose()
    }
  })

  it('ignores plugin metadata that names no capability', async () => {
    // qualy.ui and its kind are read by one plugin from another at runtime and
    // are none of the assembly's business; refusing every unknown key would
    // make the core the registry of what plugins may say to each other
    const workspace = createWorkspace([...INFRA, '@fake/plugin-meta'], {
      synthetic: [{ id: '@fake/plugin-meta', qualy: { presentation: { entry: 'index.js' } } }],
    })
    try {
      const resolution = await resolve(workspace.manifestPath)
      expect(resolution.plugins.get('@fake/plugin-meta')!.contributions).toEqual({})
    } finally {
      workspace.dispose()
    }
  })

  it('refuses two plugins claiming one capability', async () => {
    const provider = { capabilityProvider: { key: 'database', entry: './assembly' } }
    const workspace = createWorkspace(['@fake/plugin-a', '@fake/plugin-b'], {
      synthetic: [
        { id: '@fake/plugin-a', qualy: provider },
        { id: '@fake/plugin-b', qualy: provider },
      ],
    })
    try {
      await expect(resolve(workspace.manifestPath)).rejects.toThrow(
        /capability database is provided by both/,
      )
    } finally {
      workspace.dispose()
    }
  })
})

describe('removal', () => {
  it('keeps a removed plugin that a capability is still holding', async () => {
    const workspace = createWorkspace(WITH_TABLES)
    try {
      expect((await commit(workspace.manifestPath)).plugins.get('@qualy/plugin-auth')!.state).toBe(
        'active',
      )

      // auth leaves the manifest; what it owns does not leave the database
      workspace.writeManifest([...INFRA, '@qualy/plugin-org'])
      const after = await commit(workspace.manifestPath)
      const auth = after.plugins.get('@qualy/plugin-auth')!
      expect(auth.state).toBe('detached')
      expect(auth.retainedBy).toEqual(['database'])
      expect(after.runtimePlugins).not.toContain('@qualy/plugin-auth')

      // and putting it back is just the manifest again
      workspace.writeManifest(WITH_TABLES)
      expect((await commit(workspace.manifestPath)).plugins.get('@qualy/plugin-auth')!.state).toBe(
        'active',
      )
    } finally {
      workspace.dispose()
    }
  })

  it('lets a removed plugin nothing is holding go', async () => {
    // keeping one that left nothing would park a dead entry in the lock with no
    // way to ever take it out
    const workspace = createWorkspace([...INFRA, '@qualy/plugin-layout-default'])
    try {
      await commit(workspace.manifestPath)
      workspace.writeManifest(INFRA)
      const after = await commit(workspace.manifestPath)
      expect(after.plugins.has('@qualy/plugin-layout-default')).toBe(false)
    } finally {
      workspace.dispose()
    }
  })

  it('refuses when the capability that was holding a plugin has left too', async () => {
    // nobody is left who could answer whether the plugin still matters, and
    // defaulting to no would forget every table-owning plugin at once
    const workspace = createWorkspace(WITH_TABLES)
    try {
      await commit(workspace.manifestPath)
      workspace.writeManifest(['@qualy/plugin-ui-registry', '@qualy/plugin-web'])
      fs.rmSync(path.join(workspace.dir, 'node_modules/@qualy/plugin-database'), {
        recursive: true,
      })
      await expect(resolve(workspace.manifestPath)).rejects.toThrow(
        /contributed to capability database, which nothing in this assembly provides/,
      )
    } finally {
      workspace.dispose()
    }
  })

  it('refuses to resolve when a retained plugin has been uninstalled', async () => {
    const workspace = createWorkspace(WITH_TABLES)
    try {
      await commit(workspace.manifestPath)
      workspace.writeManifest([...INFRA, '@qualy/plugin-org'])
      await commit(workspace.manifestPath)
      fs.rmSync(path.join(workspace.dir, 'node_modules/@qualy/plugin-auth'), { recursive: true })
      await expect(resolve(workspace.manifestPath)).rejects.toThrow(
        /@qualy\/plugin-auth[\s\S]*Reinstall them/,
      )
    } finally {
      workspace.dispose()
    }
  })

  it('does not confuse switching a plugin off with taking it out', async () => {
    const workspace = createWorkspace(WITH_TABLES, { disabled: ['@qualy/plugin-auth'] })
    try {
      const resolution = await commit(workspace.manifestPath)
      expect(resolution.plugins.get('@qualy/plugin-auth')!.state).toBe('disabled')
      expect(resolution.plugins.get('@qualy/plugin-auth')!.retainedBy).toBeUndefined()
      expect(resolution.runtimePlugins).not.toContain('@qualy/plugin-auth')
    } finally {
      workspace.dispose()
    }
  })
})

describe('frozen lockfile', () => {
  it('accepts a lock that matches', async () => {
    const workspace = createWorkspace(WITH_TABLES)
    try {
      await commit(workspace.manifestPath)
      const lock = readLock(lockPathFor(workspace.manifestPath))
      expect(lockDrift(lock, await resolve(workspace.manifestPath))).toEqual([])
    } finally {
      workspace.dispose()
    }
  })

  it('rejects an edited manifest', async () => {
    const workspace = createWorkspace(WITH_TABLES)
    try {
      await commit(workspace.manifestPath)
      const lock = readLock(lockPathFor(workspace.manifestPath))
      workspace.writeManifest(WITH_TABLES, { disabled: ['@qualy/plugin-auth'] })
      expect(lockDrift(lock, await resolve(workspace.manifestPath))).toEqual([
        expect.stringContaining('changed since the lock was written'),
        expect.stringContaining('does not match'),
      ])
    } finally {
      workspace.dispose()
    }
  })

  it('refuses to read an edited lock at all', async () => {
    // resolve decides what is still being kept from this file and then writes
    // its own hash over the answer, so reporting the edit as drift would
    // launder it into the record within one command. The capability section is
    // covered too: the core cannot read it, so nothing but the hash defends it.
    const workspace = createWorkspace(WITH_TABLES)
    try {
      await commit(workspace.manifestPath)
      const lockPath = lockPathFor(workspace.manifestPath)
      const intact = renderLock(readLock(lockPath)!)

      const table = readLock(lockPath)!
      table.plugins['@qualy/plugin-org']!.state = 'disabled'
      fs.writeFileSync(lockPath, renderLock(table))
      expect(() => readLock(lockPath)).toThrow(/has been edited/)

      fs.writeFileSync(lockPath, intact)
      const state = readLock(lockPath)!
      state.capabilities.database!.state = { order: [] }
      fs.writeFileSync(lockPath, renderLock(state))
      expect(() => readLock(lockPath)).toThrow(/has been edited/)
    } finally {
      workspace.dispose()
    }
  })

  it('keeps the provider while its capability is still holding something', async () => {
    // the provider plugin owns no contribution of its own, so without this it
    // leaves the lock on the resolve after its removal and the resolve after
    // that has nobody left to ask
    const workspace = createWorkspace(WITH_TABLES)
    try {
      await commit(workspace.manifestPath)
      workspace.writeManifest(['@qualy/plugin-ui-registry', '@qualy/plugin-web'])
      const first = await commit(workspace.manifestPath)
      expect(first.plugins.get('@qualy/plugin-database')!.state).toBe('detached')
      expect(first.plugins.get('@qualy/plugin-database')!.retainedBy).toEqual(['database'])

      // and the same tree resolves the same way a second time
      const second = await commit(workspace.manifestPath)
      expect(second.plugins.get('@qualy/plugin-auth')!.state).toBe('detached')
      expect(second.plugins.get('@qualy/plugin-database')!.state).toBe('detached')
    } finally {
      workspace.dispose()
    }
  })

  it('reports a missing lock rather than inventing one', async () => {
    const workspace = createWorkspace(WITH_TABLES)
    try {
      expect(lockDrift(undefined, await resolve(workspace.manifestPath))).toEqual([
        expect.stringContaining('no lock file'),
      ])
    } finally {
      workspace.dispose()
    }
  })

  it('treats a superseded lock as absent, unless it is the only record of what is kept', async () => {
    const workspace = createWorkspace(WITH_TABLES)
    try {
      await commit(workspace.manifestPath)
      const lockPath = lockPathFor(workspace.manifestPath)
      const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as {
        plugins: Record<string, { state: string }>
      }
      fs.writeFileSync(lockPath, JSON.stringify({ ...lock, lockfileVersion: 1 }))
      expect(readLock(lockPath)).toBeUndefined()

      lock.plugins['@qualy/plugin-auth']!.state = 'detached'
      fs.writeFileSync(lockPath, JSON.stringify({ ...lock, lockfileVersion: 1 }))
      expect(() => readLock(lockPath)).toThrow(
        /only record that these plugins are still being kept/,
      )
    } finally {
      workspace.dispose()
    }
  })

  it('refuses a lock written by a newer format', async () => {
    const workspace = createWorkspace(WITH_TABLES)
    try {
      await commit(workspace.manifestPath)
      const lockPath = lockPathFor(workspace.manifestPath)
      const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as Record<string, unknown>
      fs.writeFileSync(lockPath, JSON.stringify({ ...lock, lockfileVersion: 99 }))
      expect(() => readLock(lockPath)).toThrow(/newer version of qualy/)
    } finally {
      workspace.dispose()
    }
  })
})

describe('runtime plan', () => {
  it('plans a layer for every plugin that ships one', async () => {
    // the plan is what the boot-time assembler walks, so a plugin missing
    // from it is a plugin the manifest selected and the process never runs
    const workspace = createWorkspace(INFRA)
    try {
      const resolution = await resolve(workspace.manifestPath)
      const specifiers = runtimeLayers(resolution).map((layer) => layer.specifier)
      expect(specifiers.length).toBe(INFRA.length)
      // deterministic: two resolutions of one manifest plan the same walk
      expect(runtimeLayers(await resolve(workspace.manifestPath)).map((l) => l.specifier)).toEqual(
        specifiers,
      )
    } finally {
      workspace.dispose()
    }
  })

  it('leaves out what is not running', async () => {
    // switched off with nothing depending on it: the plan is the running
    // assembly, and a disabled plugin's layer would still be composed
    const workspace = createWorkspace([...INFRA, '@qualy/plugin-ping'], {
      disabled: ['@qualy/plugin-ping'],
    })
    try {
      expect(
        runtimeLayers(await resolve(workspace.manifestPath)).map((layer) => layer.id),
      ).not.toContain('@qualy/plugin-ping')
    } finally {
      workspace.dispose()
    }
  })
})

describe('the modules capabilities derive', () => {
  // Written and compared by a core that never reads them. Asserted with a
  // capability this repository does not have, because a case that used the
  // database one would pass just as well if the core had been taught what a
  // table is.
  const provider = (key: string, body: string): SyntheticPackage => ({
    id: `@fake/plugin-${key}`,
    qualy: { capabilityProvider: { key, entry: './provider' } },
    exports: { './provider': './provider.js' },
    files: {
      'provider.js': [
        'export default {',
        `  key: '${key}',`,
        '  parseContribution: () => ({}),',
        '  resolve: () => ({}),',
        `  modules: () => (${body}),`,
        '}',
      ].join('\n'),
    },
  })

  const modulesOf = async (synthetic: readonly SyntheticPackage[], options = {}) => {
    const workspace = createWorkspace(
      synthetic.map((entry) => entry.id),
      { ...options, synthetic },
    )
    try {
      return capabilityModules(await resolve(workspace.manifestPath))
    } finally {
      workspace.dispose()
    }
  }

  it('collects them without knowing what any of them says', async () => {
    const modules = await modulesOf([
      provider('widgets', "[{ path: 'widgets.gen.ts', content: 'export const widgets = []\\n' }]"),
    ])
    expect(modules).toEqual([{ path: 'widgets.gen.ts', content: 'export const widgets = []\n' }])
  })

  it('refuses two capabilities generating one file', async () => {
    // silent otherwise: both write, the second wins, and the frozen gate then
    // compares the survivor against whichever ran last
    const same = "[{ path: 'shared.gen.ts', content: 'x' }]"
    await expect(modulesOf([provider('a', same), provider('b', same)])).rejects.toThrow(
      /capabilities a and b both generate shared.gen.ts/,
    )
  })

  it('refuses one that reaches outside the workspace', async () => {
    // the core writes these paths, so a capability naming `..` is naming a
    // file anywhere on the disk
    await expect(
      modulesOf([provider('escape', "[{ path: '../outside.gen.ts', content: 'x' }]")]),
    ).rejects.toThrow(/capability escape generates outside the workspace/)
    await expect(
      modulesOf([provider('absolute', "[{ path: '/etc/outside.gen.ts', content: 'x' }]")]),
    ).rejects.toThrow(/capability absolute generates an absolute path/)
  })
})

describe('the manifest this repository ships', () => {
  it('has a lock that matches it', async () => {
    // the committed lock is what a deployment runs with; a stale one turns
    // every frozen start into a puzzle
    const file = path.resolve('qualy.yml')
    expect(lockDrift(readLock(lockPathFor(file)), await resolve(file))).toEqual([])
  })
})
