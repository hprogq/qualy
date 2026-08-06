import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  frozenLockfile,
  lockDrift,
  lockPathFor,
  readLock,
  renderRuntimeModule,
  resolveAssembly,
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
  const previousLock = readLock(lockPathFor(manifestPath))
  const resolution = await resolveAssembly({ manifestPath, previousLock })
  const problems = lockDrift(previousLock, resolution)
  // The module THIS process imports, not one derived from the manifest path.
  // The import in ./effect/runtime.ts is static, so QUALY_CONFIG pointing at
  // another directory does not move it; deriving the path from the manifest
  // checked a file the process would never load, and reported an assembly as
  // verified while running a different one.
  const runtimeModulePath = fileURLToPath(new URL('../runtime.gen.ts', import.meta.url))
  if (!fs.existsSync(runtimeModulePath)) {
    problems.push(`${runtimeModulePath} is missing; run \`pnpm gen\``)
  } else if (
    fs.readFileSync(runtimeModulePath, 'utf8') !==
    renderRuntimeModule(resolution, runtimeModulePath)
  ) {
    problems.push(`${runtimeModulePath} is not what this manifest generates`)
  }
  if (problems.length === 0) return runtimeModulePath

  const summary = `assembly is out of date:\n  ${problems.join('\n  ')}`
  if (frozenLockfile()) {
    throw new Error(
      `${summary}\nRun \`pnpm qualy resolve\` and review the diff, or set QUALY_FROZEN_LOCKFILE=0 to start anyway.`,
    )
  }
  warn(`${summary}; starting anyway because this is not a frozen-lockfile environment`)
  return runtimeModulePath
}
