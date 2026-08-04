import { queryOptions, type QueryKey } from '@tanstack/react-query'
import { Effect } from 'effect'

// `Effect<A, E>` has an error type; `Promise<A>` does not, so the moment a
// page calls `Effect.runPromise` the failure type is gone and TanStack Query
// infers `TError = Error`. Everything HttpApi bought on the client is thrown
// away at that line.
//
// So pages never run effects. They call this, which carries `E` across into
// the query's `TError` and hands the query's AbortSignal to the fiber, so
// leaving a page actually cancels the request rather than leaving it to
// resolve into a cache nobody reads.

/** the single runtime the browser runs effects on, built once */
export interface ApiRuntime {
  runPromise<A, E>(effect: Effect.Effect<A, E>, options?: { signal?: AbortSignal }): Promise<A>
}

export const browserRuntime: ApiRuntime = {
  runPromise: (effect, options) => Effect.runPromise(effect, { signal: options?.signal }),
}

/**
 * Query options whose `TError` is the effect's error type.
 *
 * The `Effect<A, E, never>` bound is deliberate: an effect that still needs
 * services cannot be run here, so a component cannot accidentally reach for
 * something the browser runtime does not provide.
 */
export const effectQueryOptions = <
  const Key extends QueryKey,
  A,
  E,
>(
  key: Key,
  make: () => Effect.Effect<A, E>,
  runtime: ApiRuntime = browserRuntime,
) =>
  queryOptions<A, E, A, Key>({
    queryKey: key,
    queryFn: ({ signal }) => runtime.runPromise(make(), { signal }),
  })
