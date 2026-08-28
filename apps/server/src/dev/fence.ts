import type { DevServiceSpec } from '@qualy/plugin-kit/dev'
import { requestShutdown } from '../shutdown.ts'
import { PROTOCOL, hostMessage, supervised, tell, type PluginRoot } from './protocol.ts'

// The line between preparing to be the server and being it
// (docs/runtime-redesign.md §10).
//
// Everything above this call is pure - the manifest read, the lock compared,
// every descriptor imported, the layers composed - and everything below it
// acquires: the port, the pool, the scheduler, whatever each plugin owns. A
// supervisor stages a replacement through the band above while the process it
// replaces is still serving, so this is where that replacement stops and
// waits to be told the old one has gone.
//
// Unsupervised, it is not a line at all: the call returns and the process
// carries straight on, which is what `node run.ts development` and production
// both do.
//
// There is no timeout. A candidate that has been waiting a long time has cost
// nothing - it holds no resource - and starting anyway would put two owners
// on one port. What does end the wait is the channel closing: the parent's
// connection is this process's lease on being alive at all, so a supervisor
// that is killed does not leave a candidate behind waiting for a message that
// will never come.

/** say why this process is giving up, in a form the supervisor's log can carry */
const leave = (reason: string): never => {
  process.stderr.write(`candidate exiting: ${reason}\n`)
  process.exit(0)
}

/**
 * Report readiness to be launched, then wait to be told to.
 *
 * Resolves when the host accepts. It never resolves on a refusal - the
 * process ends instead, because a refused candidate has nothing else to do.
 */
export async function supervisedPrepareFence(
  topology: readonly DevServiceSpec[],
  roots: readonly PluginRoot[],
): Promise<void> {
  if (!supervised()) return

  // The lease, for the whole lifetime rather than for this wait: a supervisor
  // that dies later must not leave a server holding the port. What it means
  // depends on which side of the line this process is on - a running server
  // is asked to stop and unwinds, while a candidate still waiting here has
  // nothing to unwind and simply leaves.
  let launched = false
  process.on('disconnect', () => {
    if (launched) requestShutdown()
    else leave('the supervisor went away')
  })

  await new Promise<void>((resolve) => {
    const onMessage = (raw: unknown) => {
      const message = hostMessage(raw)
      if (message === null) return
      if (message.type === 'accept') {
        process.off('message', onMessage)
        // from here the stop arrives the same way, over the same channel
        process.on('message', (later: unknown) => {
          if (hostMessage(later)?.type === 'shutdown') requestShutdown()
        })
        launched = true
        resolve()
        return
      }
      if (message.type === 'reject') leave('the supervisor refused this candidate')
      if (message.type === 'shutdown') leave('asked to stop before being launched')
    }
    process.on('message', onMessage)
    // said last: a host that answers instantly must find the listener already
    // installed
    tell({ protocol: PROTOCOL, type: 'prepared', role: 'backend', topology, roots })
  })
}
