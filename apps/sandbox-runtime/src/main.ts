/**
 * The runtime sandbox process: one unix socket, one RPC group, one QuickJS
 * worker pool. Deliberately thin — no database, no sessions, no business
 * words — and everything the wire says is validated again in invoke.ts,
 * because whatever connects to this socket is not a friend.
 *
 * The pool comes up before the socket does: every worker is spawned, loaded
 * and warmed before anything can connect, so a deployment's readiness check
 * finds an engine that is already warm, and nobody's request pays for one.
 * A worker that cannot come up fails the start, and the process is restarted
 * rather than left half started (./serve.ts).
 */

import { Effect, Layer } from 'effect'
import { NodeRuntime } from '@effect/platform-node'
import { runtimeServer, warmPoolLayer } from './serve.ts'

const socketPath =
  process.env.QUALY_SANDBOX_RUNTIME_SOCKET ?? '.qualy/run/sandbox/runtime/runtime.sock'

// A whole number from 1 to 32, or the process refuses to start and says so:
// a typo used to become 2 in silence, which on a one-CPU quota is exactly
// the pairing that times healthy formulas out.
const poolSize = (() => {
  const raw = process.env.QUALY_SANDBOX_POOL_SIZE
  if (raw === undefined || raw === '') return 2
  const parsed = /^\d{1,2}$/.test(raw) ? Number(raw) : Number.NaN
  if (parsed >= 1 && parsed <= 32) return parsed
  console.error(
    `QUALY_SANDBOX_POOL_SIZE must be a whole number from 1 to 32, not ${JSON.stringify(raw)}`,
  )
  process.exit(1)
})()

NodeRuntime.runMain(
  Layer.launch(runtimeServer(socketPath, warmPoolLayer(poolSize))).pipe(
    Effect.tapCause((cause) => Effect.logError('sandbox runtime failed', cause)),
  ),
)
