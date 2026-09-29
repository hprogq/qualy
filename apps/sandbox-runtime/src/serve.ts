/**
 * What the runtime sandbox serves, and the pool it serves from.
 *
 * Kept apart from the entry so the one property the process owes a
 * deployment can be proved: the socket does not exist - nothing can connect
 * - until the pool it answers from is up (tests/serve.test.ts).
 *
 * The socket file is this process's own: stale ones are removed before
 * listening (a crash leaves them behind and listen would refuse), and the
 * file is unlinked again on shutdown. Defects stay per-request
 * (disableFatalDefects): one broken evaluation must not tear down the
 * connection under everyone else's.
 */

import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Context, Effect, Layer } from 'effect'
import { NodeSocketServer } from '@effect/platform-node'
import { SocketServer } from 'effect/unstable/socket'
import { RpcSerialization, RpcServer } from 'effect/unstable/rpc'
import { WorkerPool } from '@qualy/sandbox-engine'
import { RuntimeSandboxRpcs, SANDBOX_RPC_MAX_FRAME_BYTES } from '@qualy/sandbox-rpc'
import { invoke } from './invoke.ts'
import { runtimeCapabilities } from './capabilities.ts'

export class Pool extends Context.Service<Pool, WorkerPool>()('@qualy/sandbox-runtime/Pool') {}

/** kept warm: started whole before it is handed on, and a worker thrown away is replaced at once */
export const warmPoolLayer = (size: number) =>
  Layer.effect(
    Pool,
    Effect.acquireRelease(
      Effect.promise(async () => {
        const pool = new WorkerPool({ size, variant: 'release', keepWarm: true })
        await pool.start()
        return pool
      }),
      (acquired) => Effect.promise(() => acquired.shutdown()),
    ),
  )

const handlers = RuntimeSandboxRpcs.toLayer(
  Effect.gen(function* () {
    const pool = yield* Pool
    // minted once per process: the identity every answer carries, so a
    // caller can tell this serving instance from the one before it
    const runtimeInstanceId = randomUUID()
    const capabilities = runtimeCapabilities(runtimeInstanceId)
    const identity = {
      engineVersion: capabilities.quickjsEngineVersion,
      runtimeBuildId: capabilities.runtimeBuildId,
      runtimeInstanceId,
    }
    return {
      GetRuntimeCapabilities: () => Effect.succeed(capabilities),
      Invoke: (request: Parameters<typeof invoke>[1]) =>
        Effect.map(invoke(pool, request), (answer) => ({ ...answer, ...identity })),
    }
  }),
)

// the socket file's lifecycle wraps the listener's: cleared before listen
// (Effect only closes the server; a crash-stale file would refuse the bind),
// removed after close
const socketServerLayer = (socketPath: string) =>
  Layer.effect(
    SocketServer.SocketServer,
    Effect.gen(function* () {
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          fs.mkdirSync(path.dirname(socketPath), { recursive: true })
          fs.rmSync(socketPath, { force: true })
        }),
        () => Effect.sync(() => fs.rmSync(socketPath, { force: true })),
      )
      const listening = yield* NodeSocketServer.make({ path: socketPath })
      yield* Effect.log(`sandbox runtime listening on ${socketPath}`)
      return listening
    }),
  )

/**
 * The runtime sandbox on one socket, over a pool it is given. The pool is
 * provided outermost, so the whole of it - every worker ready - is built
 * before the socket is.
 */
export const runtimeServer = <E, R>(socketPath: string, pool: Layer.Layer<Pool, E, R>) =>
  RpcServer.layer(RuntimeSandboxRpcs, { disableFatalDefects: true }).pipe(
    Layer.provide(handlers),
    Layer.provideMerge(RpcServer.layerProtocolSocketServer),
    Layer.provideMerge(socketServerLayer(socketPath)),
    Layer.provide(RpcSerialization.layerNdjsonWith({ maxBufferSize: SANDBOX_RPC_MAX_FRAME_BYTES })),
    Layer.provide(pool),
  )
