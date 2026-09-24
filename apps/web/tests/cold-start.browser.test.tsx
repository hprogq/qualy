import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { commands, page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { BOOT_COPY_ID, bootFrame } from '@qualy/brand/boot'
import { Wordmark } from '@qualy/brand/wordmark'
import { ColdStart, LoadingScreen, PageLoading } from '@qualy/ui/spinner'
import { resolveInitialLocale, resolveLocale } from '@qualy/web-i18n'
import { bootstrapMessages } from '@qualy/web-i18n/bootstrap'
import '../src/app.css'

// The cold start as the browser runs it: the first frame index.html paints
// and the loading screen that takes it over stand in the same place to the
// pixel; a wait that ends inside the threshold never lights the loop; a
// wait that runs long says so, and one that runs too long offers a way
// out with the loop at rest. Asserted on geometry, animations and roles,
// never on pixels or copy. The view transition itself is the browser's;
// what is asserted here is what it is handed.

const copy = { loading: 'Loading', stillLoading: 'Still loading', retry: 'Retry' }

/** index.html as the source holds it, resolved against the suite's root, which is the app */
const shellSource = () => commands.readFile('index.html')

/**
 * index.html's first frame, as a fragment this page can carry: the static
 * style the source holds, and the element the build writes in place of the
 * source's marker, generated here from the same brand module the build uses
 */
const firstFrame = async () => {
  const style = /<style id="qualy-boot-style">([\s\S]*?)<\/style>/.exec(await shellSource())?.[1]
  if (style === undefined) throw new Error('index.html has no boot style')
  const sheet = document.createElement('style')
  sheet.id = 'qualy-boot-style'
  sheet.textContent = style
  document.head.append(sheet)
  const host = document.createElement('div')
  // the frame and, beside it, the watchdog's words, which the build writes
  // from the same table the application reads
  host.innerHTML =
    bootFrame().markup +
    `<script type="application/json" id="${BOOT_COPY_ID}">${JSON.stringify(bootstrapMessages)}</script>`
  document.body.prepend(...host.children)
  const lang = document.documentElement.lang
  return () => {
    sheet.remove()
    document.getElementById('qualy-boot')?.remove()
    document.getElementById(BOOT_COPY_ID)?.remove()
    // the boot script marks the root; the next test starts unmarked
    document.documentElement.lang = lang
    delete document.documentElement.dataset['locale']
    localStorage.removeItem('qualy.locale')
  }
}

/** what the watchdog's link says in the locale the boot script marked the root with */
const reloadName = () =>
  bootstrapMessages[document.documentElement.dataset['locale'] as keyof typeof bootstrapMessages]
    .reload

/** the boot script as the source holds it, run in this page */
const runBootScript = async () => {
  const script = /<script>([\s\S]*?)<\/script>/.exec(await shellSource())?.[1]
  if (script === undefined) throw new Error('index.html has no boot script')
  // eslint-disable-next-line typescript/no-implied-eval -- runs the boot script the page would
  new Function(script)()
}

/** when this page first painted, which is where the threshold counts from */
const firstPaintedAt = () =>
  performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0

/** a tree that claims the loading screen until told it is done, then shows a top bar's wordmark */
function Booting({ done }: { done: boolean }) {
  return (
    <ColdStart copy={copy}>
      {done ? (
        <main data-testid="app">
          <Wordmark height={14} title="Qualy" data-brand-wordmark="" />
        </main>
      ) : (
        <LoadingScreen />
      )}
    </ColdStart>
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

  it('counts the threshold from the first frame, and leaves without the loop when the wait ends inside it', async () => {
    let finish!: () => void
    function Screen() {
      const [done, setDone] = useState(false)
      finish = () => setDone(true)
      return <Booting done={done} />
    }
    // this page has been painted for far longer than the threshold, so on
    // the first screen the loop is due at once; a page whose scripts reached
    // React 250ms after its first paint would be handed 150
    const due = Math.max(0, 400 - (performance.now() - firstPaintedAt()))
    await render(<Screen />)
    await expect.element(page.getByRole('status')).toBeInTheDocument()
    const parts = [...overlay()!.querySelectorAll<SVGElement>('[data-seg]')]
    expect(parts).toHaveLength(8)
    for (const part of parts) {
      for (const animation of part.getAnimations()) {
        const timing = (animation.effect as KeyframeEffect).getTiming()
        expect(Number(timing.delay)).toBeGreaterThanOrEqual(0)
        expect(Math.abs(Number(timing.delay) - due)).toBeLessThan(60)
      }
    }
    // ready at 100ms: the screen settles and leaves
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
    expect(page.getByTestId('cold-start-hint').elements()).toHaveLength(0)

    vi.advanceTimersByTime(6000)
    await expect.element(page.getByTestId('cold-start-hint')).toBeInTheDocument()
    expect(page.getByRole('button', { name: copy.retry }).elements()).toHaveLength(0)

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

  it('flies the wordmark by its geometry on the first screen, and never hands the page to the browser', async () =>
    withMotion(async () => {
      const transitions = vi.spyOn(document, 'startViewTransition')
      // every layer that carries a wordmark in flight, as it is added
      const flights: HTMLElement[] = []
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (node instanceof HTMLElement && node.hasAttribute('data-cold-start-flight-layer')) {
              flights.push(node)
            }
          }
        }
      })
      observer.observe(document.body, { childList: true })
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
        const drawn = rectOf(overlay()!.querySelector('svg')!)
        finish()
        await vi.waitFor(() => expect(flights).toHaveLength(1), { timeout: 2000 })
        const [layer] = flights
        const destination = () => document.querySelector<SVGElement>('[data-brand-wordmark]')!
        // the copy takes off from exactly where the screen drew the wordmark,
        // over the page - the screen is already gone - with the top bar's
        // own wordmark hidden under it
        expect(parseFloat(layer!.style.left)).toBeCloseTo(drawn.left, 1)
        expect(parseFloat(layer!.style.top)).toBeCloseTo(drawn.top, 1)
        expect(parseFloat(layer!.style.width)).toBeCloseTo(drawn.width, 1)
        expect(overlay()).toBeNull()
        expect(document.documentElement.hasAttribute('data-cold-start-flight')).toBe(true)
        expect(getComputedStyle(destination()).visibility).toBe('hidden')
        // moved by its geometry, never by a transform: a transform is a
        // texture scaled on the compositor, drawn soft until the frame the
        // animation ends
        const [flight] = layer!.getAnimations()
        expect(flight).toBeDefined()
        const keyframes = (flight!.effect as KeyframeEffect).getKeyframes()
        for (const keyframe of keyframes) expect(keyframe['transform']).toBeUndefined()
        expect(parseFloat(String(keyframes[0]!['width']))).toBeCloseTo(drawn.width, 1)
        // it lands on the top bar's wordmark's own rectangle, and only then
        // gives way to it
        await vi.waitFor(
          () => expect(document.documentElement.hasAttribute('data-cold-start-flight')).toBe(false),
          { timeout: 2000 },
        )
        expect(layer!.isConnected).toBe(false)
        const at = rectOf(destination())
        expect(getComputedStyle(destination()).visibility).toBe('visible')
        expect(parseFloat(String(keyframes.at(-1)!['left']))).toBeCloseTo(at.left, 1)
        expect(parseFloat(String(keyframes.at(-1)!['top']))).toBeCloseTo(at.top, 1)
        expect(parseFloat(String(keyframes.at(-1)!['width']))).toBeCloseTo(at.width, 1)
        expect(parseFloat(String(keyframes.at(-1)!['height']))).toBeCloseTo(at.height, 1)
        // the browser's own transition machinery is never handed the page:
        // what it captured of it was wrong at every zoom but one
        expect(transitions).not.toHaveBeenCalled()

        // the manifest reloading after a sign-in: the screen comes back,
        // and goes without a flight
        restart()
        await vi.waitFor(() => expect(overlay()).not.toBeNull(), { timeout: 2000 })
        for (const part of overlay()!.querySelectorAll<SVGElement>('[data-seg]')) {
          for (const animation of part.getAnimations()) {
            expect((animation.effect as KeyframeEffect).getTiming().delay).toBe(400)
          }
        }
        finish()
        await vi.waitFor(() => expect(overlay()).toBeNull(), { timeout: 2000 })
        expect(flights).toHaveLength(1)
        expect(transitions).not.toHaveBeenCalled()
      } finally {
        observer.disconnect()
        transitions.mockRestore()
      }
    }))

  it('offers a reload from the first frame when nothing takes it over in time', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const restore = await firstFrame()
    try {
      await runBootScript()
      // the watchdog says nothing while the application may still arrive
      vi.advanceTimersByTime(19_000)
      expect(page.getByRole('link', { name: reloadName() }).elements()).toHaveLength(0)
      vi.advanceTimersByTime(1_000)
      const reload = page.getByRole('link', { name: reloadName() })
      await expect.element(reload).toBeVisible()
      // under the wordmark, inside the frame the application would have removed
      expect(document.querySelector('#qualy-boot p a')).toBe(reload.element())
    } finally {
      restore()
    }
  })

  it('says nothing once the application has taken the first frame down', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const restore = await firstFrame()
    try {
      await runBootScript()
      document.getElementById('qualy-boot')?.remove()
      vi.advanceTimersByTime(20_000)
      expect(page.getByRole('link', { name: reloadName() }).elements()).toHaveLength(0)
    } finally {
      restore()
    }
  })

  it('offers a reload at once when a file of the page fails to load before the application runs', async () => {
    const restore = await firstFrame()
    try {
      await runBootScript()
      const locale = document.documentElement.dataset['locale'] as keyof typeof bootstrapMessages
      // the entry script of a shell the browser cached, gone from the server
      // since: the error reaches the window in the capture phase
      const missing = document.createElement('script')
      missing.src = '/assets/index-gone.js'
      document.body.append(missing)
      try {
        const reload = page.getByRole('link', { name: bootstrapMessages[locale].reload })
        await expect.element(reload).toBeVisible()
        const note = document.querySelector('#qualy-boot p')
        expect(note?.textContent).toBe(
          bootstrapMessages[locale].assetFailedLead + bootstrapMessages[locale].reload,
        )
        // a second failure says nothing more
        document.body.append(
          Object.assign(document.createElement('script'), { src: '/assets/also-gone.js' }),
        )
        await new Promise((resolve) => setTimeout(resolve, 200))
        expect(document.querySelectorAll('#qualy-boot p')).toHaveLength(1)
      } finally {
        missing.remove()
        document.querySelector('script[src="/assets/also-gone.js"]')?.remove()
      }
    } finally {
      restore()
    }
  })

  it('resolves the locale once, before the first frame, and the application takes it from the root', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const restore = await firstFrame()
    try {
      // a stored preference: applied by the script, taken by the runtime
      localStorage.setItem('qualy.locale', 'en-US')
      await runBootScript()
      expect(document.documentElement.dataset['locale']).toBe('en-US')
      expect(document.documentElement.lang).toBe('en-US')
      expect(resolveInitialLocale()).toBe('en-US')
      // the mark is the answer, not the key: the runtime does not decide again
      localStorage.setItem('qualy.locale', 'zh-CN')
      expect(resolveInitialLocale()).toBe('en-US')
      // nothing stored: the browser's own languages, through the chain the
      // runtime would have walked
      localStorage.removeItem('qualy.locale')
      delete document.documentElement.dataset['locale']
      await runBootScript()
      expect(document.documentElement.dataset['locale']).toBe(
        resolveLocale({ preferred: navigator.languages }),
      )
      expect(document.documentElement.lang).toBe(document.documentElement.dataset['locale'])
      expect(resolveInitialLocale()).toBe(document.documentElement.dataset['locale'])
    } finally {
      restore()
    }
  })

  it('never draws a screen of its own inside a host, not even in its first render', async () => {
    // Every element added to the page while the tree mounts, read as it
    // lands: a screen that drew its own wordmark in its first render and
    // took it back a commit later was painted, for one frame, as a second
    // wordmark under the first - the host has to be known before the
    // first commit, not discovered after it.
    const strays: Element[] = []
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue
          const screens = node.matches('[role="status"]')
            ? [node]
            : [...node.querySelectorAll('[role="status"]')]
          for (const screen of screens) {
            if (
              !screen.hasAttribute('data-cold-start-phase') &&
              screen.querySelector('svg [data-seg]') !== null
            ) {
              strays.push(screen)
            }
          }
        }
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
    try {
      await render(<Booting done={false} />)
      await expect.element(page.getByRole('status')).toBeInTheDocument()
      observer.takeRecords()
      expect(strays).toEqual([])
      expect(overlay()).not.toBeNull()
    } finally {
      observer.disconnect()
    }
  })

  it('draws a plain screen when no host is mounted', async () => {
    await render(<LoadingScreen />)
    await expect.element(page.getByRole('status')).toBeInTheDocument()
    expect(overlay()).toBeNull()
    expect(document.querySelector('[role="status"] svg [data-seg="1-7"]')).not.toBeNull()
  })

  it('waits for the page under it as well, and only for a page that was loading under it', async () => {
    function Arriving({ stage }: { stage: 'app' | 'page' | 'done' }) {
      return (
        <ColdStart copy={copy}>
          {stage === 'app' ? (
            <LoadingScreen />
          ) : (
            <main data-testid="app">{stage === 'page' ? <PageLoading /> : <p>page</p>}</main>
          )}
        </ColdStart>
      )
    }
    const screen = await render(<Arriving stage="app" />)
    await expect.element(page.getByTestId('app')).not.toBeInTheDocument()
    expect(overlay()).not.toBeNull()
    // the application has arrived and its page is still on its way: the
    // screen stays, rather than flying off over a page that is not there
    await screen.rerender(<Arriving stage="page" />)
    await expect.element(page.getByTestId('app')).toBeInTheDocument()
    await new Promise((done) => setTimeout(done, 400))
    expect(overlay()).not.toBeNull()
    await screen.rerender(<Arriving stage="done" />)
    await vi.waitFor(() => expect(overlay()).toBeNull())
    // a page loading later, under no screen, holds nothing up
    await screen.rerender(<Arriving stage="page" />)
    await new Promise((done) => setTimeout(done, 100))
    expect(overlay()).toBeNull()
  })
})
