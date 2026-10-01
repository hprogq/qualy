import { Effect } from 'effect'
import { useApiMutation } from '@qualy/web-runtime'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { toast } from '@qualy/ui/toast'

type Failure =
  | { readonly _tag: 'EXAMPLE_CONFLICT'; readonly field: string }
  | { readonly _tag: 'ACCESS_DENIED' }

it('filters platform failures, preserves payloads and settles every action once', async () => {
  document.documentElement.dataset['locale'] = 'zh-CN'
  const business = vi.fn(),
    settled = vi.fn(),
    perCall = vi.fn()
  const notify = vi.spyOn(toast, 'error').mockReturnValue('test')
  const failure: Failure[] = [
    { _tag: 'ACCESS_DENIED' },
    { _tag: 'EXAMPLE_CONFLICT', field: 'email' },
  ]
  function Action() {
    const mutation = useApiMutation({
      mutationFn: (_variables: void) => Effect.fail(failure.shift()!),
      onError: (error) => {
        // The common refusal is removed from the callback type.
        const tag: 'EXAMPLE_CONFLICT' = error._tag
        business(tag, error.field)
      },
      onSettled: settled,
    })
    return (
      <button
        onClick={() => mutation.mutate(undefined, { onError: (error) => perCall(error.field) })}
      >
        Save
      </button>
    )
  }
  await render(
    <QueryClientProvider client={new QueryClient()}>
      <Action />
    </QueryClientProvider>,
  )
  await page.getByRole('button', { name: 'Save' }).click()
  await expect.poll(() => settled.mock.calls.length).toBe(1)
  expect(business).not.toHaveBeenCalled()
  expect(perCall).not.toHaveBeenCalled()
  expect(notify).toHaveBeenCalledTimes(1)
  await page.getByRole('button', { name: 'Save' }).click()
  await expect.poll(() => settled.mock.calls.length).toBe(2)
  expect(business).toHaveBeenCalledWith('EXAMPLE_CONFLICT', 'email')
  expect(perCall).toHaveBeenCalledWith('email')
  expect(notify).toHaveBeenCalledTimes(1)
  notify.mockRestore()
})
