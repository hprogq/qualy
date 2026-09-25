import { Effect, Fiber, Stream } from 'effect'
import { describe, expect, it } from 'vitest'
import { connectionLedger } from '../src/live/connections.ts'

// A batch's event stream is the one request meant to stay open, and nothing
// bounded how many one session could hold or how long one outlived the
// session that opened it. A stream past either bound is refused with the one
// event that tells a page to read again; the page then polls.

const REFUSED = 'refused'
const opened = (ledger: ReturnType<typeof connectionLedger>, sessionId: string) =>
  Effect.forkChild(
    Stream.runCollect(ledger.admit(sessionId, Stream.never, Stream.succeed(REFUSED))),
  )

describe('the live stream ledger', () => {
  it('holds each session to its share and the process to its total', async () => {
    const answer = await Effect.runPromise(
      Effect.gen(function* () {
        const ledger = connectionLedger({ perSession: 2, total: 3, lifetime: '1 hour' })
        const first = yield* opened(ledger, 'a')
        yield* opened(ledger, 'a')
        yield* Effect.yieldNow
        // a third for the same session is refused at once
        const third = yield* Stream.runCollect(
          ledger.admit('a', Stream.never, Stream.succeed(REFUSED)),
        )
        // another session still has room, until the process has none
        yield* opened(ledger, 'b')
        yield* Effect.yieldNow
        const past = yield* Stream.runCollect(
          ledger.admit('c', Stream.never, Stream.succeed(REFUSED)),
        )
        const heldBefore = ledger.open()
        // a closed stream gives its place back
        yield* Fiber.interrupt(first)
        const heldAfter = ledger.open('a')
        return { third, past, heldBefore, heldAfter, total: ledger.open() }
      }),
    )
    expect(answer.third).toEqual([REFUSED])
    expect(answer.past).toEqual([REFUSED])
    expect(answer.heldBefore).toBe(3)
    expect(answer.heldAfter).toBe(1)
    expect(answer.total).toBe(2)
  })

  it('ends a stream once its lifetime is up, and gives its place back', async () => {
    const answer = await Effect.runPromise(
      Effect.gen(function* () {
        const ledger = connectionLedger({ perSession: 1, total: 10, lifetime: '50 millis' })
        const ended = yield* Stream.runCollect(
          ledger.admit('a', Stream.never, Stream.succeed(REFUSED)),
        )
        return { ended, open: ledger.open('a') }
      }),
    )
    expect(answer.ended).toEqual([])
    expect(answer.open).toBe(0)
  })
})
