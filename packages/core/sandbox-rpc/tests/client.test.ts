import { Effect, Logger, References, Schema } from 'effect'
import { RpcClientError } from 'effect/rpc'
import { Socket } from 'effect/socket'
import { describe, expect, it } from 'vitest'
import { logSandboxRpcFailure, sandboxRpcFailureAttributes } from '../src/client.ts'

describe('sandbox transport diagnostics', () => {
  it('retains the heartbeat cause beneath the generic RPC read error', () => {
    const failure = new RpcClientError.RpcClientError({
      reason: new Socket.SocketReadError({ cause: new Error('ping timeout') }),
    })
    expect(sandboxRpcFailureAttributes(failure)).toEqual({
      'sandbox.rpc.reason': 'SocketReadError',
      'sandbox.rpc.cause': 'ping-timeout',
    })
  })

  it('logs the operation and OS code without peer content or internal paths', async () => {
    const logs: unknown[] = []
    const logger = Logger.make((entry) => {
      logs.push({
        message: entry.message,
        annotations: entry.fiber.getRef(References.CurrentLogAnnotations),
      })
    })
    const failure = new RpcClientError.RpcClientError({
      reason: new Socket.SocketOpenError({
        kind: 'Unknown',
        cause: Object.assign(new Error('private formula source at /private/authoring.sock'), {
          code: 'ECONNREFUSED',
        }),
      }),
    })
    await Effect.runPromise(
      logSandboxRpcFailure('authoring', 'CompileFormula', failure).pipe(
        Effect.provide(Logger.layer([logger])),
      ),
    )
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      annotations: {
        source: 'sandbox',
        'sandbox.peer': 'authoring',
        'sandbox.rpc.operation': 'CompileFormula',
        'sandbox.rpc.reason': 'SocketOpenError',
        'sandbox.rpc.cause': 'ECONNREFUSED',
      },
    })
    expect(JSON.stringify(logs)).not.toMatch(/private|formula source|stack/)
  })

  it('never includes schema input or arbitrary peer tags and cause codes', () => {
    const failure = Effect.runSync(
      Effect.flip(Schema.decodeUnknownEffect(Schema.Number)('private')),
    )
    expect(sandboxRpcFailureAttributes(failure)).toEqual({ 'sandbox.rpc.reason': 'schema-decode' })
    expect(
      sandboxRpcFailureAttributes({
        reason: { _tag: 'private source', cause: { code: 'secret' } },
      }),
    ).toEqual({ 'sandbox.rpc.reason': 'unknown' })
  })

  it('distinguishes a full compile queue and a call deadline from a disconnected peer', () => {
    for (const reason of ['CompileBusy', 'TransportDeadlineExceeded'])
      expect(sandboxRpcFailureAttributes({ _tag: reason })).toEqual({
        'sandbox.rpc.reason': reason,
      })
  })
})
