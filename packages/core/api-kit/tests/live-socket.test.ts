import { Effect, Queue, Stream } from 'effect'
import { Socket } from 'effect/socket'
import { describe, expect, it } from 'vitest'
import { LIVE_CLOSE, LIVE_PONG, liveCloseVerdict } from '../src/live-socket.ts'
import { serveLiveSocket, type LiveSocketOptions } from '../src/live-socket-server.ts'

// The serving half of a live channel, over a socket held in memory: what it
// says first, what it says while the page is there, and every way it lets
// the page go. A frame the page sends is offered to the queue; what the
// server writes is kept in order.

type Inbound = string | Uint8Array | { readonly close: number }

const memorySocket = () => {
  const inbound = Effect.runSync(Queue.unbounded<Inbound>())
  const written: (string | Socket.CloseEvent)[] = []
  const socket = Socket.make({
    reader: Effect.succeed({
      pull: Effect.flatMap(Queue.take(inbound), (item) =>
        typeof item === 'object' && 'close' in item
          ? Effect.fail(
              new Socket.SocketError({ reason: new Socket.SocketCloseError({ code: item.close }) }),
            )
          : Effect.succeed([item] as const),
      ),
      upgrade: () => Effect.void,
    }),
    writer: Effect.succeed({
      write: (chunk: Uint8Array | string | Socket.CloseEvent) =>
        Effect.sync(() => {
          if (typeof chunk === 'string' || Socket.isCloseEvent(chunk)) written.push(chunk)
        }),
      writeAll: (chunks: readonly (Uint8Array | string)[]) =>
        Effect.sync(() => {
          for (const chunk of chunks) if (typeof chunk === 'string') written.push(chunk)
        }),
    }),
  })
  return {
    socket,
    send: (frame: Inbound) => Effect.runSync(Queue.offer(inbound, frame)),
    written,
    /** the words written, the close excluded */
    words: () =>
      written.filter((chunk) => typeof chunk === 'string').map((chunk) => JSON.parse(chunk).kind),
    closed: () => written.find(Socket.isCloseEvent),
  }
}

const serve = (socket: Socket.Socket, options: Partial<LiveSocketOptions<{ kind: string }>> = {}) =>
  Effect.runPromise(
    Effect.scoped(
      serveLiveSocket(socket, {
        messages: Stream.never,
        sync: { kind: 'sync' },
        lifetime: '1 hour',
        heartbeatMs: 40,
        silenceMs: 150,
        ...options,
      }),
    ),
  )

describe('serving a live channel', () => {
  it('says sync before anything else, then the wake-ups, and heartbeats between', async () => {
    const memory = memorySocket()
    const ending = serve(memory.socket, {
      messages: Stream.make({ kind: 'item-changed' }, { kind: 'phase-changed' }).pipe(
        Stream.concat(Stream.never),
      ),
      lifetime: '200 millis',
    })
    // the page answers every heartbeat
    const answering = setInterval(() => memory.send(LIVE_PONG), 30)
    try {
      expect(await ending).toEqual({ by: 'server', code: LIVE_CLOSE.renew, reason: 'renew' })
    } finally {
      clearInterval(answering)
    }
    const words = memory.words()
    expect(words.slice(0, 3)).toEqual(['sync', 'item-changed', 'phase-changed'])
    expect(words.slice(3).length).toBeGreaterThanOrEqual(2)
    expect(new Set(words.slice(3))).toEqual(new Set(['heartbeat']))
    expect(memory.closed()?.code).toBe(LIVE_CLOSE.renew)
  })

  it('lets a page go that stops answering heartbeats', async () => {
    const memory = memorySocket()
    const ending = await serve(memory.socket)
    expect(ending).toEqual({ by: 'server', code: LIVE_CLOSE.unresponsive, reason: 'no answer' })
    expect(memory.closed()?.code).toBe(LIVE_CLOSE.unresponsive)
  })

  it.each([
    ['anything but a pong', '{"kind":"sync"}', LIVE_CLOSE.policy],
    ['a binary frame', new Uint8Array([1, 2, 3]), LIVE_CLOSE.unsupportedData],
    ['a frame past the limit', 'p'.repeat(65), LIVE_CLOSE.tooBig],
  ])('ends the connection on %s', async (_, frame, code) => {
    const memory = memorySocket()
    const ending = serve(memory.socket)
    memory.send(frame)
    expect((await ending).code).toBe(code)
    expect(memory.closed()?.code).toBe(code)
  })

  it('ends with whatever a recheck refuses, and as a fault when the recheck fails', async () => {
    const refused = memorySocket()
    const answering = setInterval(() => refused.send(LIVE_PONG), 30)
    try {
      expect(
        await serve(refused.socket, {
          recheck: {
            every: '60 millis',
            check: Effect.succeed({ code: LIVE_CLOSE.forbidden, reason: 'forbidden' }),
          },
        }),
      ).toEqual({ by: 'server', code: LIVE_CLOSE.forbidden, reason: 'forbidden' })

      const broken = memorySocket()
      expect(
        await serve(broken.socket, {
          recheck: { every: '60 millis', check: Effect.die(new Error('database gone')) },
        }),
      ).toEqual({ by: 'server', code: LIVE_CLOSE.internal, reason: 'recheck' })
    } finally {
      clearInterval(answering)
    }
  })

  it('reports a page that closed or dropped by the code it said', async () => {
    const memory = memorySocket()
    const ending = serve(memory.socket)
    memory.send({ close: 1001 })
    expect(await ending).toEqual({ by: 'client', code: 1001 })
    // the server writes no close of its own over one the page made
    expect(memory.closed()).toBeUndefined()
  })
})

describe('what a page does about a close', () => {
  it.each([
    [LIVE_CLOSE.renew, 'renew'],
    [LIVE_CLOSE.quota, 'quota'],
    [LIVE_CLOSE.unauthenticated, 'unauthenticated'],
    [LIVE_CLOSE.forbidden, 'forbidden'],
    [LIVE_CLOSE.unsupported, 'unsupported'],
    [LIVE_CLOSE.goingAway, 'retry'],
    [1006, 'retry'],
    [LIVE_CLOSE.unresponsive, 'retry'],
    [LIVE_CLOSE.policy, 'retry'],
    [LIVE_CLOSE.internal, 'retry'],
  ])('reads %i as %s', (code, verdict) => {
    expect(liveCloseVerdict(code)).toBe(verdict)
  })
})
