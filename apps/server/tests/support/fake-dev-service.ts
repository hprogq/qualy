import { Effect } from 'effect'
import type { DevServiceContext } from '@qualy/plugin-kit/dev'

// A development service that does nothing but say when it was asked to do it.
//
// The runner's contract is entirely about ordering and lifetime: prepare runs
// while somebody else may still own the resource, acquire runs only once it
// does not, and whatever acquire took is released when the process is asked
// to stop rather than when acquire returns. Each of those is a line on stdout
// here, so a test can read the order back.

const say = (what: string) => process.stdout.write(`fake-dev-service: ${what}\n`)

export const prepare = (context: DevServiceContext) =>
  Effect.sync(() => {
    say(`prepared ${context.plugin.id} at ${context.runtime.origin}`)
    return { config: context.plugin.config }
  })

export const acquire = (prepared: { config: unknown }, _context: DevServiceContext) =>
  Effect.acquireRelease(
    Effect.sync(() => say(`acquired with ${JSON.stringify(prepared.config)}`)),
    () => Effect.sync(() => say('released')),
  )
