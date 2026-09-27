import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { useState } from 'react'
import { Effect } from 'effect'
import { AsyncSection } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@qualy/ui/dialog'
import { ResourceState } from '@qualy/ui/resource-state'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@qualy/ui/sheet'
import { LoadFailure } from '@qualy/web-runtime'
import { emptyManifest, fakeClient, renderScreen } from './support/harness.tsx'

/** one pane whose record is not there, as a page says it, told nothing about where it stands */
const LoadFailureProbe = () => (
  <LoadFailure
    size="section"
    failure={{ kind: 'missing', title: 'gone', description: 'it went', retryable: false }}
  />
)

// What a screen, or one pane of it, says when the thing it is about cannot
// be shown: a heading that says what happened, a sentence that says what to
// do, and only the ways out that can help. Asserted on the state it names
// and on its shape, never on its words - those are the caller's.

/** the screen, once the runtime under it has its manifest */
const mount = async (children: React.ReactNode) => {
  const screen = await renderScreen({
    client: fakeClient({ app: { getManifest: () => Effect.succeed(emptyManifest()) } }),
    children: <div data-testid="mounted">{children}</div>,
  })
  await expect.element(page.getByTestId('mounted')).toBeInTheDocument()
  return screen
}

describe('a page that cannot be shown', () => {
  const Gone = () => (
    <ResourceState
      kind="missing"
      title="gone"
      description="it went"
      actions={[
        <Button key="again">again</Button>,
        <Button key="back" variant="outline">
          back
        </Button>,
      ]}
    />
  )

  it('says what happened first, and takes the reader there', async () => {
    await mount(<Gone />)
    const heading = page.getByRole('heading', { level: 1, name: 'gone' })
    await expect.element(heading).toBeVisible()
    await expect
      .element(page.getByTestId('mounted').element().querySelector<HTMLElement>('[data-state]'))
      .toHaveAttribute('data-state', 'missing')
    // a screen reader starts at what happened, not at a link to nothing
    await vi.waitFor(() => expect(document.activeElement).toBe(heading.element()))
  })

  it('stands a third of the way down the room it is given, not in its corner', async () => {
    await mount(
      <div style={{ display: 'flex', flexDirection: 'column', height: 600 }} data-testid="room">
        <Gone />
      </div>,
    )
    const room = page.getByTestId('room').element().getBoundingClientRect()
    const heading = page.getByRole('heading', { name: 'gone' }).element().getBoundingClientRect()
    const middle = (heading.top + heading.bottom) / 2 - room.top
    expect(middle).toBeGreaterThan(room.height * 0.2)
    expect(middle).toBeLessThan(room.height * 0.5)
  })

  it('stacks its ways out across a phone, the first on top, and side by side on a desk', async () => {
    await page.viewport(390, 844)
    try {
      await mount(<Gone />)
      const first = page.getByRole('button', { name: 'again' }).element().getBoundingClientRect()
      const second = page.getByRole('button', { name: 'back' }).element().getBoundingClientRect()
      expect(first.bottom).toBeLessThanOrEqual(second.top)
      // the width of the column, for a thumb anywhere along it
      expect(first.width).toBeGreaterThan(300)
      expect(second.width).toBeCloseTo(first.width, 0)
      // a large phone is a phone too: the shell around it has folded at the
      // same width, so the state does not keep a desk's row of buttons there
      await page.viewport(600, 900)
      await vi.waitFor(() => {
        const top = page.getByRole('button', { name: 'again' }).element().getBoundingClientRect()
        const under = page.getByRole('button', { name: 'back' }).element().getBoundingClientRect()
        expect(top.bottom).toBeLessThanOrEqual(under.top)
        expect(top.width).toBeGreaterThan(400)
      })
      await page.viewport(1280, 800)
      await vi.waitFor(() => {
        const wide = page.getByRole('button', { name: 'again' }).element().getBoundingClientRect()
        const beside = page.getByRole('button', { name: 'back' }).element().getBoundingClientRect()
        expect(wide.top).toBeCloseTo(beside.top, 0)
        expect(wide.right).toBeLessThanOrEqual(beside.left)
      })
    } finally {
      await page.viewport(1280, 800)
    }
  })
})

