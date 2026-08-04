import fs from 'node:fs'
import {
  lockDrift,
  lockPathFor,
  readLock,
  renderRuntimePlan,
  resolveAssembly,
  runtimePlanPathFor,
} from '@qualy/assembly'

// Start validates and starts; it never repairs.
//
// A process that quietly re-resolved on boot would make the lock decorative:
// the assembly actually running would be whatever the manifest happened to
// say at that moment, and the reviewed one would be a file nobody consulted.
// So this only reports, and QUALY_FROZEN_LOCKFILE decides whether a report is
// fatal. Deployments set it; development gets a warning and carries on,
// because editing qualy.yml and restarting is the whole loop there.

/**
 * The generated entry list the loader will read, having checked it still
 * describes the manifest and the lock.
 */
export function verifyAssembly(manifestPath: string, warn: (message: string) => void): string {
  const runtimePlanPath = runtimePlanPathFor(manifestPath)
  if (!fs.existsSync(runtimePlanPath)) {
    throw new Error(
      `${runtimePlanPath} is missing: the runtime plan is generated from ${manifestPath}. Run \`pnpm qualy resolve\`.`,
    )
  }

  const previousLock = readLock(lockPathFor(manifestPath))
  const resolution = resolveAssembly({ manifestPath, previousLock })
  const problems = lockDrift(previousLock, resolution)
  if (fs.readFileSync(runtimePlanPath, 'utf8') !== renderRuntimePlan(resolution)) {
    problems.push(`${runtimePlanPath} is not what this manifest generates`)
  }
  if (problems.length === 0) return runtimePlanPath

  const summary = `assembly is out of date:\n  ${problems.join('\n  ')}`
  if (process.env.QUALY_FROZEN_LOCKFILE === '1') {
    throw new Error(`${summary}\nRun \`pnpm qualy resolve\` and review the diff.`)
  }
  warn(`${summary}; starting anyway because QUALY_FROZEN_LOCKFILE is not set`)
  return runtimePlanPath
}
