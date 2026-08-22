import { queryOptions, type QueryKey } from '@tanstack/react-query'
import { Effect } from 'effect'
import { isTransportError } from '@qualy/web-i18n'

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

// How long a failed read waits before it says so.
//
// The library retries three times with a growing delay, which is right for a
// screen that has no other answer to a failure. Every screen here does: a
// failed section renders what went wrong and a retry button, so the ladder
// only buys seven seconds of a spinner in front of a message the reader could
// have had at once, and a refusal the server means (a 4xx, a typed domain
// error) is not going to answer differently the third time.
//
// One retry is kept for the case the reader cannot see: a connection that
// dropped between here and the server, where the second attempt genuinely may
// succeed and nothing has been decided yet. Naming that case has to be
// positive: what runPromise rejects with is the failure itself, and every
// failure the api runtime can produce is tagged, the dropped connection
// included - it arrives as HttpClientError{reason: TransportError}. A
// predicate written as "no _tag" therefore retried the residue (defects and
// interrupts) and never the one case it was for.
export const retryQuery = (attempt: number, error: unknown) =>
  attempt < 1 && isTransportError(error)

/**
 * Query options whose `TError` is the effect's error type.
 *
 * The `Effect<A, E, never>` bound is deliberate: an effect that still needs
 * services cannot be run here, so a component cannot accidentally reach for
 * something the browser runtime does not provide.
 */
export const effectQueryOptions = <const Key extends QueryKey, A, E>(
  key: Key,
  make: () => Effect.Effect<A, E>,
  runtime: ApiRuntime = browserRuntime,
) =>
  queryOptions<A, E, A, Key>({
    queryKey: key,
    queryFn: ({ signal }) => runtime.runPromise(make(), { signal }),
  })

// --- the shape a page actually calls ---
//
// A derived client is a tree of functions returning effects; a page wants
// query options with a stable key. Rather than have every page repeat the key
// and the runtime, this walks the client once and pairs each endpoint with
// both, so a call site reads the way it always did and still carries the
// endpoint's own error type into TanStack.

// `any` in both positions on purpose: a method returning `Effect<A, E>` is not
// assignable to one returning `Effect<never, never>`, so a narrower bound makes
// every client fail the constraint and each endpoint infer as `never` - which
// surfaces at the call sites as "possibly undefined" rather than as a
// constraint error, miles from the cause.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EndpointFn = (...args: any[]) => Effect.Effect<any, any>

type Client = Record<string, Record<string, EndpointFn>>

type Bound<Fn> = Fn extends (...args: infer Args) => Effect.Effect<infer A, infer E>
  ? {
      /** query options carrying this endpoint's own success and failure types */
      queryOptions: (...args: Args) => ReturnType<typeof queryOptions<A, E, A, QueryKey>>
      /** where this endpoint's entries live, for invalidation */
      key: (...args: Partial<Args>) => QueryKey
    }
  : never

export type QueryUtils<C extends Client> = {
  [Group in keyof C]: { [Endpoint in keyof C[Group]]: Bound<C[Group][Endpoint]> } & {
    /** every entry of this group, for invalidating a whole domain at once */
    key: () => QueryKey
  }
}

/**
 * Runs one call, for a mutation.
 *
 * TanStack needs a promise from `mutationFn`, and this is the only place a
 * page is allowed to cross from an effect into one: doing it inline in a
 * component would spread `Effect.runPromise` through the whole ui.
 */
export const runMutation =
  (runtime: ApiRuntime = browserRuntime) =>
  <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
    runtime.runPromise(effect)

/**
 * Query utilities for a derived client.
 *
 * Enumerated rather than proxied, deliberately: a proxy answers every property
 * including the ones React and TanStack probe for, and the failure then
 * surfaces far from its cause. The client's shape is a finite tree, so walking
 * it once at startup is both cheaper and honest.
 */
export const createQueryUtils = <C extends Client>(
  client: C,
  runtime: ApiRuntime = browserRuntime,
): QueryUtils<C> => {
  const utils: Record<string, Record<string, unknown>> = {}
  for (const [group, endpoints] of Object.entries(client)) {
    const bound: Record<string, unknown> = { key: () => [group] }
    for (const [endpoint, call] of Object.entries(endpoints)) {
      if (typeof call !== 'function') continue
      // the argument is part of the key: two calls that differ by input are
      // different entries, and dropping it would serve one page's data to
      // another
      const keyOf = (args: readonly unknown[]) =>
        (args.length > 0 && args[0] !== undefined
          ? [group, endpoint, args[0]]
          : [group, endpoint]) as QueryKey
      bound[endpoint] = {
        queryOptions: (...args: never[]) =>
          effectQueryOptions(keyOf(args), () => call(...args), runtime),
        key: (...args: never[]) => keyOf(args),
      }
    }
    utils[group] = bound
  }
  return utils as QueryUtils<C>
}
