import { Cause, Effect, Exit, Layer, type Scope } from 'effect'
import { NodeSocket } from '@effect/platform-node'
import { RpcClient, RpcSerialization } from 'effect/unstable/rpc'
import { CliRefused, type CliContext } from '@qualy/plugin-kit/cli'
import {
  FormulaAuthoringRpcs,
  RPC_API_VERSION,
  RuntimeSandboxRpcs,
  SANDBOX_ABI_VERSION,
  SANDBOX_RPC_MAX_FRAME_BYTES,
} from '@qualy/sandbox-rpc'
import { runtimeSocketPath } from './service.ts'

// `qualy sandbox status` - are both sandbox processes there, and do they
// speak this host's protocol?
//
// Readiness deliberately leaves the sandboxes out: a server boots and serves
// without them, and an absent socket is an outage at use time. So nothing
// else answers the operator's question after a deployment, and the release
// smoke has no other way to prove the RPC handshake across the socket
// volumes. This asks each process for its capabilities over its own socket -
// the same transport the server uses - and compares the protocol
// generations. Loaded when invoked, never by the server.

const ANSWER_WITHIN = '5 seconds'

/** the default socket, relative to the working directory in development */
const authoringSocketPath = (): string =>
  process.env.QUALY_SANDBOX_AUTHORING_SOCKET ?? '.qualy/run/sandbox/authoring/authoring.sock'

/** the client transport over one unix socket, as the server builds it */
const over = (socketPath: string) =>
  RpcClient.layerProtocolSocket().pipe(
    Layer.provide(NodeSocket.layerNet({ path: socketPath }).pipe(Layer.orDie)),
    Layer.provide(RpcSerialization.layerNdjsonWith({ maxBufferSize: SANDBOX_RPC_MAX_FRAME_BYTES })),
  )

class NoAnswer extends Error {
  readonly _tag = 'NoAnswer'
}

const ask = async <A>(
  socketPath: string,
  // the client lives in a scope of its own, closed once the answer is in
  call: Effect.Effect<A, unknown, RpcClient.Protocol | Scope.Scope>,
): Promise<{ ok: true; answer: A } | { ok: false; reason: string }> => {
  const program = call.pipe(
    Effect.timeoutOrElse({
      duration: ANSWER_WITHIN,
      orElse: () => Effect.fail(new NoAnswer(`did not answer within ${ANSWER_WITHIN}`)),
    }),
    Effect.provide(over(socketPath)),
    Effect.scoped,
  )
  // the CLI edge: the one place a command runs its effect
  const exit = await Effect.runPromise(Effect.exit(program))
  if (Exit.isSuccess(exit)) return { ok: true, answer: exit.value }
  return { ok: false, reason: describe(Cause.squash(exit.cause)) }
}

/** the failure and what caused it, innermost last: a socket error alone never names the missing file */
const describe = (failure: unknown): string => {
  const parts: string[] = []
  let at: unknown = failure
  for (let depth = 0; depth < 6 && at !== undefined && at !== null; depth += 1) {
    if (at instanceof Error) {
      parts.push(at.message)
      at = at.cause
    } else if (typeof at === 'object' && 'reason' in at) {
      parts.push(String(at.reason))
      break
    } else {
      parts.push(String(at))
      break
    }
  }
  return [...new Set(parts)].join(': ')
}

const short = (id: string) => id.slice(0, 12)

export async function run(_context: CliContext): Promise<void> {
  const lines: string[] = []
  let notOk = 0

  const runtimeAt = runtimeSocketPath()
  const runtime = await ask(
    runtimeAt,
    Effect.gen(function* () {
      const client = yield* RpcClient.make(RuntimeSandboxRpcs)
      return yield* client.GetRuntimeCapabilities()
    }),
  )
  if (!runtime.ok) {
    notOk += 1
    lines.push(`sandbox status: runtime unreachable at ${runtimeAt}: ${runtime.reason}`)
  } else if (
    runtime.answer.rpcApiVersion !== RPC_API_VERSION ||
    runtime.answer.sandboxAbiVersion !== SANDBOX_ABI_VERSION
  ) {
    notOk += 1
    lines.push(
      `sandbox status: runtime protocol mismatch at ${runtimeAt}: it speaks rpc ${String(runtime.answer.rpcApiVersion)} / abi ${String(runtime.answer.sandboxAbiVersion)}, this host speaks rpc ${String(RPC_API_VERSION)} / abi ${String(SANDBOX_ABI_VERSION)}`,
    )
  } else {
    lines.push(
      `sandbox status: runtime ok at ${runtimeAt} (rpc ${String(runtime.answer.rpcApiVersion)}, abi ${String(runtime.answer.sandboxAbiVersion)}, quickjs ${runtime.answer.quickjsEngineVersion}, build ${short(runtime.answer.runtimeBuildId)})`,
    )
  }

  const authoringAt = authoringSocketPath()
  const authoring = await ask(
    authoringAt,
    Effect.gen(function* () {
      const client = yield* RpcClient.make(FormulaAuthoringRpcs)
      return yield* client.GetAuthoringCapabilities()
    }),
  )
  if (!authoring.ok) {
    notOk += 1
    lines.push(`sandbox status: authoring unreachable at ${authoringAt}: ${authoring.reason}`)
  } else if (authoring.answer.rpcApiVersion !== RPC_API_VERSION) {
    notOk += 1
    lines.push(
      `sandbox status: authoring protocol mismatch at ${authoringAt}: it speaks rpc ${String(authoring.answer.rpcApiVersion)}, this host speaks rpc ${String(RPC_API_VERSION)}`,
    )
  } else {
    lines.push(
      `sandbox status: authoring ok at ${authoringAt} (rpc ${String(authoring.answer.rpcApiVersion)}, formula abi ${String(authoring.answer.formulaAbiVersion)}, typescript ${authoring.answer.typescriptVersion}, esbuild ${authoring.answer.esbuildVersion}, build ${short(authoring.answer.authoringBuildId)})`,
    )
  }

  for (const line of lines) console.log(line)
  if (notOk > 0) throw new CliRefused(`sandbox status: ${String(notOk)} of 2 processes not ok`, 1)
}
