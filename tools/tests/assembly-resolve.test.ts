import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  capabilityModules,
  lockDrift,
  lockFromResolution,
  lockPathFor,
  manifestHash,
  parseManifest,
  productRootFor,
  renderManifest,
  readLock,
  renderLock,
  runtimeLayers,
  resolveAssembly,
  writeLock,
} from '@qualy/assembly'
import { resolvePackageDir } from '@qualy/assembly/host'
import { createWorkspace, renderManifestText, type SyntheticPackage } from '@qualy/assembly/testkit'
import { manifestPath } from '../lib/manifest.ts'

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

describe('clean room', () => {
  // A throwaway workspace must see exactly what it installed and nothing else.
  // That is not automatic: `require` also consults NODE_PATH, and pnpm's bin
  // shim points it at the directory every workspace package is hoisted into,
  // so under vitest a synthetic workspace could resolve any package in this
  // repository. Two cases below spent a while reaching their real assertion
  // through a plugin they never linked, and nothing said so - the resolution
  // that made it work belonged to the test runner, not to the assembly.
  const ELSEWHERE = '@qualy/plugin-web'

  it('cannot see a package the real host has but it never installed', () => {
    // asserted first, so a failure below is about the workspace rather than
    // about the package having moved
    expect(resolvePackageDir(ELSEWHERE, manifestPath())).toContain('plugins/infra/web')

    const workspace = createWorkspace(INFRA)
    try {
      expect(() => resolvePackageDir(ELSEWHERE, workspace.manifestPath)).toThrow(
        /cannot be resolved/,
      )
    } finally {
      workspace.dispose()
    }
  })

  it('installs what a later manifest selects, and keeps what one drops', () => {
    const workspace = createWorkspace(INFRA)
    try {
      workspace.writeManifest([...INFRA, ELSEWHERE])
      expect(resolvePackageDir(ELSEWHERE, workspace.manifestPath)).toContain('plugins/infra/web')

      // dropping it from the manifest leaves the package installed: detached
      // and retained are states of a plugin that left the manifest and stayed
      // on disk, and a workspace that uninstalled on removal could not pose
      // the question at all
      workspace.writeManifest(INFRA)
      expect(resolvePackageDir(ELSEWHERE, workspace.manifestPath)).toContain('plugins/infra/web')
    } finally {
      workspace.dispose()
    }
  })
})

