import {
  frozenLockfile,
  lockDrift,
  lockFromResolution,
  lockPathFor,
  productRootFor,
  readLock,
  resolveAssembly,
  type Resolution,
} from '@qualy/assembly'
import { deploymentPaths, verifyDeployment } from '@qualy/deployment-state'

// Start validates and starts; it never repairs.
//
// A process that quietly re-resolved on boot would make the lock decorative:
// the assembly actually running would be whatever the manifest happened to
// say at that moment, and the reviewed one would be a file nobody consulted.
// So this only reports, and frozenLockfile() decides whether a report is
// fatal: production refuses, development warns and carries on, because editing
// qualy.yml and restarting is the whole loop there.

/**
 * The resolution the assembler will load from, having checked the manifest
 * still matches the reviewed lock. There is no generated composition module
 * to check any more: what boots IS this resolution, imported at boot.
 */
export async function verifyAssembly(
  manifestPath: string,
  warn: (message: string) => void,
): Promise<Resolution> {
  const previousLock = readLock(lockPathFor(manifestPath))
  const resolution = await resolveAssembly({ manifestPath, previousLock })
  const problems = lockDrift(previousLock, resolution)
  if (problems.length === 0) return resolution

  const summary = `assembly is out of date:\n  ${problems.join('\n  ')}`
  if (frozenLockfile()) {
    throw new Error(
      `${summary}\nRun \`pnpm qualy resolve\` and review the diff, or set QUALY_FROZEN_LOCKFILE=0 to start anyway.`,
    )
  }
  warn(`${summary}; starting anyway because this is not a frozen-lockfile environment`)
  return resolution
}

/**
 * The other half of what a production start checks: not only that the
 * software targets a reviewed assembly, but that THIS instance has been
 * brought up to it. The deployed lock in the instance's state directory says
 * what was last fully deployed; a target that differs means a database and
 * external resources that are neither the old assembly nor the new one, and
 * the only correct answer is to refuse until `qualy deploy` has run.
 *
 * Production only. A developer's database is migrated by the development
 * boot itself, and forcing a deploy between every entity change would be the
 * repair-at-start this file exists to keep out of production, moved into the
 * development loop as friction.
 */
export function verifyDeployed(
  manifestPath: string,
  resolution: Resolution,
  mode: 'production' | 'development',
): void {
  if (mode !== 'production') return
  const paths = deploymentPaths({ productRoot: productRootFor(manifestPath), mode, env: process.env })
  const problems = verifyDeployment(paths, lockFromResolution(resolution))
  if (problems.length === 0) return
  throw new Error(
    `deployment required:\n  ${problems.join('\n  ')}\nRun \`qualy deploy\` against this instance (state at ${paths.root}), then start again. A start never deploys.`,
  )
}
