import {
  frozenLockfile,
  lockDrift,
  lockPathFor,
  readLock,
  resolveAssembly,
  type Resolution,
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
