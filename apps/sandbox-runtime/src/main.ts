/**
 * The runtime sandbox process: one unix socket, one RPC group, one QuickJS
 * worker pool. Deliberately thin — no database, no sessions, no business
 * words — and everything the wire says is validated again in invoke.ts,
 * because whatever connects to this socket is not a friend.
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
import { Effect, Layer } from 'effect'
import { NodeRuntime, NodeSocketServer } from '@effect/platform-node'
import { SocketServer } from 'effect/unstable/socket'
import { RpcSerialization, RpcServer } from 'effect/unstable/rpc'
import { engineIdentity, runtimeBuildId, WorkerPool } from '@qualy/sandbox-engine'
import {
  DEFAULT_LIMITS,
  LIMIT_CEILINGS,
  RPC_API_VERSION,
  RuntimeSandboxRpcs,
  SANDBOX_ABI_VERSION,
  SANDBOX_RPC_MAX_FRAME_BYTES,
} from '@qualy/sandbox-rpc'
import { invoke } from './invoke.ts'
import { runtimeCapabilities } from './capabilities.ts'

const socketPath =
  process.env.QUALY_SANDBOX_RUNTIME_SOCKET ?? '.qualy/run/sandbox/runtime/runtime.sock'

const poolSize = (() => {
  const raw = process.env.QUALY_SANDBOX_POOL_SIZE
  const parsed = raw === undefined ? 2 : Number(raw)
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 32 ? parsed : 2
})()

const handlers = RuntimeSandboxRpcs.toLayer(
  Effect.gen(function* () {
    const pool = yield* Effect.acquireRelease(
      Effect.sync(() => new WorkerPool({ size: poolSize, variant: 'release' })),
      (acquired) => Effect.promise(() => acquired.shutdown()),
    )
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
const socketServerLayer = Layer.effect(
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

const server = RpcServer.layer(RuntimeSandboxRpcs, { disableFatalDefects: true }).pipe(
  Layer.provide(handlers),
  Layer.provideMerge(RpcServer.layerProtocolSocketServer),
  Layer.provideMerge(socketServerLayer),
  Layer.provide(RpcSerialization.layerNdjsonWith({ maxBufferSize: SANDBOX_RPC_MAX_FRAME_BYTES })),
)

NodeRuntime.runMain(
  Layer.launch(server).pipe(
    Effect.tapCause((cause) => Effect.logError('sandbox runtime failed', cause)),
  ),
)
