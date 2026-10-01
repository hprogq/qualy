import { Effect } from 'effect'
import { expect, it } from 'vitest'
import type { ApiMutationOptions } from '../src/index.tsx'

type Platform = { readonly _tag: 'ACCESS_DENIED' }
type Conflict = { readonly _tag: 'EXAMPLE_CONFLICT'; readonly field: string }

it('requires a use-case callback only when the endpoint has use-case failures', () => {
  const commonOnly: ApiMutationOptions<number, Platform> = {
    mutationFn: () => Effect.fail({ _tag: 'ACCESS_DENIED' }),
  }
  const endpoint: ApiMutationOptions<number, Platform | Conflict> = {
    mutationFn: () => Effect.fail({ _tag: 'EXAMPLE_CONFLICT', field: 'email' }),
    onError: (failure) => {
      const tag: 'EXAMPLE_CONFLICT' = failure._tag
      expect(tag).toBe('EXAMPLE_CONFLICT')
      expect(failure.field).toBe('email')
    },
  }
  // @ts-expect-error an endpoint's use-case failures need an explicit policy
  const missing: ApiMutationOptions<number, Platform | Conflict> = {
    mutationFn: endpoint.mutationFn,
  }
  const forbidden: ApiMutationOptions<number, Platform> = {
    mutationFn: commonOnly.mutationFn,
    // @ts-expect-error platform failures are never exposed to use-case onError
    onError: () => {},
  }
  expect(commonOnly.onError).toBeUndefined()
  expect(missing.onError).toBeUndefined()
  expect(forbidden.mutationFn).toBe(commonOnly.mutationFn)
})
