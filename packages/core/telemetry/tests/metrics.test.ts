import { describe, expect, it } from 'vitest'
import { Effect, Metric } from 'effect'
import { boundedCounter, boundedDurationHistogram, DURATION_BOUNDARIES } from '../src/metrics.ts'

// The cardinality guard, proven rather than promised.
//
// A metric label space is an invoice: every distinct combination is a series
// the backend stores forever. These tests feed the constructors exactly the
// values that must never become labels - a UUID, a user-typed string, an
// undeclared key - and read the registry back to show what actually got
// recorded.

const snapshotOf = <A>(program: Effect.Effect<A>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* program
      return yield* Metric.snapshot
    }).pipe(Effect.provideService(Metric.MetricRegistry, new Map())),
  )

describe('the bounded metric constructors', () => {
  it('keeps declared values and clamps everything else to other', async () => {
    const outcomes = boundedCounter('qualy_test.outcomes', {
      outcome: ['success', 'failure'],
    })
    const snapshot = await snapshotOf(
      Effect.gen(function* () {
        yield* outcomes({ outcome: 'success' })
        // the values the guard exists for: an id, freeform text
        yield* outcomes({ outcome: '9f1c0a52-0000-4000-8000-000000000000' })
        yield* outcomes({ outcome: 'DROP TABLE users' })
      }),
    )
    const values = snapshot
      .filter((state) => state.id === 'qualy_test.outcomes')
      .map((state) => state.attributes?.outcome)
      .sort()
    expect(values).toEqual(['other', 'success'])
  })

  it('drops attribute keys nobody declared', async () => {
    const counted = boundedCounter('qualy_test.narrow', { kind: ['a'] })
    const snapshot = await snapshotOf(
      counted({ kind: 'a', userId: 'u-123', tenantId: 't-456' } as never),
    )
    const state = snapshot.find((entry) => entry.id === 'qualy_test.narrow')!
    expect(Object.keys(state.attributes ?? {})).toEqual(['kind'])
  })

  it('bounds histogram labels the same way and declares seconds', async () => {
    const timed = boundedDurationHistogram(
      'qualy_test.duration',
      { job: ['sweep'] },
      DURATION_BOUNDARIES,
    )
    const snapshot = await snapshotOf(timed({ job: '/api/things/42?q=1' }, 0.05))
    const state = snapshot.find((entry) => entry.id === 'qualy_test.duration')!
    expect(state.attributes?.job).toBe('other')
    expect(state.attributes?.unit).toBe('s')
  })
})
