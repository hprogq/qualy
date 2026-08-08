import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isPluginDescriptor } from '@qualy/plugin-kit'
import { collectCliCommands } from '@qualy/plugin-kit/cli'
import { resolvePluginModuleUrl } from '@qualy/assembly/host'
import {
  capabilityContext,
  capabilityModules,
  capabilityWork,
  lockDrift,
  moduleDrift,
  lockFromResolution,
  lockPathFor,
  readLock,
  resolveAssembly,
  writeAtomic,
  writeLock,
  type AssemblyLock,
  type Resolution,
  runtimeLayers,
} from '@qualy/assembly'

// deploy and the capability commands reach real systems, and the connection
// details for them live in .env exactly as they do for `pnpm dev`
try {
  process.loadEnvFile()
} catch {}

// The assembly commands.
//
// The core owns when things happen and each capability owns what happens:
// resolve and plan never touch anything outside this repository, generate
// writes local artifacts, deploy applies them. A capability with nothing to do
// in a phase has no handler for it, so an assembly with no database plugin
// runs every one of these and never mentions a database.

const USAGE = [
  'usage:',
  '  pnpm qualy resolve [--frozen-lockfile] [--yml <path>]',
  '  pnpm qualy plan',
  '  pnpm qualy generate [capability args]',
  '  pnpm qualy deploy',
  '  pnpm qualy list',
  '  pnpm qualy <namespace> <command> [args]',
].join('\n')

/** the lifecycle's own verbs; a plugin namespace may not shadow one */
const RESERVED = ['resolve', 'plan', 'generate', 'deploy', 'list', 'help']

const argv = process.argv.slice(2)
const [command, ...rest] = argv
const flag = (name: string) => argv.includes(`--${name}`)
const option = (name: string) => {
  const at = argv.indexOf(`--${name}`)
  return at >= 0 ? argv[at + 1] : undefined
}

// the CLI is this repository's; an explicit --yml still points anywhere
const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..')
const manifestPath = option('yml') ? path.resolve(option('yml')!) : path.join(repoRoot, 'qualy.yml')
const lockPath = lockPathFor(manifestPath)

const die = (message: string): never => {
  console.error(message)
  process.exit(1)
}

const relative = (file: string) => path.relative(process.cwd(), file)

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
  // capability-derived modules land relative to the manifest, like every
  // other generated artifact; QUALY_GEN_OUT redirects a test run's tree
  const read = (module: string) => {
    const root = process.env.QUALY_GEN_OUT ?? path.dirname(manifestPath)
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
      console.log(
        writeLock(lockPath, lockFromResolution(resolution))
          ? `${relative(lockPath)} written`
          : `${relative(lockPath)} unchanged`,
      )
      // The other half of the module contract. The frozen gate above compares
      // these files, so the non-frozen resolve must be what writes them - with
      // no writer, the first capability to declare a module would brick every
      // gated command with a drift error whose prescribed fix is this very
      // command, changing nothing.
      const out = process.env.QUALY_GEN_OUT ?? path.dirname(manifestPath)
      for (const module of capabilityModules(resolution)) {
        const file = path.resolve(out, module.path)
        if (writeAtomic(file, module.content)) console.log(`${relative(file)} written`)
      }
    }
    for (const plugin of resolution.plugins.values()) {
      if (plugin.state === 'active') continue
      const kept = plugin.retainedBy?.length ? ` (kept by ${plugin.retainedBy.join(', ')})` : ''
      console.log(`  ${plugin.state}: ${plugin.id}${kept}`)
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
    const resolution = await resolveCurrent(command)
    const ran: string[] = []
    for (const capability of capabilityWork(resolution)) {
      if (await capability.run(command, rest)) ran.push(capability.key)
    }
    console.log(ran.length > 0 ? `${command}: ${ran.join(', ')}` : `${command}: nothing to do`)
    return
  }

  if (command === 'list') {
    const resolution = await resolveCurrent('list')
    const { commands } = await descriptorCommands(resolution)
    console.log('lifecycle: resolve, plan, generate, deploy')
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
    const implementation = await entry.command.load()
    await implementation.run({
      args,
      capability:
        entry.command.context === 'capability'
          ? capabilityContext(resolution, capabilityKeyOf(resolution, entry.plugin), args)
          : undefined,
    })
    return
  }

  const capability = capabilityWork(resolution).find((work) => work.key === namespace)
  if (capability) {
    if (await capability.command(name!, args)) return
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
    // resolved through the host package, like every other plugin import the
    // scripts make: the repo root deliberately depends on no business plugin
    const module = (await import(resolvePluginModuleUrl(entry.specifier, manifestPath))) as {
      default?: unknown
    }
    if (isPluginDescriptor(module.default)) descriptors.push(module.default)
  }
  return collectCliCommands(descriptors, RESERVED)
}

await main()
