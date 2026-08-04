import fs from 'node:fs'
import path from 'node:path'
import {
  frozenLockfile,
  lockDrift,
  lockPathFor,
  readLock,
  renderRuntimeModule,
  renderRuntimePlan,
  resolveAssembly,
  runtimePlanPathFor,
} from '@qualy/assembly'

// Start validates and starts; it never repairs.
//
// A process that quietly re-resolved on boot would make the lock decorative:
// the assembly actually running would be whatever the manifest happened to
// say at that moment, and the reviewed one would be a file nobody consulted.
// So this only reports, and frozenLockfile() decides whether a report is
// fatal: production refuses, development warns and carries on, because editing
// qualy.yml and restarting is the whole loop there.

/**
 * The generated entry list the loader will read, having checked it still
 * describes the manifest and the lock.
 */
export async function verifyAssembly(
  manifestPath: string,
  warn: (message: string) => void,
): Promise<string> {
  const runtimePlanPath = runtimePlanPathFor(manifestPath)
  if (!fs.existsSync(runtimePlanPath)) {
    throw new Error(
      `${runtimePlanPath} is missing: the runtime plan is generated from ${manifestPath}. Run \`pnpm qualy resolve\`.`,
    )
  }

  const previousLock = readLock(lockPathFor(manifestPath))
  const resolution = await resolveAssembly({ manifestPath, previousLock })
  const problems = lockDrift(previousLock, resolution)
  if (fs.readFileSync(runtimePlanPath, 'utf8') !== renderRuntimePlan(resolution)) {
    problems.push(`${runtimePlanPath} is not what this manifest generates`)
  }
  // the Effect runtime reads a module rather than an entry list, and it is
  // just as derived: an instance whose layers do not match the reviewed lock
  // is running an assembly nobody approved
  const runtimeModulePath = path.join(path.dirname(runtimePlanPath), 'runtime.gen.ts')
  if (!fs.existsSync(runtimeModulePath)) {
    problems.push(`${runtimeModulePath} is missing; run \`pnpm gen\``)
  } else if (fs.readFileSync(runtimeModulePath, 'utf8') !== renderRuntimeModule(resolution)) {
    problems.push(`${runtimeModulePath} is not what this manifest generates`)
  }
  if (problems.length === 0) return runtimePlanPath

  const summary = `assembly is out of date:\n  ${problems.join('\n  ')}`
  if (frozenLockfile()) {
    throw new Error(
      `${summary}\nRun \`pnpm qualy resolve\` and review the diff, or set QUALY_FROZEN_LOCKFILE=0 to start anyway.`,
    )
  }
  warn(`${summary}; starting anyway because this is not a frozen-lockfile environment`)
  return runtimePlanPath
}
