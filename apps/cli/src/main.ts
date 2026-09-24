import fs from 'node:fs'
import path from 'node:path'
import { isPluginDescriptor } from '@qualy/plugin-kit'
import { collectCliCommands } from '@qualy/plugin-kit/cli'
import { resolvePluginModuleUrl } from '@qualy/assembly/host'
import {
  capabilityContext,
  capabilityModules,
  capabilityWork,
  locateManifest,
  lockDrift,
  moduleDrift,
  lockFromResolution,
  lockPathFor,
  productRootFor,
  readLock,
  resolveAssembly,
  type AssemblyLock,
  type Resolution,
  runtimeLayers,
} from '@qualy/assembly'
import { PLUGIN_USAGE, runPluginCommand } from './plugin.ts'
import { openFileSet, writeResolution } from './resolution.ts'

// The assembly commands.
//
// The core owns when things happen and each capability owns what happens:
// resolve and plan never touch anything outside the repository, generate
// writes local artifacts a developer reviews and commits, deploy applies the
// committed ones. A capability with nothing to do in a phase has no handler
// for it, so an assembly with no database plugin runs every one of these and
// never mentions a database.

const USAGE = [
  'usage:',
  '  pnpm qualy resolve [--frozen-lockfile]',
  '  pnpm qualy plan',
  '  pnpm qualy generate [capability args]',
  '  pnpm qualy deploy',
  '  pnpm qualy list',
  PLUGIN_USAGE,
  '  pnpm qualy <namespace> <command> [args]',
  '',
  'the manifest is the nearest qualy.yml above the working directory;',
  '--yml <path> or QUALY_CONFIG name another one',
].join('\n')

/** the lifecycle's own verbs; a plugin namespace may not shadow one */
const RESERVED = ['resolve', 'plan', 'generate', 'deploy', 'list', 'plugin', 'help']

const argv = process.argv.slice(2)
const [command, ...rest] = argv
const flag = (name: string) => argv.includes(`--${name}`)
const option = (name: string) => {
  const at = argv.indexOf(`--${name}`)
  return at >= 0 ? argv[at + 1] : undefined
}

const die = (message: string): never => {
  console.error(message)
  process.exit(1)
}

// Which manifest this command is about: the one the working directory is in,
// unless told otherwise. The CLI is installed as a package like any other, so
// its own location says nothing about whose manifest to read.
const manifestPath = ((): string => {
  try {
    return locateManifest({ explicit: option('yml'), env: process.env, from: process.cwd() })
  } catch (error) {
    return die(error instanceof Error ? error.message : String(error))
  }
})()
const productRoot = ((): string => {
  try {
    return productRootFor(manifestPath)
  } catch (error) {
    return die(error instanceof Error ? error.message : String(error))
  }
})()
const lockPath = lockPathFor(manifestPath)

// deploy and the capability commands reach real systems, and the connection
// details for them live in the application's .env exactly as they do for
// `pnpm dev` - the application's, not the working directory's, since a command
// may be run from anywhere inside it. Variables already in the environment win.
{
  const envFile = path.join(productRoot, '.env')
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile)
}

const relative = (file: string) => path.relative(process.cwd(), file)

/**
 * Everything an error has to say, on one line per link.
 *
 * A refused deployment is reported by message rather than by stack, and a
 * message alone loses the part that matters most often: a driver's
 * `AggregateError` carries an empty message and the refused address in its
 * `errors`, and a wrapper carries the real reason in its `cause`.
 */
const describeError = (error: unknown, seen = new Set<unknown>()): string[] => {
  if (!(error instanceof Error) || seen.has(error)) return [String(error)]
  seen.add(error)
  const lines = [error.message === '' ? error.name : error.message]
  if (error instanceof AggregateError) {
    for (const inner of error.errors) lines.push(...describeError(inner, seen))
  }
  if (error.cause !== undefined) lines.push(...describeError(error.cause, seen))
  return lines
}

const resolve = async (): Promise<{
  resolution: Resolution
  previous: AssemblyLock | undefined
}> => {
  const previous = readLock(lockPath)
  return { resolution: await resolveAssembly({ manifestPath, previousLock: previous }), previous }
}

/** every reason this tree is not the one the lock describes */
const drift = (previous: AssemblyLock | undefined, resolution: Resolution): string[] => {
  // there is no generated composition to drift any more: the host assembles
  // at boot from this same resolution, so the lock is the whole story
  const reasons = lockDrift(previous, resolution)
  // capability-derived modules land relative to the manifest's directory,
  // like every other generated artifact; QUALY_GEN_OUT redirects a test run
  const read = (module: string) => {
    const root = process.env.QUALY_GEN_OUT ?? productRoot
    const file = path.resolve(root, module)
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined
  }
  reasons.push(...moduleDrift(capabilityModules(resolution), read))
  return reasons
}