describe('a section that could not load', () => {
  function Section({
    error,
    framed = false,
  }: {
    error: Parameters<typeof AsyncSection>[0]['error']
    framed?: boolean
  }) {
    const [retried, setRetried] = useState(0)
    return (
      <div data-testid="section" data-retried={retried}>
        <AsyncSection
          pending={false}
          error={error}
          framed={framed}
          loadingLabel="loading"
          retryLabel="retry"
          onRetry={() => setRetried((count) => count + 1)}
        >
          <p>content</p>
        </AsyncSection>
      </div>
    )
  }
  const failed = {
    kind: 'failed',
    title: 'could not load',
    description: 'try',
    retryable: true,
  } as const
  /** what the pane has put in its region for a reader to hear, at one urgency */
  const spoken = (live: 'polite' | 'assertive') =>
    page
      .getByTestId('section')
      .element()
      .querySelector<HTMLElement>(`[data-slot="resource-state-live"][data-live="${live}"]`)
  const drawnState = () =>
    getComputedStyle(
      page.getByTestId('section').element().querySelector('[data-slot="resource-state"]')!,
    )

  it('draws no second edge inside the card it stands in, and a card of its own on bare ground', async () => {
    const { unmount } = await mount(<Section error={failed} />)
    await expect.element(page.getByRole('heading', { name: 'could not load' })).toBeVisible()
    expect(drawnState().borderStyle).not.toBe('dashed')
    expect(drawnState().boxShadow).toBe('none')
    await unmount()
    await mount(<Section error={failed} framed />)
    await expect.element(page.getByRole('heading', { name: 'could not load' })).toBeVisible()
    expect(drawnState().borderStyle).not.toBe('dashed')
    expect(drawnState().boxShadow).not.toBe('none')
  })

  it('says what happened in a heading, and keeps focus where it was', async () => {
    function Searching() {
      // the reader is typing somewhere else on the screen when the pane fails
      const [broken, setBroken] = useState(false)
      return (
        <>
          <input
            aria-label="search"
            ref={(input) => input?.focus()}
            onChange={() => setBroken(true)}
          />
          {broken && <Section error={failed} />}
        </>
      )
    }
    await mount(<Searching />)
    await page.getByRole('textbox', { name: 'search' }).fill('x')
    await expect.element(page.getByTestId('section')).toBeVisible()
    await expect
      .element(
        page
          .getByTestId('section')
          .element()
          .querySelector<HTMLElement>('[data-slot="resource-state"]'),
      )
      .toHaveAttribute('data-size', 'section')
    // ranked under the title of the card it stands in, and no louder than it
    const heading = page.getByRole('heading', { level: 3, name: 'could not load' })
    await expect.element(heading).toBeVisible()
    expect(Number.parseFloat(getComputedStyle(heading.element()).fontSize)).toBeLessThanOrEqual(14)
    // one pane of a screen does not pull the reader out of what they are doing,
    // and is heard politely rather than read out over it
    expect(document.activeElement).toBe(page.getByRole('textbox', { name: 'search' }).element())
    const polite = spoken('polite')
    // the region is there, empty, before its words: words that arrive with
    // the region are not heard by every reader
    expect(polite?.textContent).toBe('')
    await vi.waitFor(() => expect(polite?.textContent).toContain('could not load'))
    expect(polite?.textContent).toContain('try')
    expect(spoken('assertive')?.textContent).toBe('')
    // the pane itself is no live region, or it would be heard twice
    expect(
      page
        .getByTestId('section')
        .element()
        .querySelector('[data-slot="resource-state"]')
        ?.getAttribute('role'),
    ).toBeNull()
  })

  it('ranks its heading under the page on bare ground, and under the dialog inside one', async () => {
    const framedOne = await mount(<Section error={failed} framed />)
    await expect
      .element(page.getByRole('heading', { level: 2, name: 'could not load' }))
      .toBeVisible()
    await framedOne.unmount()
    // told nothing, a pane takes the rank under the title of whatever it
    // stands on: the page's own, or a dialog's or a sheet's
    const bare = await mount(<LoadFailureProbe />)
    await expect.element(page.getByRole('heading', { level: 2, name: 'gone' })).toBeVisible()
    await bare.unmount()
    const inDialog = await mount(
      <Dialog open>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>dialog</DialogTitle>
          </DialogHeader>
          <LoadFailureProbe />
        </DialogContent>
      </Dialog>,
    )
    await expect.element(page.getByRole('heading', { level: 2, name: 'dialog' })).toBeVisible()
    await expect.element(page.getByRole('heading', { level: 3, name: 'gone' })).toBeVisible()
    await inDialog.unmount()
    await mount(
      <Sheet open>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>sheet</SheetTitle>
          </SheetHeader>
          <LoadFailureProbe />
        </SheetContent>
      </Sheet>,
    )
    await expect.element(page.getByRole('heading', { level: 2, name: 'sheet' })).toBeVisible()
    await expect.element(page.getByRole('heading', { level: 3, name: 'gone' })).toBeVisible()
  })

  it('interrupts only when a retry comes back with the same failure, and keeps the retry in hand', async () => {
    function Retried() {
      const [retrying, setRetrying] = useState(false)
      return (
        <div data-testid="section">
          <AsyncSection
            pending={false}
            error={failed}
            retrying={retrying}
            loadingLabel="loading"
            retryLabel="retry"
            onRetry={() => {
              setRetrying(true)
              setTimeout(() => setRetrying(false), 300)
            }}
          >
            <p>content</p>
          </AsyncSection>
        </div>
      )
    }
    await mount(<Retried />)
    await vi.waitFor(() => expect(spoken('polite')?.textContent).toContain('could not load'))
    // every time words go into the interrupting region, as a reader hears it
    let interruptions = 0
    new MutationObserver(() => {
      if (spoken('assertive')?.textContent !== '') interruptions += 1
    }).observe(spoken('assertive')!, { childList: true, subtree: true, characterData: true })
    // pressed from the keyboard, as a reader who cannot see the pane would
    const retry = page.getByRole('button', { name: 'retry' })
    retry.element().focus()
    await userEvent.keyboard('{Enter}')
    await expect.element(retry).toHaveAttribute('aria-busy', 'true')
    // still asking: the focus stays where the key was pressed, and nothing
    // interrupts anybody yet
    expect(document.activeElement).toBe(retry.element())
    expect(interruptions).toBe(0)
    // pressed again while asking, it does not ask twice
    await userEvent.keyboard('{Enter}')
    // the same answer again: said at once, over whatever was being read
    await vi.waitFor(() => expect(spoken('assertive')?.textContent).toContain('could not load'))
    expect(interruptions).toBe(1)
    expect(document.activeElement).toBe(retry.element())
    // and every such answer is news again
    await userEvent.keyboard('{Enter}')
    await vi.waitFor(() => expect(interruptions).toBe(2))
    expect(spoken('assertive')?.textContent).toContain('could not load')
  })

  it('hands the focus back to the retry when the pane loaded again before failing again', async () => {
    function Reloaded() {
      const [pending, setPending] = useState(false)
      return (
        <div data-testid="section">
          <AsyncSection
            pending={pending}
            error={failed}
            loadingLabel="loading"
            retryLabel="retry"
            onRetry={() => {
              setPending(true)
              setTimeout(() => setPending(false), 200)
            }}
          >
            <p>content</p>
          </AsyncSection>
        </div>
      )
    }
    await mount(<Reloaded />)
    page.getByRole('button', { name: 'retry' }).element().focus()
    await userEvent.keyboard('{Enter}')
    await expect.element(page.getByRole('status', { name: 'loading' })).toBeInTheDocument()
    await vi.waitFor(() => expect(spoken('assertive')?.textContent).toContain('could not load'))
    expect(document.activeElement).toBe(page.getByRole('button', { name: 'retry' }).element())
  })

  it('offers a retry only where one can help', async () => {
    const { unmount } = await mount(
      <Section
        error={{ kind: 'denied', title: 'not yours', description: 'ask', retryable: false }}
      />,
    )
    await expect.element(page.getByRole('heading', { name: 'not yours' })).toBeVisible()
    expect(page.getByRole('button', { name: 'retry' }).elements()).toHaveLength(0)
    await unmount()
    // a caller still handing over one sentence keeps the retry it had, and
    // the sentence stays the line it was written as: no heading made of it
    await mount(<Section error="could not load." />)
    await expect
      .element(page.getByTestId('section').getByText('could not load', { exact: true }))
      .toBeVisible()
    expect(page.getByRole('heading').elements()).toHaveLength(0)
    await page.getByRole('button', { name: 'retry' }).click()
    await expect.element(page.getByTestId('section')).toHaveAttribute('data-retried', '1')
  })
})
