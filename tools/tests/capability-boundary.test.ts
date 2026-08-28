import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
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
import {
  capabilityWorkContext,
  commitLock,
  createWorkspace,
  resolveWorkspace,
} from '@qualy/assembly/testkit'

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
  files: {
    'index.js':
      "export default { _tag: 'Plugin', id: '@fake/plugin-cache', dependsOn: [], features: [{ _tag: 'Capability', key: 'cache', load: () => import('./assembly.js') }] }\n",
    'assembly.js': provider('cache'),
  },
}

/**
 * A provider with nothing but resolve, and optionally the one other door a
 * manifest block can arrive through: a descriptor command that asked for the
 * capability tier, which the cli host builds a work context for.
 */
const ledgerPlugin = ({ command = false }: { command?: boolean } = {}) => {
  const cli =
    ", { _tag: 'Contribute', point: { id: '@qualy/plugin-kit/cli', phase: 'external' }," +
    " value: { namespace: 'ledger', name: 'show', summary: 'show the ledger'," +
    " context: 'capability', load: () => import('./show.js') } }"
  return {
    id: '@fake/plugin-ledger',
    files: {
      'index.js':
        "export default { _tag: 'Plugin', id: '@fake/plugin-ledger', dependsOn: [], features: [" +
        "{ _tag: 'Capability', key: 'ledger', load: () => import('./assembly.js') }" +
        `${command ? cli : ''}] }\n`,
      'assembly.js':
        "export default { key: 'ledger', parseContribution: () => ({}), resolve: () => ({}) }\n",
      'show.js': 'export const run = async () => {}\n',
    },
  }
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

  // The module contract has two callers and both must exist: the frozen gate
  // compares these files, and `qualy resolve` writes them. With only the gate,
  // the first capability to declare a module bricked every gated command with
  // a drift error whose prescribed fix - run resolve - changed nothing.
  it('resolve writes the modules the frozen gate will demand', async () => {
    const workspace = createWorkspace(['@fake/plugin-cache', '@fake/plugin-sessions'], {
      synthetic: [cachePlugin, cacheUser('@fake/plugin-sessions', 'sessions')],
    })
    try {
      const cli = path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../apps/cli/src/main.ts',
      )
      const ran = spawnSync(process.execPath, [cli, 'resolve', '--yml', workspace.manifestPath], {
        encoding: 'utf8',
      })
      expect(ran.status, ran.stderr).toBe(0)
      const generated = path.join(workspace.dir, 'cache.gen.ts')
      expect(fs.readFileSync(generated, 'utf8')).toBe('export const channels = ["sessions"]\n')

      // and the gate the write exists for is satisfied by the written tree
      const frozen = spawnSync(
        process.execPath,
        ['--import', 'tsx', cli, 'resolve', '--frozen-lockfile', '--yml', workspace.manifestPath],
        { encoding: 'utf8' },
      )
      expect(frozen.status, frozen.stderr).toBe(0)
    } finally {
      workspace.dispose()
    }
  })

  // The recalled candidates let a removed provider ANSWER the retention
  // question; they must not let it stay. A provider that answered "nothing to
  // keep" once re-recorded its capability on every resolve, so generate and
  // deploy kept running the removed plugin's work - reaching the external
  // systems it manages - for an assembly that no longer contained it.
  it('releases a capability whose provider left retaining nothing', async () => {
    const workspace = createWorkspace([...INFRA, '@fake/plugin-cache', '@fake/plugin-sessions'], {
      synthetic: [cachePlugin, cacheUser('@fake/plugin-sessions', 'sessions')],
    })
    try {
      await commitLock(workspace)
      expect(readLock(lockPathFor(workspace.manifestPath))!.capabilities).toHaveProperty('cache')

      // the contributor leaves with the provider: a contributor left behind
      // is the orphaned-contribution refusal, not this case
      workspace.writeManifest([...INFRA])
      await commitLock(workspace)
      const lock = readLock(lockPathFor(workspace.manifestPath))!
      expect(lock.capabilities).not.toHaveProperty('cache')
      expect(lock.plugins).not.toHaveProperty('@fake/plugin-cache')

      // and the release is stable: the resolve after it finds no ghost either
      const resolution = await resolveWorkspace(workspace)
      expect([...resolution.providers.keys()]).toEqual(['database'])
      expect(capabilityWork(resolution).map((entry) => entry.key)).toEqual(['database'])
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
    takesConfig: true,
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
          specifier: '@fake/plugin-tuned',
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
      synthetic: [{ id: '@fake/plugin-plain' }],
      configs: { '@fake/plugin-plain': { volume: 11 } },
    })
    try {
      await expect(resolveWorkspace(workspace)).rejects.toThrow(
        /takes configuration in its descriptor/,
      )
    } finally {
      workspace.dispose()
    }
  })

  // Owning a capability used to be the exemption on its own, on the assumption
  // that every provider is handed its block as providerConfig sooner or later.
  // A provider that only resolves never is - no work context is built for it -
  // so its block was accepted, hashed and read by nobody, which is the exact
  // failure the refusal above exists to prevent.
  it('refuses a block for a capability provider no phase hands it to', async () => {
    const workspace = createWorkspace(['@fake/plugin-ledger'], {
      synthetic: [ledgerPlugin()],
      configs: { '@fake/plugin-ledger': { retention: 'forever' } },
    })
    try {
      await expect(resolveWorkspace(workspace)).rejects.toThrow(
        /@fake\/plugin-ledger is given config in .*the capability it provides only resolves/s,
      )
    } finally {
      workspace.dispose()
    }
  })

  it('keeps the block for a provider that has somewhere to receive it', async () => {
    // two doors, and both are real: the phases the core runs, and a declared
    // command that asked for the capability tier
    const byPhase = createWorkspace([...INFRA, '@fake/plugin-cache'], {
      synthetic: [cachePlugin],
      configs: { '@fake/plugin-cache': { size: 3 } },
    })
    const byCommand = createWorkspace(['@fake/plugin-ledger'], {
      synthetic: [ledgerPlugin({ command: true })],
      configs: { '@fake/plugin-ledger': { retention: 'forever' } },
    })
    try {
      expect((await capabilityWorkContext(byPhase, 'cache')).providerConfig).toEqual({ size: 3 })
      expect((await capabilityWorkContext(byCommand, 'ledger')).providerConfig).toEqual({
        retention: 'forever',
      })
    } finally {
      byPhase.dispose()
      byCommand.dispose()
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

// What a capability costs to LOAD.
//
// The provider module is imported wherever a contribution has to be parsed,
// and that is not only the CLI: boot resolves the assembly to check it against
// the lock. The heavy machinery - the migrator, the schema comparator, pg,
// child_process - belongs to phases that only the CLI runs, so it must be
// reached by dynamic import inside those phases. Statically imported, every
// production start pays for a generation toolchain it will never run, and a
// broken import in generation-only code becomes a boot failure.
describe('what importing a capability provider costs', () => {
  const staticImportsOf = (file: string): string[] => {
    const source = fs.readFileSync(file, 'utf8')
    // Static forms that survive to runtime. `await import(...)` inside a
    // phase is the point of the exercise, and `import type` is erased.
    const specifiers: string[] = []
    for (const match of source.matchAll(
      /^\s*(import|export)(\s+type)?([^;\n]*?)from\s*'([^']+)'/gm,
    )) {
      if (match[2] || /^\s*\{\s*type\s/.test(match[3]!)) continue
      specifiers.push(match[4]!)
    }
    for (const match of source.matchAll(/^\s*import\s*'([^']+)'/gm)) specifiers.push(match[1]!)
    return specifiers
  }

  it('the database provider reaches no orm, driver or subprocess until a phase runs', () => {
    const entry = fileURLToPath(
      new URL('../../packages/plugins/infra/database/src/assembly/index.ts', import.meta.url),
    )
    const seen = new Set<string>()
    const heavy: string[] = []
    const walk = (file: string) => {
      if (seen.has(file)) return
      seen.add(file)
      for (const specifier of staticImportsOf(file)) {
        if (specifier.startsWith('.')) {
          walk(path.resolve(path.dirname(file), specifier))
          continue
        }
        if (/^(@mikro-orm\/|pg$|node:child_process$)/.test(specifier)) {
          heavy.push(`${path.relative(process.cwd(), file)} imports ${specifier}`)
        }
      }
    }
    walk(entry)
    expect(heavy).toEqual([])
    // and the walk actually walked: a broken resolver would pass vacuously
    expect(seen.size).toBeGreaterThan(3)
  })
})
