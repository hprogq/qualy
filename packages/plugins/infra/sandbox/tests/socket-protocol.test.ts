import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { Effect, Layer, Logger, Schema } from 'effect'
import { NodeSocket } from '@effect/platform-node'
import { Rpc, RpcClient, RpcGroup, RpcSerialization } from 'effect/rpc'
import { describe, expect, it } from 'vitest'
import { sandboxRpcProtocolLayer } from '@qualy/sandbox-rpc'

const ProbeRpcs = RpcGroup.make(Rpc.make('Probe', { success: Schema.String }))

const peer = async (options: { readonly silentFirst: boolean }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-rpc-heartbeat-'))
  const socketPath = path.join(dir, 'peer.sock')
  const sockets = new Set<net.Socket>()
  let connections = 0
  let pings = 0
  let requests = 0
  const server = net.createServer((socket) => {
    const connection = ++connections
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => undefined)
    let buffer = ''
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      for (let newline; (newline = buffer.indexOf('\n')) >= 0;) {
        const message = JSON.parse(buffer.slice(0, newline)) as { _tag: string; id: string }
        buffer = buffer.slice(newline + 1)
        if (message._tag === 'Ping') pings += 1
        if (message._tag === 'Request') requests += 1
        if (options.silentFirst && connection === 1) continue
        if (message._tag === 'Ping') socket.write('{"_tag":"Pong"}\n')
        else if (message._tag === 'Request')
          socket.write(
            `${JSON.stringify({
              _tag: 'Exit',
              requestId: message.id,
              exit: { _tag: 'Success', value: 'ready' },
            })}\n`,
          )
      }
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, resolve)
  })
  return {
    socketPath,
    stats: () => ({ connections, pings, requests }),
    close: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      fs.rmSync(dir, { force: true, recursive: true })
    },
  }
}

const protocol = (socketPath: string) =>
  sandboxRpcProtocolLayer('authoring').pipe(
    Layer.provide(NodeSocket.layerNet({ path: socketPath }).pipe(Layer.orDie)),
    Layer.provide(RpcSerialization.layerNdjson),
  )

describe('sandbox heartbeat over a real Unix socket', () => {
  it('keeps an idle healthy connection through multiple heartbeat ticks', async () => {
    const server = await peer({ silentFirst: false })
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* RpcClient.make(ProbeRpcs)
            expect(yield* client.Probe()).toBe('ready')
            yield* Effect.sleep(11_000)
            expect(yield* client.Probe()).toBe('ready')
            expect(server.stats().connections).toBe(1)
            expect(server.stats().pings).toBeGreaterThanOrEqual(2)
          }),
        ).pipe(Effect.provide(protocol(server.socketPath))),
      )
    } finally {
      await server.close()
    }
  }, 20_000)

  it('fails a silent peer, logs the cause, then accepts a new call after reconnecting', async () => {
    const server = await peer({ silentFirst: true })
    const messages: string[] = []
    const logger = Logger.make((entry) => messages.push(String(entry.message)))
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* RpcClient.make(ProbeRpcs)
            const began = performance.now()
            const failure = yield* Effect.flip(client.Probe())
            expect(performance.now() - began).toBeGreaterThanOrEqual(15_000)
            expect(failure.reason._tag).toBe('SocketReadError')
            expect(server.stats().pings).toBeGreaterThanOrEqual(2)
            expect(messages).toContain('sandbox RPC heartbeat timed out')
            // Only the next independent call is made after reconnection; the
            // failed call was not replayed, and its cached error must clear.
            yield* Effect.sleep(1_000)
            expect(yield* client.Probe()).toBe('ready')
            expect(server.stats().connections).toBe(2)
            expect(server.stats().requests).toBe(2)
          }),
        ).pipe(
          Effect.provide(
            protocol(server.socketPath).pipe(Layer.provideMerge(Logger.layer([logger]))),
          ),
        ),
      )
    } finally {
      await server.close()
    }
  }, 27_000)
})