/** the lock has to describe this tree before anything acts on it */
const resolveCurrent = async (what: string): Promise<Resolution> => {
  const { resolution, previous } = await resolve()
  const reasons = drift(previous, resolution)
  if (reasons.length > 0) {
    die(
      `cannot ${what}, this assembly is out of date:\n  ${reasons.join('\n  ')}\nRun \`pnpm qualy resolve\`.`,
    )
  }
  return resolution
}

async function main(): Promise<void> {
  if (command === 'resolve') {
    const { resolution, previous } = await resolve()
    if (flag('frozen-lockfile')) {
      // frozen writes nothing at all, including the derived plan: the point is
      // to find out whether this tree is the reviewed one, not to make it so
      const reasons = drift(previous, resolution)
      if (reasons.length > 0) {
        die(`this assembly is out of date:\n  ${reasons.join('\n  ')}\nRun \`pnpm qualy resolve\`.`)
      }
      console.log(`${relative(lockPath)} is up to date`)
    } else {
      // The other half of the module contract. The frozen gate above compares
      // these files, so the non-frozen resolve must be what writes them - with
      // no writer, the first capability to declare a module would brick every
      // gated command with a drift error whose prescribed fix is this very
      // command, changing nothing.
      // one set, like every other writer of these files: a lock written
      // beside half the derived modules is the state the frozen gate exists
      // to catch, and no command could fix it
      const files = openFileSet()
      try {
        for (const line of writeResolution(resolution, { lockPath, manifestPath, files })) {
          console.log(line)
        }
      } catch (error) {
        files.rollback()
        throw error
      }
    }
    for (const plugin of resolution.plugins.values()) {
      if (plugin.state === 'active') continue
      const kept = plugin.retainedBy?.length ? ` (kept by ${plugin.retainedBy.join(', ')})` : ''
      console.log(`  ${plugin.state}: ${plugin.id}${kept}`)
    }
    return
  }

  if (command === 'plugin') {
    // Deliberately ahead of the drift gate the other commands sit behind: a
    // selection that changed is exactly what makes a lock stale, and this is
    // the command that changes it.
    try {
      await runPluginCommand(rest, { manifestPath })
    } catch (error) {
      die(error instanceof Error ? error.message : String(error))
    }
    return
  }

  if (command === 'plan') {
    const { resolution, previous } = await resolve()
    const next = lockFromResolution(resolution)
    const ids = [
      ...new Set([...Object.keys(previous?.plugins ?? {}), ...Object.keys(next.plugins)]),
    ].sort()
    const lines: string[] = []
    for (const id of ids) {
      const before = previous?.plugins[id]
      const after = next.plugins[id]
      if (!after) lines.push(`  - ${id} (leaves the lock)`)
      else if (!before) lines.push(`  + ${id} (${after.state})`)
      else if (before.state !== after.state) {
        lines.push(`  ~ ${id} ${before.state} -> ${after.state}`)
      } else if (before.version !== after.version) {
        lines.push(`  ~ ${id} ${before.version} -> ${after.version}`)
      }
    }
    console.log('plugins:')
    console.log(lines.length > 0 ? lines.join('\n') : '  no changes')
    for (const key of [...resolution.capabilities.keys()].sort()) {
      const capability = resolution.capabilities.get(key)!
      const provider = resolution.providers.get(key)!.provider
      if (!provider.plan) continue
      const shown = provider.plan({
        previousState: previous?.capabilities?.[key]?.state,
        nextState: capability.state,
      })
      console.log(`\n${key} (${capability.provider}):`)
      for (const line of shown) console.log(`  ${line}`)
    }
    // setup and provisioning are not part of this plan yet; saying "no
    // destructive changes" without having looked would be a lie
    console.log('\nnothing is written by plan; run `pnpm qualy resolve` to update the lock')
    return
  }

  if (command === 'generate' || command === 'deploy') {
    // Generate writes local artifacts for a developer to review and commit;
    // deploy applies the committed ones to real systems. Build != Deploy !=
    // Start: nothing here builds anything, a start repeats none of this, and
    // a deployment never generates - what it applies was reviewed before.
    const resolution = await resolveCurrent(command)
    const ran: string[] = []
    try {
      for (const capability of capabilityWork(resolution)) {
        if (await capability.run(command, rest)) ran.push(capability.key)
      }
    } catch (error) {
      die(`${command} failed:\n  ${describeError(error).join('\n  ')}`)
    }
    console.log(ran.length > 0 ? `${command}: ${ran.join(', ')}` : `${command}: nothing to do`)
    return
  }

  if (command === 'list') {
    const resolution = await resolveCurrent('list')
    const { commands } = await descriptorCommands(resolution)
    console.log('lifecycle: resolve, plan, generate, deploy, plugin')
    for (const [key, entry] of [...commands.entries()].sort()) {
      console.log(`${key}  -  ${entry.command.summary} (${entry.plugin})`)
    }
    for (const capability of capabilityWork(resolution)) {
      const names = Object.keys(
        (resolution.providers.get(capability.key)?.provider.commands ?? {}) as object,
      )
      for (const name of names.sort()) {
        console.log(`${capability.key} ${name}  -  capability command (${capability.pluginId})`)
      }
    }
    return
  }

  const [key, name, ...args] = argv
  if (!key || !name || key.startsWith('-')) die(USAGE)
  const resolution = await resolveCurrent(`run ${key} ${name}`)

  // One noun, one command set. A namespace's commands are the union of what
  // the descriptor declares and what the capability provider of the same name
  // ships - `qualy database migrate` and `qualy database check` are one
  // namespace to the caller, and the alias reaches both. A name both sides
  // claim is refused rather than resolved by lookup order.
  const { namespaces, commands } = await descriptorCommands(resolution)
  const namespace = namespaces.get(key!) ?? key!
  const entry = commands.get(`${namespace} ${name}`)
  const provider = resolution.providers.get(namespace)?.provider
  if (entry && provider?.commands?.[name!]) {
    die(
      `command ${namespace} ${name} is declared by both ${entry.plugin}'s descriptor and the ${namespace} capability provider`,
    )
  }
  if (entry) {
    if (entry.command.context === 'runtime') {
      // the one tier that builds services, loaded only when asked for: resolve
      // and the other two tiers never pay for Effect or a plugin's graph
      const { runRuntimeCommand } = await import('./runtime.ts')
      process.exitCode = await runRuntimeCommand(resolution, entry.command, args)
      return
    }
    const implementation = await entry.command.load()
    try {
      await implementation.run({
        args,
        capability:
          entry.command.context === 'capability'
            ? capabilityContext(resolution, capabilityKeyOf(resolution, entry.plugin), args)
            : undefined,
      })
    } catch (error) {
      // a command's own refusal has said its piece and chosen its exit code;
      // anything else is a failure, reported cause by cause
      if (isCliRefused(error)) {
        console.error(error.message)
        process.exitCode = error.exitCode
        return
      }
      die(`${namespace} ${name} failed:\n  ${describeError(error).join('\n  ')}`)
    }
    return
  }

  const capability = capabilityWork(resolution).find((work) => work.key === namespace)
  if (capability) {
    try {
      if (await capability.command(name!, args)) return
    } catch (error) {
      die(`${namespace} ${name} failed:\n  ${describeError(error).join('\n  ')}`)
    }
    die(`namespace ${namespace} has no command ${name}`)
    return
  }
  if (namespaces.get(key!)) {
    die(`namespace ${namespace} has no command ${name}`)
    return
  }
  const available = [...new Set([...resolution.capabilities.keys(), ...namespaces.keys()])].join(
    ', ',
  )
  die(`no capability or namespace ${key} in this assembly; available: ${available || '(none)'}`)
}

