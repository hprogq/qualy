import { expect, it } from 'vitest'
import { useState } from 'react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { Drill, Portion, Reveal, Stagger } from '@qualy/ui/reveal'

function Example() {
  const [view, setView] = useState(0)
  return (
    <div>
      <style>{'.portion { display: block; height: 4px }'}</style>
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
      <div style={{ width: 200 }}>
        <Portion share={60} className="portion" />
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
  const widths = host.querySelector('.portion')!.getBoundingClientRect().width
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
      expect(host.querySelector('.portion')!.getBoundingClientRect().width).toBe(widths)
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
