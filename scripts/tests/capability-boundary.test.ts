import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  capabilityModules,
  capabilityWork,
  lockPathFor,
  readLock,
  runtimeLayers,
} from '@qualy/assembly'
import { commitLock, createWorkspace, resolveWorkspace } from '@qualy/assembly/testkit'

// Is the assembly core actually free of the database?
//
// The claim the whole design rests on is that database is one optional
// capability among others: the core knows manifests, plugin states, opaque
// contributions and a provider registry, and nothing about tables. Two things
// have to be true for that to mean anything, and neither was covered.
//
// One: an assembly with no database plugin has to resolve, plan, generate and
// produce its modules without a provider ever loading. That was checked by
// hand once, before the runtime moved to Effect and before generation started
// building databases; a claim nobody re-checks is a claim that decays.
//
// Two: a second capability has to be able to exist. Everything so far has had
// exactly one provider, so "the registry holds providers" and "the registry
// holds the database provider" have been indistinguishable.

const INFRA = ['@qualy/plugin-database', '@qualy/plugin-ui-registry']

/** a capability provider written for this test, in the shape a real one has */
const provider = (key: string) => `
export default {
  key: ${JSON.stringify(key)},
  parseContribution: (input) => {
    if (typeof input.raw?.channel !== 'string') {
      throw new Error(input.pluginId + ': qualy.contributions.${key}.channel must be a string')
    }
    return { channel: input.raw.channel }
  },
  resolve: (context) => ({
    channels: [...context.contributions.values()].map((c) => c.channel).sort(),
  }),
  retainsPlugin: () => false,
  plan: ({ nextState }) => nextState.channels.map((channel) => '+ ' + channel),
  modules: (context) => [
    {
      path: '${key}.gen.ts',
      content: 'export const channels = ' + JSON.stringify(context.state?.channels ?? []) + '\\n',
    },
  ],
  generate: async (context) => {
    globalThis.__qualyCapabilityLog ??= []
    globalThis.__qualyCapabilityLog.push('${key}:generate')
  },
  commands: {
    ping: async (context) => {
      globalThis.__qualyCapabilityLog ??= []
      globalThis.__qualyCapabilityLog.push('${key}:ping:' + context.args.join(','))
    },
  },
}
`

const cachePlugin = {
  id: '@fake/plugin-cache',
  qualy: { capabilityProvider: { key: 'cache', entry: './assembly' } },
  files: { 'assembly.js': provider('cache') },
  exports: { './assembly': './assembly.js' },
}

const cacheUser = (id: string, channel: string) => ({
  id,
  qualy: { contributions: { cache: { channel } } },
})

const log = (): string[] => {
  const global = globalThis as { __qualyCapabilityLog?: string[] }
  return global.__qualyCapabilityLog ?? []
}
const clearLog = () => {
  ;(globalThis as { __qualyCapabilityLog?: string[] }).__qualyCapabilityLog = []
}

describe('an assembly with no database in it', () => {
  it('resolves, plans and generates its modules without loading a provider', async () => {
    const workspace = createWorkspace(['@qualy/plugin-web', '@qualy/plugin-layout-default'])
    try {
      const resolution = await resolveWorkspace(workspace)
      expect([...resolution.providers.keys()]).toEqual([])
      // no capability means no work, not work that quietly does nothing: a
      // generate that reported success here would be reporting on nobody
      expect(capabilityWork(resolution)).toEqual([])
      // and nothing derived mentions a table, an entity or a lineage
      expect(capabilityModules(resolution)).toEqual([])

      await commitLock(workspace)
      const lock = readLock(lockPathFor(workspace.manifestPath))!
      expect(lock.capabilities).toEqual({})
      expect(JSON.stringify(lock)).not.toMatch(/database|entities|migration/i)
    } finally {
      workspace.dispose()
    }
  })
})

