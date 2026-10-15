import { Effect, Predicate, Schema } from 'effect'
import { RpcClient } from 'effect/rpc'

type SandboxPeer = 'authoring' | 'runtime'

// Effect 4.0.4 checks elapsed silence BEFORE sending the next ping. Its equal
// 5 s defaults can expire on the very first tick, before any ping was sent.
// Leave two complete probe opportunities before declaring an idle peer lost.
export const SANDBOX_RPC_PING_INTERVAL_MS = 5_000
export const SANDBOX_RPC_PING_TIMEOUT_MS = 15_000

const SOCKET_REASONS = new Set([
  'SocketOpenError',
  'SocketReadError',
  'SocketWriteError',
  'SocketCloseError',
  'SocketUpgradeError',
  'RpcClientDefect',
])
const SYSTEM_CODES = new Set([
  'ENOENT',
  'EACCES',
  'EPERM',
  'ECONNREFUSED',
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'ENOBUFS',
])
const OPERATION_REASONS = new Set(['CompileBusy', 'TransportDeadlineExceeded'])

// The peer and the schema decoder can carry source, artifact, paths and stack
// traces. Only fixed classifications cross this observability boundary.
export const sandboxRpcFailureAttributes = (failure: unknown): Record<string, string> => {
  if (Schema.isSchemaError(failure)) return { 'sandbox.rpc.reason': 'schema-decode' }
  const failureTag = Predicate.isObject(failure) && '_tag' in failure ? failure._tag : undefined
  if (typeof failureTag === 'string' && OPERATION_REASONS.has(failureTag))
    return { 'sandbox.rpc.reason': failureTag }
  const reason = Predicate.isObject(failure) && 'reason' in failure ? failure.reason : undefined
  const tag = Predicate.isObject(reason) && '_tag' in reason ? reason._tag : undefined
  const attributes = {
    'sandbox.rpc.reason': typeof tag === 'string' && SOCKET_REASONS.has(tag) ? tag : 'unknown',
  }
  if (!Predicate.isObject(reason) || !('cause' in reason)) return attributes
  const cause = reason.cause
  if (cause instanceof Error && cause.message === 'ping timeout')
    return { ...attributes, 'sandbox.rpc.cause': 'ping-timeout' }
  const code = Predicate.isObject(cause) && 'code' in cause ? cause.code : undefined
  return typeof code === 'string' && SYSTEM_CODES.has(code)
    ? { ...attributes, 'sandbox.rpc.cause': code }
    : attributes
}

export const logSandboxRpcFailure = (
  peer: SandboxPeer,
  operation: string,
  failure: unknown,
): Effect.Effect<void> => {
  const attributes = {
    'sandbox.peer': peer,
    'sandbox.rpc.operation': operation,
    ...sandboxRpcFailureAttributes(failure),
  }
  return Effect.annotateCurrentSpan(attributes).pipe(
    Effect.andThen(
      Effect.logError('sandbox RPC failed').pipe(
        Effect.annotateLogs({ source: 'sandbox', ...attributes }),
      ),
    ),
  )
}

export const sandboxRpcProtocolLayer = (peer: SandboxPeer) =>
  RpcClient.layerProtocolSocket({
    pingInterval: SANDBOX_RPC_PING_INTERVAL_MS,
    pingTimeout: SANDBOX_RPC_PING_TIMEOUT_MS,
    onPingTimeout: Effect.logWarning('sandbox RPC heartbeat timed out').pipe(
      Effect.annotateLogs({
        source: 'sandbox',
        'sandbox.peer': peer,
        'sandbox.rpc.reason': 'ping-timeout',
        'sandbox.rpc.ping_interval_ms': SANDBOX_RPC_PING_INTERVAL_MS,
        'sandbox.rpc.ping_timeout_ms': SANDBOX_RPC_PING_TIMEOUT_MS,
      }),
    ),
  })
