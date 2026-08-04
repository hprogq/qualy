import fs from 'node:fs'
import path from 'node:path'
import {
  lockDrift,
  lockFromResolution,
  lockPathFor,
  readLock,
  renderRuntimePlan,
  resolveAssembly,
  runtimePlanPathFor,
  writeLock,
  writeRuntimePlan,
  type AssemblyLock,
  type Resolution,
} from '@qualy/assembly'
import { DEFAULT_MANIFEST } from './lib/read-entries.ts'

// The assembly commands. Neither of them connects to a database or runs SQL:
// resolve turns a manifest into a lock, plan says what would change.

const argv = process.argv.slice(2)
const command = argv[0]
const flag = (name: string) => argv.includes(`--${name}`)
const option = (name: string) => {
  const at = argv.indexOf(`--${name}`)
  return at >= 0 ? argv[at + 1] : undefined
}

const manifestPath = path.resolve(option('yml') ?? DEFAULT_MANIFEST)
const lockPath = lockPathFor(manifestPath)
const planPath = runtimePlanPathFor(manifestPath)

const die = (message: string): never => {
  console.error(message)
  process.exit(1)
}

const resolve = (): { resolution: Resolution; previous: AssemblyLock | undefined } => {
  const previous = readLock(lockPath)
  return { resolution: resolveAssembly({ manifestPath, previousLock: previous }), previous }
}

const relative = (file: string) => path.relative(process.cwd(), file)

if (command === 'resolve') {
  const { resolution, previous } = resolve()
  if (flag('frozen-lockfile')) {
    // frozen writes nothing at all, including the derived plan: the point is
    // to find out whether this tree is the reviewed one, not to make it so
    const drift = lockDrift(previous, resolution)
    if (fs.existsSync(planPath)) {
      if (fs.readFileSync(planPath, 'utf8') !== renderRuntimePlan(resolution)) {
        drift.push(`${relative(planPath)} is not what this manifest generates`)
      }
    } else {
      drift.push(`${relative(planPath)} is missing`)
    }
    if (drift.length > 0) {
      die(`this assembly is out of date:\n  ${drift.join('\n  ')}\nRun \`pnpm qualy resolve\`.`)
    }
    console.log(`${relative(lockPath)} is up to date`)
  } else {
    console.log(
      writeLock(lockPath, lockFromResolution(resolution))
        ? `${relative(lockPath)} written`
        : `${relative(lockPath)} unchanged`,
    )
    console.log(
      writeRuntimePlan(planPath, resolution)
        ? `${relative(planPath)} written`
        : `${relative(planPath)} unchanged`,
    )
  }
  for (const plugin of resolution.plugins.values()) {
    if (plugin.state !== 'active') console.log(`  ${plugin.state}: ${plugin.id}`)
  }
} else if (command === 'plan') {
  const { resolution, previous } = resolve()
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
    else if (before.state !== after.state) lines.push(`  ~ ${id} ${before.state} -> ${after.state}`)
    else if (before.version !== after.version) {
      lines.push(`  ~ ${id} ${before.version} -> ${after.version}`)
    }
  }
  console.log('plugins:')
  console.log(lines.length > 0 ? lines.join('\n') : '  no changes')
  console.log(`\nruntime order:\n  ${resolution.runtimeOrder.join('\n  ') || '(empty)'}`)
  console.log(`\ndatabase order:\n  ${resolution.databaseOrder.join('\n  ') || '(empty)'}`)
  // migrations, provisioning and setup are not part of this plan yet; saying
  // "no destructive changes" without having looked would be a lie
  console.log('\nnothing is written by plan; run `pnpm qualy resolve` to update the lock')
} else {
  die('usage: pnpm qualy <resolve|plan> [--yml <path>] [--frozen-lockfile]')
}
