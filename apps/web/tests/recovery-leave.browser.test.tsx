import { Effect } from 'effect'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { UiProvider } from '@qualy/ui/provider'
import { SessionRecoveryGate } from '../../../packages/web/runtime/src/session/session-recovery-gate.tsx'
import { recovering } from '../../../packages/web/runtime/src/session/session-recovery.ts'
import { apiError, emptyManifest } from './support/harness.tsx'
import '../src/app.css'

it('keeps recovery, pending calls and drafts when leaving is cancelled', async () => {
  document.documentElement.dataset['locale'] = 'zh-CN'
  const cache = new QueryClient()
  const manifestKey = ['test', 'manifest']
  const shown = { ...emptyManifest(), viewer: 'authenticated' as const, identity: 'reader' }
  cache.setQueryData(manifestKey, shown)
  cache.setQueryData(['test', 'draft'], 'preserved')
  const leave = vi.fn() // A cancelled native navigation leaves this tree mounted.
  let returned = false
  const askManifest = () => Promise.resolve(returned ? shown : emptyManifest())
  const view = await render(
    <UiProvider scheme="light">
      <QueryClientProvider client={cache}>
        <input aria-label="draft" defaultValue="half a sentence" />
        <SessionRecoveryGate
          manifestKey={manifestKey}
          askManifest={askManifest}
          onFreeze={() => undefined}
          onLeave={leave}
        />
      </QueryClientProvider>
    </UiProvider>,
  )
  let calls = 0
  let settled = false
  const pending = recovering(() => {
    calls++
    return Effect.runPromise(
      calls === 1 ? Effect.fail(apiError('SESSION_EXPIRED')) : Effect.succeed('saved'),
    )
  }).then((value) => {
    settled = true
    return value
  })
  await expect
    .element(page.getByTestId('session-recovery'))
    .toHaveAttribute('data-state', 'expired')
  await page.getByTestId('session-sign-out').click()
  expect(leave).toHaveBeenCalledOnce()
  expect(settled).toBe(false)
  expect(cache.getQueryData(['test', 'draft'])).toBe('preserved')
  expect(document.querySelector<HTMLInputElement>('[aria-label="draft"]')?.value).toBe(
    'half a sentence',
  )
  await expect
    .element(page.getByTestId('session-recovery'))
    .toHaveAttribute('data-state', 'expired')
  returned = true
  window.dispatchEvent(new Event('focus'))
  await expect.poll(() => settled).toBe(true)
  expect(await pending).toBe('saved')
  expect(calls).toBe(2)
  await view.unmount()
})
