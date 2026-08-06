import { describe, expect, it } from 'vitest'
import { capabilityModules, capabilityWork, readLock, lockPathFor } from '@qualy/assembly'
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
      ).toEqual(['cache.gen.ts', 'entities.gen.ts'])
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
