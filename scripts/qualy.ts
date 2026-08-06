import fs from 'node:fs'
import path from 'node:path'
import {
  capabilityModules,
  capabilityWork,
  lockDrift,
  moduleDrift,
  lockFromResolution,
  lockPathFor,
  readLock,
  resolveAssembly,
  writeLock,
  type AssemblyLock,
  type Resolution,
} from '@qualy/assembly'
import { DEFAULT_MANIFEST } from './lib/read-entries.ts'
import { generatedPath } from './lib/paths.ts'

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
  '  pnpm qualy <capability> <command> [args]',
].join('\n')

const argv = process.argv.slice(2)
const [command, ...rest] = argv
const flag = (name: string) => argv.includes(`--${name}`)
const option = (name: string) => {
  const at = argv.indexOf(`--${name}`)
  return at >= 0 ? argv[at + 1] : undefined
}

const manifestPath = path.resolve(option('yml') ?? DEFAULT_MANIFEST)
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
  const read = (module: string) => {
    const file = generatedPath(module)
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

  const [key, name, ...args] = argv
  if (!key || !name || key.startsWith('-')) die(USAGE)
  const resolution = await resolveCurrent(`run ${key} ${name}`)
  const capability = capabilityWork(resolution).find((entry) => entry.key === key)
  if (!capability) {
    const available = [...resolution.capabilities.keys()].join(', ')
    die(`no capability ${key} in this assembly; available: ${available || '(none)'}`)
    return
  }
  if (!(await capability.command(name!, args))) {
    die(`capability ${key} has no command ${name}`)
  }
}

await main()
