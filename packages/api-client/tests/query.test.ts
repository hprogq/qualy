import { QueryClient, type UseQueryOptions } from '@tanstack/react-query'
import { Effect, Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { effectQueryOptions } from '../src/effect/query.ts'

// M1b: does the error type survive the trip into TanStack Query, and does
// leaving a page actually cancel the request?
//
// Both matter for ADR 0003. If `TError` degrades to `Error`, the typed client
// bought nothing above the fetch call. If the signal is not bridged, every
// abandoned navigation leaves a request running to completion.

class LoadFailed extends Schema.TaggedErrorClass<LoadFailed>()('LoadFailed', {
  reason: Schema.String,
}) {}

class OtherFailure extends Schema.TaggedErrorClass<OtherFailure>()('OtherFailure', {
  detail: Schema.String,
}) {}

// @effect-diagnostics effect/missingEffectError:off
// The negative assertions below deliberately name a narrower error type than
// the effect can produce. That mismatch IS the assertion, and the expected
// type error beside it is what proves the channel is narrow.
describe('effect to tanstack query', () => {
  it('carries the effect error type into TError', () => {
    const options = effectQueryOptions(['tenant', 'a'] as const, () =>
      Effect.fail(new LoadFailed({ reason: 'nope' })).pipe(Effect.as({ slug: 'a' })),
    )

    // A type-level assertion. Assigning to the exact options type only
    // compiles while TError really is the effect's failure; the negative case
    // below is what proves the assertion is not vacuous.
    type Key = readonly ['tenant', 'a']
    const kept: UseQueryOptions<{ slug: string }, LoadFailed, { slug: string }, Key> = options
    expect(kept.queryKey).toEqual(['tenant', 'a'])

    // @ts-expect-error TError is LoadFailed, so a different failure must not fit
    const wrong: UseQueryOptions<{ slug: string }, OtherFailure, { slug: string }, Key> = options
    expect(wrong).toBeDefined()
  })

  it('surfaces the failure as a rejected query rather than a thrown defect', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const options = effectQueryOptions(['fails'] as const, () =>
      Effect.fail(new LoadFailed({ reason: 'nope' })),
    )
    await expect(client.fetchQuery(options)).rejects.toMatchObject({ _tag: 'LoadFailed' })
  })

  it('interrupts the effect when the query is cancelled', async () => {
    // the property that makes navigation cheap: TanStack aborts, the fiber is
    // interrupted, and the finalizer runs. Without the signal bridge the sleep
    // below would run to completion.
    let released = false
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const options = effectQueryOptions(['slow'] as const, () =>
      Effect.acquireRelease(Effect.succeed('handle'), () =>
        Effect.sync(() => {
          released = true
        }),
      ).pipe(
        Effect.andThen(Effect.sleep('5 seconds')),
        Effect.scoped,
      ),
    )

    const pending = client.fetchQuery(options).catch(() => 'cancelled')
    await new Promise((resolve) => setTimeout(resolve, 50))
    await client.cancelQueries({ queryKey: ['slow'] })
    await pending

    // the finalizer ran, which is only true if the fiber was actually
    // interrupted rather than left to finish
    expect(released).toBe(true)
  })
})
