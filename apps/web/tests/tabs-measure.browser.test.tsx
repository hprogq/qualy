import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { UiProvider } from '@qualy/ui/provider'
import { Tabs, TabsList, TabsTrigger } from '@qualy/ui/tabs'
import '../src/app.css'

// How wide a tablist comes out.
//
// A tablist is as wide as the views it names. Sharing the row out equally
// instead - which two screens were doing, one of them on every screen size -
// pads the short names and crowds the long ones into their own edges, and it
// is the wider layout as well: four names that measure 302px together were
// being stretched to the full width of a phone.
//
// The widget's own list wraps by default, which is worse than it sounds: a
// segmented run is a fixed 36px tall, so a second row is folded into the
// first. Where the room genuinely runs out the row scrolls instead.

const NAMES = ['by item', 'by submission time', 'by participant', 'awaiting']

function Row({ width }: { width: number }) {
  return (
    <UiProvider scheme="light">
      <div style={{ width }}>
        <Tabs variant="segmented" value="0">
          <TabsList>
            {NAMES.map((name, i) => (
              <TabsTrigger key={name} value={String(i)}>
                {name}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
    </UiProvider>
  )
}

const settle = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

// each render appends its own tree, so read the most recent one
const latest = () => [...document.querySelectorAll('[data-slot="tabs"]')].at(-1)!
const list = () => latest().querySelector('[data-slot="tabs-list"]') as HTMLElement
const tabs = () => [...latest().querySelectorAll('[data-slot="tabs-trigger"]')]

describe('a tablist', () => {
  it('is as wide as the views it names, not as wide as the room', async () => {
    render(<Row width={1200} />)
    await settle()
    const box = list().getBoundingClientRect()
    expect(box.width).toBeLessThan(600)
    // each name at its own width, so they differ
    const widths = tabs().map((t) => Math.round(t.getBoundingClientRect().width))
    expect(new Set(widths).size).toBeGreaterThan(1)
  })

  it('keeps every name at its own width when the room is tight', async () => {
    render(<Row width={1200} />)
    await settle()
    const roomy = tabs().map((t) => Math.round(t.getBoundingClientRect().width))

    render(<Row width={200} />)
    await settle()
    const tight = tabs().map((t) => Math.round(t.getBoundingClientRect().width))
    expect(tight).toEqual(roomy)
  })

  it('scrolls rather than folding onto a second row', async () => {
    render(<Row width={200} />)
    await settle()
    const el = list()
    expect(getComputedStyle(el).flexWrap).toBe('nowrap')
    // one row of controls, at the height a segmented run always is
    expect(el.getBoundingClientRect().height).toBeCloseTo(36, 0)
    expect(el.scrollWidth).toBeGreaterThan(el.clientWidth)
  })
})
