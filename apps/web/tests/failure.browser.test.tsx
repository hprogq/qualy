import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { useState } from 'react'
import { Failure } from '../src/Failure.tsx'
import { emptyManifest, fakeClient, renderScreen } from './support/harness.tsx'
import { Effect } from 'effect'

// A page that failed to load, and a press on retry: seen as pressed, and a
// failure that comes back from it seen as a new answer rather than nothing.

describe('a failure with a way to retry', () => {
  it('answers the press at once, and comes back visibly when the retry fails too', async () => {
    const retried = vi.fn()
    function Failing() {
      // a retry that fails: a fresh notice in the same place, as the boundary draws it
      const [attempt, setAttempt] = useState(0)
      return (
        <Failure
          key={attempt}
          message="page failed"
          onRetry={() => {
            retried()
            setAttempt((n) => n + 1)
          }}
        />
      )
    }
    renderScreen({
      client: fakeClient({ app: { getManifest: () => Effect.succeed(emptyManifest()) } }),
      children: <Failing />,
    })
    const again = page.getByRole('button')
    await expect.element(again).toBeVisible()
    expect(document.querySelector('[role="alert"]')!.hasAttribute('data-again')).toBe(false)
    await again.click()
    // pressed: busy before anything else happens
    await expect.element(again).toHaveAttribute('aria-busy', 'true')
    await vi.waitFor(() => expect(retried).toHaveBeenCalledTimes(1))
    // and the notice that came back says it is the answer to that press
    await vi.waitFor(() =>
      expect(document.querySelector('[role="alert"]')!.getAttribute('data-again')).toBe('true'),
    )
  })
})
