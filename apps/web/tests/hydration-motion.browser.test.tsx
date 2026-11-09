import { afterEach, beforeEach, expect, it } from 'vitest'
import { useState } from 'react'
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

    host.querySelector('button')!.click()
    const arrivals: number[] = []
    const clicked = performance.now()
    while (performance.now() - clicked < 120) {
      await new Promise(requestAnimationFrame)
      arrivals.push(
        Number(
          getComputedStyle(host.querySelector('[data-entry="reveal"]')!.parentElement!).opacity,
        ),
      )
    }
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      expect(Math.min(...arrivals)).toBeLessThan(1)
    }
    await expect
      .poll(() =>
        Number(
          getComputedStyle(host.querySelector('[data-entry="reveal"]')!.parentElement!).opacity,
        ),
      )
      .toBe(1)
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
    await page.getByRole('button', { name: 'Open detail' }).click()
    const scrollport = page.getByTestId('drill-scrollport').element()
    const samples: { extra: number; travel: number }[] = []
    const started = performance.now()
    while (performance.now() - started < 280) {
      await new Promise(requestAnimationFrame)
      const animated = page.getByTestId('drill-content').element().parentElement!
      samples.push({
        extra: scrollport.scrollWidth - scrollport.clientWidth,
        travel: new DOMMatrixReadOnly(getComputedStyle(animated).transform).m41,
      })
    }
    expect(samples.some((sample) => sample.travel > 0)).toBe(true)
    expect(Math.max(...samples.map((sample) => sample.extra))).toBeLessThanOrEqual(1)
    expect(scrollport.scrollHeight).toBeGreaterThan(scrollport.clientHeight)
    scrollport.scrollTop = 120
    expect(scrollport.scrollTop).toBe(120)
  } finally {
    await commands.emulateMedia({ reducedMotion: 'reduce' })
  }
})
