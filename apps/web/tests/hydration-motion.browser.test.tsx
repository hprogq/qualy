import { afterEach, beforeEach, expect, it } from 'vitest'
import { useState } from 'react'
import { flushSync } from 'react-dom'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { Drill, Portion, Reveal, Stagger } from '@qualy/ui/reveal'
import { commands, page } from 'vitest/browser'
import { render } from 'vitest-browser-react'

beforeEach(() => commands.emulateMedia({ reducedMotion: 'no-preference' }))
afterEach(() => commands.emulateMedia({ reducedMotion: 'reduce' }))

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
  await commands.emulateMedia({ reducedMotion: 'no-preference' })
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
  try {
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
  } finally {
    await commands.emulateMedia({ reducedMotion: 'reduce' })
  }
})
