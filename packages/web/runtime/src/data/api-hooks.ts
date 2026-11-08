import { useCallback } from 'react'
import { useMutation, type UseMutationOptions } from '@tanstack/react-query'
import { Effect } from 'effect'
import type { HttpApi } from 'effect/http-api'
import { toast } from '@qualy/ui/toast'
import { isUseCaseApiFailure, type UseCaseApiFailure } from '@qualy/web-i18n'
import { captureDiagnostic, captureException } from '@qualy/browser-observability'
import { handlePlatformFailure, type RateLimit } from './mutation-failure.ts'
import { useRuntime } from '../runtime-context.tsx'
import type { ClientOf } from './api.ts'
import { browserRuntime, unrecoveredRuntime, runMutation, type QueryUtils } from './api-query.ts'

/** the typed client for an api definition a plugin declares as a constant */
export function useApi<Api extends HttpApi.Constraint>(api: Api): ClientOf<Api> {
  return useRuntime().clientFor(api) as ClientOf<Api>
}

/**
 * Turns one call into a promise, for a mutation.
 *
 * TanStack needs a promise from `mutationFn`, and this is the only crossing a
 * component is offered: doing it inline would spread `Effect.runPromise`
 * through the whole ui and throw away each endpoint's failure type at every
 * one of those lines.
 */
export const useRunApi = (options: { recoverSession?: boolean } = {}) =>
  runMutation(options.recoverSession === false ? unrecoveredRuntime : browserRuntime)

export type ApiMutationOptions<A, E, V = void, C = unknown> = Omit<
  UseMutationOptions<A, E, V, C>,
  'mutationFn' | 'onError'
> & {
  /** One request Effect, or a Promise workflow running each request through useRunApi.
   * Promise workflows declare E explicitly because Promise has no rejection type.
   */
  mutationFn: (variables: V) => Effect.Effect<A, E> | Promise<A>
  /** Explicit opt-in for forms that disable an action during its cooldown. */
  onRateLimited?: (limit: RateLimit) => void
} & ([NoInfer<UseCaseApiFailure<E>>] extends [never]
    ? { onError?: never }
    : {
        onError: NonNullable<UseMutationOptions<A, NoInfer<UseCaseApiFailure<E>>, V, C>['onError']>
      })

export interface PlatformFailureOptions {
  /** Put the platform message in the surface instead of the default toast. */
  readonly notify?: (message: string, code: string) => void
  readonly onRateLimited?: (limit: RateLimit) => void
}

const presentPlatformFailure = (error: unknown, options: PlatformFailureOptions = {}) =>
  handlePlatformFailure(error, {
    notify:
      options.notify ??
      ((message, code) => {
        toast.error(message, { id: `platform:${code}` })
      }),
    diagnose: (code) => captureDiagnostic(code),
    capture: (failure) => captureException(failure),
    ...(options.onRateLimited === undefined ? {} : { onRateLimited: options.onRateLimited }),
  })

/** Platform policy for a Promise workflow that cannot use useApiMutation. */
export const useHandlePlatformFailure = () =>
  useCallback(
    (error: unknown, options?: PlatformFailureOptions) => presentPlatformFailure(error, options),
    [],
  )

/** Platform policy lives here; use cases receive only their declared failures. */
export function useApiMutation<A, E, V = void, C = unknown>(
  options: ApiMutationOptions<A, E, V, C>,
  runtimeOptions: { recoverSession?: boolean } = {},
) {
  const runtime = runtimeOptions.recoverSession === false ? unrecoveredRuntime : browserRuntime
  const { onError, onRateLimited, ...mutation } = options
  const result = useMutation<A, E, V, C>({
    ...mutation,
    mutationFn: (variables) => {
      const work = options.mutationFn(variables)
      // A Promise workflow owns its individual request crossings. Recovering
      // the whole workflow would replay writes that already succeeded.
      return Effect.isEffect(work) ? runtime.runPromise(work) : work
    },
    onError: (error, variables, result, context) => {
      if (
        presentPlatformFailure(error, { ...(onRateLimited === undefined ? {} : { onRateLimited }) })
      )
        return
      // Preserve the real failure in mutation state/onSettled. Only the use
      // case callback receives the union filtered at this runtime boundary.
      return onError?.(error as UseCaseApiFailure<E>, variables, result, context)
    },
  })
  // TanStack also accepts callbacks on mutate/mutateAsync. Keep that entry
  // point behind the same filter; platform policy still runs only once above.
  type CallOptions = Omit<import('@tanstack/react-query').MutateOptions<A, E, V, C>, 'onError'> & {
    onError?: import('@tanstack/react-query').MutateOptions<
      A,
      UseCaseApiFailure<E>,
      V,
      C
    >['onError']
  }
  const callbacks = useCallback(
    (call?: CallOptions) =>
      call === undefined
        ? undefined
        : {
            ...call,
            onError: (
              error: E,
              variables: V,
              value: C | undefined,
              context: import('@tanstack/react-query').MutationFunctionContext,
            ) => {
              if (isUseCaseApiFailure(error)) call.onError?.(error, variables, value, context)
            },
          },
    [],
  )
  const { mutate, mutateAsync } = result
  const invoke = useCallback(
    (variables: V, call?: CallOptions) => mutate(variables, callbacks(call)),
    [mutate, callbacks],
  )
  const invokeAsync = useCallback(
    (variables: V, call?: CallOptions) => mutateAsync(variables, callbacks(call)),
    [mutateAsync, callbacks],
  )
  return {
    ...result,
    mutate: invoke,
    mutateAsync: invokeAsync,
  }
}

/** query utilities for an api definition, memoised per definition */
export function useApiQuery<Api extends HttpApi.Constraint>(api: Api): QueryUtils<ClientOf<Api>> {
  return useRuntime().utilsFor(api) as QueryUtils<ClientOf<Api>>
}
