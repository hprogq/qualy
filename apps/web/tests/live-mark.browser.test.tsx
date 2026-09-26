import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { UiProvider } from '@qualy/ui/provider'
import { LiveMark, useLiveState } from '@qualy/ui/live-mark'
import '../src/app.css'

// The mark a screen keeping time with something wears, from the flag of a
// connection that may flap: nothing until the line has carried anything,
// live while it holds, and reconnecting only once it has been down for
// longer than a planned redial takes. Asserted on the mark's state, never
// on its words, which are the caller's.

afterEach(() => {
  vi.useRealTimers()
})

function Probe({ live }: { live: boolean | null }) {
  const state = useLiveState(live)
  return (
    <UiProvider scheme="light">
      {state !== null && (
        <LiveMark state={state} data-testid="mark">
          {state}
        </LiveMark>
      )}
    </UiProvider>
  )
}

const said = () =>
  document.querySelector('[data-testid="mark"]')?.getAttribute('data-state') ?? 'nothing'

describe('a live mark', () => {
  it('says nothing until the line opens, and rides out a redial before saying it is lost', async () => {
    vi.useFakeTimers()
    const screen = await render(<Probe live={false} />)
    expect(said()).toBe('nothing')
    // down from the start: it has never been live, so it is not reconnecting
    vi.advanceTimersByTime(10_000)
    await expect.poll(said).toBe('nothing')

    await screen.rerender(<Probe live />)
    await expect.poll(said).toBe('live')
    await expect.element(page.getByRole('status')).toBeVisible()

    // a planned redial: three seconds and a handshake, and nothing said
    await screen.rerender(<Probe live={false} />)
    vi.advanceTimersByTime(4_000)
    await expect.poll(said).toBe('live')
    await screen.rerender(<Probe live />)
    vi.advanceTimersByTime(4_000)
    await expect.poll(said).toBe('live')

    // down for longer than that is worth a word, and back is back
    await screen.rerender(<Probe live={false} />)
    vi.advanceTimersByTime(6_000)
    await expect.poll(said).toBe('reconnecting')
    await screen.rerender(<Probe live />)
    await expect.poll(said).toBe('live')
  })

  it('draws nothing for a screen that no longer follows', async () => {
    const screen = await render(<Probe live />)
    await expect.poll(said).toBe('live')
    await screen.rerender(<Probe live={null} />)
    await expect.poll(said).toBe('nothing')
  })
})