describe('a second capability, beside the database', () => {
  it('resolves its own section of the lock and generates its own module', async () => {
    const workspace = createWorkspace([...INFRA, '@fake/plugin-cache', '@fake/plugin-sessions'], {
      synthetic: [cachePlugin, cacheUser('@fake/plugin-sessions', 'sessions')],
    })
    try {
      const resolution = await resolveWorkspace(workspace)
      expect([...resolution.providers.keys()].sort()).toEqual(['cache', 'database'])
      expect(resolution.capabilities.get('cache')?.state).toEqual({ channels: ['sessions'] })
      // each capability owns its own section, and neither can see the other's
      expect(resolution.capabilities.get('database')?.state).not.toHaveProperty('channels')
      expect(
        capabilityModules(resolution)
          .map((module) => module.path)
          .sort(),
        // the database capability generates no module any more - the running
        // set is the descriptor assembler's; the mechanism itself stays, and
        // the synthetic capability proves it
      ).toEqual(['cache.gen.ts'])
    } finally {
      workspace.dispose()
    }
  })

  it('runs every provider once per phase, and routes a command to its own', async () => {
    const workspace = createWorkspace(['@fake/plugin-cache', '@fake/plugin-sessions'], {
      synthetic: [cachePlugin, cacheUser('@fake/plugin-sessions', 'sessions')],
    })
    try {
      clearLog()
      const resolution = await resolveWorkspace(workspace)
      const work = capabilityWork(resolution)
      expect(work.map((entry) => entry.key)).toEqual(['cache'])

      for (const capability of work) await capability.run('generate')
      // a phase no provider implements is reported as not run rather than as
      // done, which is how the cli tells "nothing to deploy" from "deployed"
      expect(await work[0]!.run('deploy')).toBe(false)
      expect(await work[0]!.command('ping', ['once'])).toBe(true)
      expect(await work[0]!.command('nope', [])).toBe(false)

      expect(log()).toEqual(['cache:generate', 'cache:ping:once'])
    } finally {
      workspace.dispose()
    }
  })

  it('refuses a contribution to a capability this assembly does not have', async () => {
    // the plugin declares a channel but nothing provides `cache`, so it would
    // contribute nothing and its inject gate would leave it silently inert
    const workspace = createWorkspace([...INFRA, '@fake/plugin-sessions'], {
      synthetic: [cacheUser('@fake/plugin-sessions', 'sessions')],
    })
    try {
      await expect(resolveWorkspace(workspace)).rejects.toThrow(/cache/)
    } finally {
      workspace.dispose()
    }
  })
})

// Configuration is the one thing that genuinely has to travel from the
// manifest into a plugin, and the generated module is the only carrier there
// is at runtime. What matters is that it goes to plugins that said they take
// it, and that a block nobody reads is refused rather than ignored.
describe('a plugin that takes configuration', () => {
  const configurable = {
    id: '@fake/plugin-tuned',
    qualy: { runtime: { entry: './server', config: true } },
    files: { 'server.js': 'export const layer = null\nexport const config = () => null\n' },
    exports: { './server': './server.js' },
  }

  it('is handed its own block, and only a configured plugin carries one', async () => {
    const workspace = createWorkspace(['@fake/plugin-tuned'], {
      synthetic: [configurable],
      configs: { '@fake/plugin-tuned': { volume: 11 } },
    })
    try {
      // what the boot-time assembler walks: the block travels on the plan,
      // and the plugin's own config export decides what it means
      const plan = runtimeLayers(await resolveWorkspace(workspace))
      expect(plan).toEqual([
        {
          id: '@fake/plugin-tuned',
          specifier: '@fake/plugin-tuned/server',
          dependsOn: [],
          config: { volume: 11 },
        },
      ])
    } finally {
      workspace.dispose()
    }
  })

  it('refuses a block for a plugin that reads none', async () => {
    // the failure this replaces is silent: the manifest hash changes, resolve
    // succeeds, a frozen start passes, and the setting reads as applied
    const workspace = createWorkspace(['@fake/plugin-plain'], {
      synthetic: [
        {
          id: '@fake/plugin-plain',
          qualy: { runtime: { entry: './server' } },
          files: { 'server.js': 'export const layer = null\n' },
          exports: { './server': './server.js' },
        },
      ],
      configs: { '@fake/plugin-plain': { volume: 11 } },
    })
    try {
      await expect(resolveWorkspace(workspace)).rejects.toThrow(/declares qualy\.runtime\.config/)
    } finally {
      workspace.dispose()
    }
  })
})

// The point of all of it, as one assertion.
//
// Every plugin-specific thing the host used to assemble - the entity set, the
// permission catalog, three plugins' configuration, a readiness probe, a
// driver catalog, a surface catalog - reached it by name, so an assembly
// without that plugin could not compile. They arrive by registry, by
// capability module or by the manifest now, and the composition root names
// none of them.
describe('the composition root', () => {
  const host = fileURLToPath(new URL('../../apps/server/src', import.meta.url))

  it('names no plugin', () => {
    const offenders = fs
      .readdirSync(host, { recursive: true })
      .filter((entry): entry is string => typeof entry === 'string' && entry.endsWith('.ts'))
      .flatMap((entry) => {
        const source = fs.readFileSync(path.join(host, entry), 'utf8')
        // the descriptor kernel is a library like api-kit, not a plugin; the
        // rule is about naming what an assembly may not contain
        const imports = [...source.matchAll(/from '(@qualy\/plugin-[^']+)'/g)]
          .map((match) => match[1]!)
          .filter((specifier) => !specifier.startsWith('@qualy/plugin-kit'))
        return imports.length > 0 ? [entry] : []
      })
    expect(offenders).toEqual([])
  })
})
