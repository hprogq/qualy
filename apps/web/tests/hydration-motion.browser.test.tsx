import { afterAll, beforeAll, expect, it } from 'vitest'
import { useState } from 'react'
import { flushSync } from 'react-dom'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { Drill, Portion, Reveal, Stagger, useEntryMotion } from '@qualy/ui/reveal'
import { commands, page } from 'vitest/browser'
import { render } from 'vitest-browser-react'

beforeAll(() => commands.emulateMedia({ reducedMotion: 'no-preference' }))
afterAll(() => commands.emulateMedia({ reducedMotion: 'reduce' }))

function Example() {
  const [view, setView] = useState(0)
  return (
    <div>
      <style>{'[data-portion-test] > span { display: block; height: 4px }'}</style>
      <button type="button" onClick={() => setView(view + 1)}>
        Open next view
      </button>
      <Reveal key={view}>
        <span data-entry="reveal">Content</span>
      </Reveal>
      <Stagger>
        <span data-entry="stagger">First item</span>
      </Stagger>
      <Drill move="in" drillKey="first">
        <span data-entry="drill">Details</span>
      </Drill>
      <div data-portion-test="" style={{ width: 200 }}>
        <Portion share={60} />
      </div>
    </div>
  )
}

it('keeps server-rendered entrances visible and animates newly opened content', async () => {
  await expect.poll(() => matchMedia('(prefers-reduced-motion: no-preference)').matches).toBe(true)
  const content = <Example />
  const host = document.createElement('div')
  document.body.append(host)
  host.innerHTML = renderToString(content)
  const entries = [...host.querySelectorAll('[data-entry]')].map((node) => node.parentElement!)
  const widths = host.querySelector('[data-portion-test] > span')!.getBoundingClientRect().width
  const errors: unknown[] = []
  const root = hydrateRoot(host, content, { onRecoverableError: (error) => errors.push(error) })
  try {
    const samples: number[] = []
    const started = performance.now()
    while (performance.now() - started < 400) {
      await new Promise(requestAnimationFrame)
      for (const element of entries) {
        samples.push(Number(getComputedStyle(element).opacity))
        expect(new DOMMatrixReadOnly(getComputedStyle(element).transform).m42).toBe(0)
      }
      expect(host.querySelector('[data-portion-test] > span')!.getBoundingClientRect().width).toBe(
        widths,
      )
    }
    expect(samples.length).toBeGreaterThan(0)
    expect(Math.min(...samples)).toBe(1)
    expect(errors).toEqual([])

    const revealOpacity = () =>
      Number(getComputedStyle(host.querySelector('[data-entry="reveal"]')!.parentElement!).opacity)
    flushSync(() => host.querySelector('button')!.click())
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      expect(revealOpacity()).toBeLessThan(1)
    }
    await expect.poll(revealOpacity).toBe(1)
  } finally {
    root.unmount()
    host.remove()
  }
})

it('keeps a horizontal drill inside its scrollport without removing the movement', async () => {
  function Navigation() {
    const [detail, setDetail] = useState(false)
    return (
      <>
        <button type="button" onClick={() => setDetail(!detail)}>
          Open detail
        </button>
        <div data-testid="drill-scrollport" style={{ width: 320, height: 240, overflow: 'auto' }}>
          <Drill move={detail ? 'in' : 'none'} drillKey={String(detail)}>
            <div data-testid="drill-content" style={{ height: 600 }}>
              Scrollable work
            </div>
          </Drill>
        </div>
      </>
    )
  }
  await expect.poll(() => matchMedia('(prefers-reduced-motion: no-preference)').matches).toBe(true)
  await render(<Navigation />)
  const scrollport = page.getByTestId('drill-scrollport').element()
  const open = page.getByRole('button', { name: 'Open detail' }).element() as HTMLButtonElement
  const travel = () => {
    const animated = page.getByTestId('drill-content').element().parentElement!
    return new DOMMatrixReadOnly(getComputedStyle(animated).transform).m41
  }
  const overflow = () => scrollport.scrollWidth - scrollport.clientWidth
  // Read the arrival in the same browser task as the commit. A Playwright
  // click round trip can outlast the entire transition on a loaded runner.
  flushSync(() => open.click())
  expect(travel()).toBeGreaterThan(0)
  const widths = [overflow()]
  await expect
    .poll(() => {
      widths.push(overflow())
      return travel()
    })
    .toBe(0)
  expect(Math.max(...widths)).toBeLessThanOrEqual(1)
  expect(scrollport.scrollHeight).toBeGreaterThan(scrollport.clientHeight)
  scrollport.scrollTop = 120
  expect(scrollport.scrollTop).toBe(120)
})

it('inherits the first-screen entrance decision when its body arrives after hydration', async () => {
  let release = () => {}
  function Screen() {
    const enter = useEntryMotion()
    const [ready, setReady] = useState(false)
    release = () => setReady(true)
    return (
      <div>
        {ready && (
          <Reveal enter={enter}>
            <span data-testid="late-body">Body</span>
          </Reveal>
        )}
      </div>
    )
  }
  const host = document.createElement('div')
  document.body.append(host)
  host.innerHTML = renderToString(<Screen />)
  const errors: unknown[] = []
  const root = hydrateRoot(host, <Screen />, { onRecoverableError: (error) => errors.push(error) })
  try {
    await new Promise(requestAnimationFrame)
    await new Promise(requestAnimationFrame)
    flushSync(() => release())
    const body = host.querySelector('[data-testid="late-body"]')!.parentElement!
    expect(getComputedStyle(body).opacity).toBe('1')
    expect(new DOMMatrixReadOnly(getComputedStyle(body).transform).m42).toBe(0)
    expect(errors).toEqual([])
  } finally {
    root.unmount()
    host.remove()
  }

  await render(<Screen />)
  flushSync(() => release())
  const body = page.getByTestId('late-body').element().parentElement!
  expect(Number(getComputedStyle(body).opacity)).toBeLessThan(1)
  await expect.poll(() => getComputedStyle(body).opacity).toBe('1')
})
