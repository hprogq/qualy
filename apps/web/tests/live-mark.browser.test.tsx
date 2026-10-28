import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { UiProvider } from '@qualy/ui/provider'
import { LiveMark, liveStateOf, type LiveLine } from '@qualy/ui/live-mark'
import '../src/app.css'

// The mark a screen keeping time with something wears, from what its channel
// says of the line: nothing until the line has carried a word, live while
// it holds and across a planned renewal, reconnecting when - and only when -
// the channel counts the line as lost, and waiting while every seat is
// taken. Asserted on the mark's state, never on its words, which are the
// caller's.

function Probe({ line, hint }: { line: LiveLine | null; hint?: string }) {
  const state = liveStateOf(line)
  return (
    <UiProvider scheme="light">
      {state !== null && (
        <LiveMark state={state} data-testid="mark" {...(hint === undefined ? {} : { hint })}>
          {state}
        </LiveMark>
      )}
    </UiProvider>
  )
}

const said = () =>
  document.querySelector('[data-testid="mark"]')?.getAttribute('data-state') ?? 'nothing'

const OPEN = { live: true, lost: false, heard: true, waiting: false }
const BETWEEN = { live: false, lost: false, heard: true, waiting: false }
const LOST = { live: false, lost: true, heard: true, waiting: false }
const WAITING = { live: false, lost: true, heard: false, waiting: true }

describe('a live mark', () => {
  it('says nothing for a line that has never carried a word, lost or not', async () => {
    const screen = await render(
      <Probe line={{ live: false, lost: false, heard: false, waiting: false }} />,
    )
    expect(said()).toBe('nothing')
    // a first dial left unanswered: never live, so not reconnecting either
    await screen.rerender(
      <Probe line={{ live: false, lost: true, heard: false, waiting: false }} />,
    )
    await expect.poll(said).toBe('nothing')
    await screen.rerender(<Probe line={OPEN} />)
    await expect.poll(said).toBe('live')
    await expect.element(page.getByRole('status')).toBeVisible()
  })

  it('rides out a planned re-dial and says reconnecting only when the stream says lost', async () => {
    const screen = await render(<Probe line={OPEN} />)
    await expect.poll(said).toBe('live')
    // between a connection that lasted and its re-dial: nothing to say
    await screen.rerender(<Probe line={BETWEEN} />)
    await expect.poll(said).toBe('live')
    // the stream's own verdict, the moment it gives it
    await screen.rerender(<Probe line={LOST} />)
    await expect.poll(said).toBe('reconnecting')
    await screen.rerender(<Probe line={OPEN} />)
    await expect.poll(said).toBe('live')
  })

  it('says reconnecting for a line that dropped before the screen ever drew it live', async () => {
    // a connection that said hello and dropped at once: the screen never
    // rendered it open, but the line was heard and is lost
    await render(<Probe line={LOST} />)
    await expect.poll(said).toBe('reconnecting')
  })

  it('draws nothing for a screen that no longer follows', async () => {
    const screen = await render(<Probe line={OPEN} />)
    await expect.poll(said).toBe('live')
    await screen.rerender(<Probe line={null} />)
    await expect.poll(said).toBe('nothing')
  })

  it('says it is waiting for a seat, never live before it was heard, and reads its hint', async () => {
    // refused at the first dial: the reader may hold the seats in other tabs
    const screen = await render(<Probe line={WAITING} hint="seats are full" />)
    await expect.poll(said).toBe('waiting')
    // read with the state, for whoever cannot hover over it
    expect(page.getByTestId('mark').element().textContent).toContain('seats are full')
    // a seat came free, and the line said sync
    await screen.rerender(<Probe line={OPEN} hint="seats are full" />)
    await expect.poll(said).toBe('live')
  })
})
