import { Effect, Exit, Scope } from 'effect'
import { describe, expect, it } from 'vitest'
import { connectionLedger } from '../src/live/connections.ts'

// A batch's live channel is the one connection meant to stay open, and
// nothing would bound how many one session could hold. A connection past
// either bound is refused, holding nothing; the page then polls.

const limits = { perSession: 2, total: 3, lifetime: '1 hour', recheck: '1 hour' } as const

describe('the live connection ledger', () => {
  it('holds each session to its share and the process to its total', async () => {
    const answer = await Effect.runPromise(
      Effect.gen(function* () {
        const ledger = connectionLedger(limits)
        const first = yield* Scope.make()
        const a1 = yield* Scope.provide(ledger.admit('a'), first)
        const a2 = yield* Scope.provide(ledger.admit('a'), yield* Scope.make())
        // a third for the same session is refused at once
        const a3 = yield* Effect.scoped(ledger.admit('a'))
        // another session still has room, until the process has none
        const b1 = yield* Scope.provide(ledger.admit('b'), yield* Scope.make())
        const c1 = yield* Effect.scoped(ledger.admit('c'))
        const heldBefore = ledger.open()
        // a closed connection gives its seat back
        yield* Scope.close(first, Exit.void)
        return { a1, a2, a3, b1, c1, heldBefore, heldA: ledger.open('a'), total: ledger.open() }
      }),
    )
    expect(answer.a1).toEqual({ admitted: true })
    expect(answer.a2).toEqual({ admitted: true })
    expect(answer.a3).toEqual({ admitted: false, reason: 'session' })
    expect(answer.b1).toEqual({ admitted: true })
    expect(answer.c1).toEqual({ admitted: false, reason: 'capacity' })
    expect(answer.heldBefore).toBe(3)
    expect(answer.heldA).toBe(1)
    expect(answer.total).toBe(2)
  })

  it('counts nothing for a refusal, and releases an admitted seat once', async () => {
    const answer = await Effect.runPromise(
      Effect.gen(function* () {
        const ledger = connectionLedger({ ...limits, perSession: 1 })
        const held = yield* Scope.make()
        yield* Scope.provide(ledger.admit('a'), held)
        // refused, and its scope closing gives back nothing it never took
        const refused = yield* Effect.scoped(ledger.admit('a'))
        const whileHeld = ledger.open('a')
        // a scope closed twice runs its finalizer once
        yield* Scope.close(held, Exit.void)
        yield* Scope.close(held, Exit.void)
        // an interrupted connection gives its seat back as well
        const interrupted = yield* Scope.make()
        yield* Scope.provide(ledger.admit('b'), interrupted)
        yield* Scope.close(interrupted, Exit.interrupt(0))
        return { refused, whileHeld, after: ledger.open(), a: ledger.open('a') }
      }),
    )
    expect(answer.refused).toEqual({ admitted: false, reason: 'session' })
    expect(answer.whileHeld).toBe(1)
    expect(answer.after).toBe(0)
    expect(answer.a).toBe(0)
  })
})