/** a command's declared refusal (@qualy/plugin-kit/cli CliRefused), recognised by shape */
const isCliRefused = (error: unknown): error is Error & { exitCode: number } =>
  error instanceof Error &&
  (error as { _tag?: unknown })._tag === 'CliRefused' &&
  typeof (error as { exitCode?: unknown }).exitCode === 'number'

/** the capability a plugin provides, for commands that asked for its work context */
function capabilityKeyOf(resolution: Resolution, pluginId: string): string {
  for (const [key, loaded] of resolution.providers) {
    if (loaded.pluginId === pluginId) return key
  }
  throw new Error(`${pluginId} declares a capability-context command but provides no capability`)
}

/**
 * Every active plugin's commands, from its descriptor.
 *
 * Imported lazily and only for command routing: resolve and the lifecycle
 * never load plugin code, and a command's implementation loads only when it
 * is invoked.
 */
async function descriptorCommands(resolution: Resolution) {
  const descriptors = []
  for (const entry of runtimeLayers(resolution)) {
    // resolved through the application's package, like every other plugin
    // import the scripts make: the repo root deliberately depends on no
    // business plugin
    const module = (await import(resolvePluginModuleUrl(entry.specifier, manifestPath))) as {
      default?: unknown
    }
    if (isPluginDescriptor(module.default)) descriptors.push(module.default)
  }
  return collectCliCommands(descriptors, RESERVED)
}

await main()
