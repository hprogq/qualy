import { Effect, Metric } from 'effect'
import { describe, expect, it } from 'vitest'
import { AttachmentNotFound, BackendUnavailable, UploadRefused } from '../src/errors.ts'
import { AuthorizationRefused, measured } from '../src/server/metrics.ts'

describe('storage operation failure metrics', () => {
  it('counts infrastructure errors and defects, but not expected refusals', async () => {
    const states = await Effect.runPromise(
      Effect.gen(function* () {
        const attempt = (effect: Effect.Effect<unknown, unknown>) =>
          Effect.exit(effect.pipe(measured('open')))
        yield* attempt(Effect.fail(new AttachmentNotFound()))
        yield* attempt(Effect.fail(new UploadRefused({ reason: 'file-too-large' })))
        yield* attempt(Effect.fail(new AuthorizationRefused({ reason: 'not-authorized' })))
        yield* attempt(Effect.fail(new BackendUnavailable('open')))
        yield* attempt(Effect.die(new Error('unexpected')))
        return yield* Metric.snapshot
      }).pipe(Effect.provideService(Metric.MetricRegistry, new Map())),
    )
    const failure = states.find((state) => state.id === 'qualy.storage.operation.failure')
    expect(failure?.attributes).toEqual({ operation: 'open' })
    expect(failure?.state).toMatchObject({ count: 2 })
  })
})
