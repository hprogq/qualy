import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { commands, page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { ColdStart, LoadingScreen } from '@qualy/ui/spinner'
import '../src/app.css'

// The cold start as the browser runs it: the first frame index.html paints
// and the loading screen that takes it over stand in the same place to the
// pixel; a wait that ends inside the threshold never lights the loop; a
// wait that runs long says so, and one that runs too long offers a way
// out with the loop at rest. Asserted on geometry, animations and roles,
// never on pixels or copy. The view transition itself is the browser's;
// what is asserted here is what it is handed.

const copy = { loading: 'Loading', stillLoading: 'Still loading', retry: 'Retry' }

/** index.html's first frame, as a fragment this page can carry */
const firstFrame = async () => {
  // resolved against the suite's root, which is the app
  const html = await commands.readFile('index.html')
  const style = /<style id="qualy-boot-style">([\s\S]*?)<\/style>/.exec(html)?.[1]
  const boot = /(<div id="qualy-boot"[\s\S]*?<\/svg>\s*<\/div>\s*<\/div>)/.exec(html)?.[1]
  if (style === undefined || boot === undefined) throw new Error('index.html has no first frame')
  const sheet = document.createElement('style')
  sheet.id = 'qualy-boot-style'
  sheet.textContent = style
  document.head.append(sheet)
  const host = document.createElement('div')
  host.innerHTML = boot
  document.body.prepend(host.firstElementChild!)
  return () => {
    sheet.remove()
    document.getElementById('qualy-boot')?.remove()
  }
}

/** a tree that claims the loading screen until told it is done */
function Booting({ done }: { done: boolean }) {
  return (
    <>
      <ColdStart copy={copy} />
      {done ? <main data-testid="app" /> : <LoadingScreen />}
    </>
  )
}

const withMotion = async (body: () => Promise<void>) => {
  await commands.emulateMedia({ reducedMotion: 'no-preference' })
  try {
    await body()
  } finally {
    await commands.emulateMedia({ reducedMotion: 'reduce' })
  }
}

const overlay = () => document.querySelector<HTMLElement>('[data-cold-start-phase]')
const rectOf = (element: Element) => {
  const { left, top, width, height } = element.getBoundingClientRect()
  return { left, top, width, height }
}

afterEach(() => {
  vi.useRealTimers()
  document.documentElement.removeAttribute('data-cold-start')
})

describe('the cold start', () => {
  it('takes the first frame over in its exact place, and takes it down', async () => {
    const restore = await firstFrame()
    try {
      const placeholder = document.querySelector('#qualy-boot svg')!
      const before = rectOf(placeholder)
      expect(before.width).toBeGreaterThan(0)

      await render(<Booting done={false} />)
      await expect.element(page.getByRole('status')).toBeInTheDocument()
      const drawn = overlay()!.querySelector('svg')!
      const after = rectOf(drawn)
      for (const side of ['left', 'top', 'width', 'height'] as const) {
        expect(after[side]).toBeCloseTo(before[side], 1)
      }
      // the placeholder left in the same frame the overlay arrived
      expect(document.getElementById('qualy-boot')).toBeNull()
      expect(document.documentElement.hasAttribute('data-cold-start')).toBe(true)
    } finally {
      restore()
    }
  })

  it('lights the loop only after 400ms, and never when the wait ends before that', async () => {
    let finish!: () => void
    function Screen() {
      const [done, setDone] = useState(false)
      finish = () => setDone(true)
      return <Booting done={done} />
    }
    await render(<Screen />)
    await expect.element(page.getByRole('status')).toBeInTheDocument()
    const parts = [...overlay()!.querySelectorAll<SVGElement>('[data-seg]')]
    expect(parts).toHaveLength(8)
    // the loop is armed with the threshold as its delay: nothing has changed yet
    for (const part of parts) {
      for (const animation of part.getAnimations()) {
        expect((animation.effect as KeyframeEffect).getTiming().delay).toBe(400)
        expect(animation.currentTime).toBeLessThan(400)
      }
      expect(getComputedStyle(part).opacity).toBe('1')
    }
    // ready at 100ms: the screen settles and leaves, the loop never lit
    await new Promise((resolve) => setTimeout(resolve, 100))
    finish()
    await expect.element(page.getByTestId('app')).toBeInTheDocument()
    await vi.waitFor(() => expect(overlay()).toBeNull(), { timeout: 2000 })
    expect(document.documentElement.hasAttribute('data-cold-start')).toBe(false)
  })

  it('says so at six seconds and offers a way out at thirty, with the loop at rest', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await render(<Booting done={false} />)
    await expect.element(page.getByRole('status')).toBeInTheDocument()
    expect(await page.getByTestId('cold-start-hint').elements()).toHaveLength(0)

    vi.advanceTimersByTime(6000)
    await expect.element(page.getByTestId('cold-start-hint')).toBeInTheDocument()
    expect(await page.getByRole('button', { name: copy.retry }).elements()).toHaveLength(0)

    vi.advanceTimersByTime(24_000)
    await expect.element(page.getByRole('button', { name: copy.retry })).toBeVisible()
    expect(overlay()!.getAttribute('data-cold-start-phase')).toBe('stalled')
    // every part at full ink, no loop running
    await vi.waitFor(() => {
      for (const part of overlay()!.querySelectorAll<SVGElement>('[data-seg]')) {
        expect(getComputedStyle(part).opacity).toBe('1')
        for (const animation of part.getAnimations())
          expect(animation.playState).not.toBe('running')
      }
    })
  })

  it('flies only on the first screen; a later screen leaves by a fade', async () =>
    withMotion(async () => {
      const transitions = vi.spyOn(document, 'startViewTransition')
      try {
        let finish!: () => void
        let restart!: () => void
        function Screen() {
          const [done, setDone] = useState(false)
          finish = () => setDone(true)
          restart = () => setDone(false)
          return <Booting done={done} />
        }
        await render(<Screen />)
        await expect.element(page.getByRole('status')).toBeInTheDocument()
        finish()
        await vi.waitFor(() => expect(overlay()).toBeNull(), { timeout: 2000 })
        expect(transitions).toHaveBeenCalledTimes(1)

        // the manifest reloading after a sign-in: the screen comes back,
        // and goes without a flight
        restart()
        await vi.waitFor(() => expect(overlay()).not.toBeNull(), { timeout: 2000 })
        finish()
        await vi.waitFor(() => expect(overlay()).toBeNull(), { timeout: 2000 })
        expect(transitions).toHaveBeenCalledTimes(1)
      } finally {
        transitions.mockRestore()
      }
    }))

  it('draws a plain screen when no host is mounted', async () => {
    await render(<LoadingScreen />)
    await expect.element(page.getByRole('status')).toBeInTheDocument()
    expect(overlay()).toBeNull()
    expect(document.querySelector('[role="status"] svg [data-seg="1-7"]')).not.toBeNull()
  })
})