describe('manifest', () => {
  const parse = (text: string) => () => parseManifest(text, 'qualy.yml')
  /** a v3 body, so a case about one rule is not also a case about the header */
  const v3 = (body: string) => `version: 3\n${body}`

  it('refuses the entry-array form it replaced', () => {
    // the old file is valid yaml, so without this it would parse as a manifest
    // with no plugins at all and quietly resolve to nothing
    expect(parse("- name: '@qualy/plugin-org'\n")).toThrow(/old entry-array format/)
  })

  it('refuses one plugin declared twice', () => {
    // yaml's own answer is last-one-wins, which leaves no single answer for the
    // plugin's config
    expect(parse(v3("plugins:\n  '@a': {}\n  '@a': {}\n"))).toThrow()
  })

  it('refuses keys it does not understand', () => {
    expect(parse(v3('plugins: {}\nsetup: {}\n'))).toThrow(/unknown top-level key setup/)
    expect(parse(v3("plugins:\n  '@a':\n    enable: true\n"))).toThrow(/unknown key enable/)
    expect(parse(v3('application:\n  root: .\nplugins: {}\n'))).toThrow(
      /application: unknown key root/,
    )
    expect(parse('version: 4\nplugins: {}\n')).toThrow(/version must be 3/)
  })

  it('tells a version 2 manifest what changed, in one sentence', () => {
    // v2 carried application.workspace, the package its plugins resolved from.
    // A file still saying so would otherwise fail on the version, then - once
    // that was edited - on an unknown key: two errors for one change, neither
    // naming the rule that replaced the field
    for (const text of [
      'version: 2\napplication:\n  workspace: ./apps/server\nplugins: {}\n',
      'version: 2\nplugins: {}\n',
      'version: 3\napplication:\n  workspace: .\nplugins: {}\n',
    ]) {
      expect(parse(text)).toThrow(/version 2 used application\.workspace/)
      expect(parse(text)).toThrow(/package containing qualy\.yml/)
    }
  })

  it('reads a version 3 manifest, with or without an application block', () => {
    expect(parseManifest(v3('plugins: {}\n'), 'qualy.yml').version).toBe(3)
    expect(parseManifest(v3('application: {}\nplugins: {}\n'), 'qualy.yml').version).toBe(3)
  })

  it('reads a plugin with nothing after the colon as selected', () => {
    const manifest = parseManifest(v3("plugins:\n  '@a':\n  '@b': {}\n"), 'qualy.yml')
    expect([...manifest.plugins.keys()]).toEqual(['@a', '@b'])
    expect(manifest.plugins.get('@a')!.enabled).toBe(true)
  })

  it('hashes what it selects and nothing about how the file is written', () => {
    // a reordered, re-quoted or re-commented file is the same selection; a
    // plugin toggled or reconfigured is not
    const hashOf = (text: string) => manifestHash(parseManifest(text, 'qualy.yml'))
    expect(hashOf(v3("plugins:\n  '@a': {}\n  '@b': {}\n"))).toBe(
      hashOf(v3('# selected\nplugins:\n  "@b": {}\n  "@a":\n')),
    )
    expect(hashOf(v3("plugins:\n  '@a': {}\n"))).not.toBe(
      hashOf(v3("plugins:\n  '@a':\n    enabled: false\n")),
    )
    expect(hashOf(v3("plugins:\n  '@a': {}\n"))).not.toBe(
      hashOf(v3("plugins:\n  '@a':\n    config: { x: 1 }\n")),
    )
  })

  it('carries application.logging without hashing it', () => {
    // one file, two views: logging is how the process behaves, not what the
    // assembly is - turning a level up must never read as drift
    const quiet = parseManifest(
      v3('application:\n  logging:\n    level: warn\nplugins: {}\n'),
      'qualy.yml',
    )
    const loud = parseManifest(v3('plugins: {}\n'), 'qualy.yml')
    expect(quiet.logging).toEqual({ level: 'warn' })
    expect(manifestHash(quiet)).toBe(manifestHash(loud))
    // and the renderer keeps it, or a rewrite would silently reset the levels
    expect(parseManifest(renderManifest(quiet), 'again').logging).toEqual({ level: 'warn' })
  })

  it('survives a round trip through the renderer', () => {
    const original = parseManifest(
      v3("plugins:\n  '@a': {}\n  '@b':\n    enabled: false\n"),
      'qualy.yml',
    )
    const rendered = renderManifest(original)
    // nothing about where packages live is written back: the file describes
    // a selection, and the directory it sits in answers the rest
    expect(rendered).not.toContain('application')
    const again = parseManifest(rendered, 'qualy.yml')
    expect(again.version).toBe(3)
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

  it('refuses a descriptor that calls itself something else', async () => {
    // everything downstream is keyed by the package id while errors speak the
    // descriptor's; a mismatch would let the two vocabularies drift mid-sentence
    const liar: SyntheticPackage = {
      id: '@fake/plugin-liar',
      files: {
        'index.js':
          "export default { _tag: 'Plugin', id: '@fake/plugin-somebody-else', dependsOn: [], features: [] }\n",
      },
    }
    const workspace = createWorkspace(['@fake/plugin-liar'], { synthetic: [liar] })
    try {
      await expect(resolve(workspace.manifestPath)).rejects.toThrow(
        /@fake\/plugin-liar default-exports a descriptor that calls itself @fake\/plugin-somebody-else/,
      )
    } finally {
      workspace.dispose()
    }
  })

  it('refuses two plugins claiming one capability', async () => {
    // the load thunks never run: the conflict is settled from the declarations
    const claiming = (id: string): SyntheticPackage => ({
      id,
      files: {
        'index.js': `export default { _tag: 'Plugin', id: '${id}', dependsOn: [], features: [{ _tag: 'Capability', key: 'database', load: () => import('./provider.js') }] }\n`,
      },
    })
    const workspace = createWorkspace(['@fake/plugin-a', '@fake/plugin-b'], {
      synthetic: [claiming('@fake/plugin-a'), claiming('@fake/plugin-b')],
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
    files: {
      'index.js': `export default { _tag: 'Plugin', id: '@fake/plugin-${key}', dependsOn: [], features: [{ _tag: 'Capability', key: '${key}', load: () => import('./provider.js') }] }\n`,
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

  it('refuses one that reaches outside the product root', async () => {
    // the core writes these paths, so a capability naming `..` is naming a
    // file anywhere on the disk
    await expect(
      modulesOf([provider('escape', "[{ path: '../outside.gen.ts', content: 'x' }]")]),
    ).rejects.toThrow(/capability escape generates outside the product root/)
    await expect(
      modulesOf([provider('absolute', "[{ path: '/etc/outside.gen.ts', content: 'x' }]")]),
    ).rejects.toThrow(/capability absolute generates an absolute path/)
  })
})

describe('descriptor-sourced contributions', () => {
  // A capability that implements contributionFromDescriptor reads the plugin
  // module, and the package.json spelling of the same key stops being a second
  // source. Asserted with a capability this repository does not have, same as
  // above: the core pipes values it cannot read.
  const provider: SyntheticPackage = {
    id: '@fake/plugin-caps',
    files: {
      'index.js':
        "export default { _tag: 'Plugin', id: '@fake/plugin-caps', dependsOn: [], features: [{ _tag: 'Capability', key: 'caps', load: () => import('./provider.js') }] }\n",
      'provider.js': [
        'export default {',
        "  key: 'caps',",
        "  parseContribution: () => { throw new Error('unreachable: the core refuses first') },",
        '  contributionFromDescriptor: ({ descriptor }) => {',
        "    const declared = descriptor.features.filter((f) => f._tag === 'Contribute' && f.point.id === 'caps-point')",
        '    return declared.length > 0 ? { values: declared.map((f) => f.value) } : undefined',
        '  },',
        '  resolve: (context) => ({ order: [...context.contributions.keys()].sort() }),',
        '}',
      ].join('\n'),
    },
  }

  it('reads them from the plugin module, and records them in the lock', async () => {
    const declaring: SyntheticPackage = {
      id: '@fake/plugin-declaring',
      files: {
        'index.js': [
          'export default {',
          "  _tag: 'Plugin', id: '@fake/plugin-declaring', dependsOn: [],",
          "  features: [{ _tag: 'Contribute', point: { id: 'caps-point' }, value: 'widget' }],",
          '}',
        ].join('\n'),
      },
    }
    const workspace = createWorkspace([provider.id, declaring.id], {
      synthetic: [provider, declaring],
    })
    try {
      const resolution = await resolve(workspace.manifestPath)
      expect(resolution.plugins.get('@fake/plugin-declaring')!.contributions).toEqual({
        caps: { values: ['widget'] },
      })
      // silent features contribute nothing, rather than an empty entry
      expect(resolution.plugins.get('@fake/plugin-caps')!.contributions).toEqual({})
      expect(resolution.capabilities.get('caps')!.state).toEqual({
        order: ['@fake/plugin-declaring'],
      })
    } finally {
      workspace.dispose()
    }
  })

  it('refuses the package.json declaration the hook replaced', async () => {
    // one source, not a fallback chain: a stale package.json declaration would
    // either shadow the descriptor or silently lose to it
    const stale: SyntheticPackage = {
      id: '@fake/plugin-stale',
      qualy: { contributions: { caps: { entry: 'index.js' } } },
    }
    const workspace = createWorkspace([provider.id, stale.id], { synthetic: [provider, stale] })
    try {
      await expect(resolve(workspace.manifestPath)).rejects.toThrow(
        /@fake\/plugin-stale declares qualy\.contributions\.caps in package\.json, but capability caps reads contributions from the plugin descriptor now/,
      )
    } finally {
      workspace.dispose()
    }
  })
})

describe('the manifest this repository ships', () => {
  it('has a lock that matches it', async () => {
    // the committed lock is what a deployment runs with; a stale one turns
    // every frozen start into a puzzle
    const file = path.resolve('qualy.yml')
    expect(lockDrift(readLock(lockPathFor(file)), await resolve(file))).toEqual([])
  })

  it('sits inside the package that installs its plugins', () => {
    // the product root is the manifest's directory by rule, and a manifest
    // outside any package has nothing to resolve its plugins from
    expect(productRootFor(manifestPath())).toBe(path.dirname(manifestPath()))
    const orphan = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-orphan-')), 'qualy.yml')
    try {
      fs.writeFileSync(orphan, 'version: 3\nplugins: {}\n')
      expect(() => productRootFor(orphan)).toThrow(/no package\.json at/)
    } finally {
      fs.rmSync(path.dirname(orphan), { recursive: true, force: true })
    }
  })
})
