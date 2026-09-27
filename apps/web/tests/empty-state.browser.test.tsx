import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { InboxIcon } from 'lucide-react'
import { CheckboxGroup, Field } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { UiProvider } from '@qualy/ui/provider'
import { Blank } from '@qualy/ui/screen'
import { TreeSelect } from '@qualy/ui/tree-select'
import '../src/app.css'

// The empty state in its two sizes. A screen's is tall and framed, the
// answer to what half a page is for. A dialog's says the same three things -
// what happened, why, where to go - in the dialog's own measure: no frame,
// a floor rather than a screenful, and type a step under the dialog's title.
// Asserted on geometry and computed style, never on the words.

const REM = 16

function Both() {
  return (
    <UiProvider scheme="light">
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
        <div data-testid="dialog-body" style={{ width: 440 }}>
          <Blank
            size="compact"
            icon={<InboxIcon />}
            title="nothing to adjust"
            description="their grants have lapsed"
            action={<Button variant="outline">see changes</Button>}
          />
        </div>
        <div data-testid="screen-half" style={{ width: 440 }}>
          <Blank icon={<InboxIcon />} title="nothing chosen" description="pick one on the left" />
        </div>
      </div>
    </UiProvider>
  )
}

const stateIn = (host: string) =>
  page.getByTestId(host).element().querySelector<HTMLElement>('[data-slot="empty"]')!

describe('an empty state inside a dialog', () => {
  it('keeps the dialog’s measure, where a screen’s is tall and framed', async () => {
    await render(<Both />)
    await expect.element(page.getByRole('button', { name: 'see changes' })).toBeVisible()

    const compact = stateIn('dialog-body')
    const screen = stateIn('screen-half')
    expect(compact.getAttribute('data-size')).toBe('compact')
    expect(screen.getAttribute('data-size')).toBe('default')

    // a floor that keeps it from collapsing to a line, and no screenful
    const height = compact.getBoundingClientRect().height
    expect(height).toBeGreaterThanOrEqual(10 * REM)
    expect(height).toBeLessThan(22 * REM)
    expect(screen.getBoundingClientRect().height).toBeGreaterThanOrEqual(22 * REM)
    // no frame of its own inside the dialog's
    expect(getComputedStyle(compact).borderTopWidth).toBe('0px')
    expect(getComputedStyle(screen).borderTopWidth).toBe('1px')

    // a step under the screen's title and glyph
    const titleSize = (state: HTMLElement) =>
      parseFloat(getComputedStyle(state.querySelector('[data-slot="empty-title"]')!).fontSize)
    const glyph = (state: HTMLElement) =>
      state.querySelector('[data-slot="empty-icon"] svg')!.getBoundingClientRect().width
    expect(titleSize(compact)).toBeLessThan(titleSize(screen))
    expect(glyph(compact)).toBeLessThan(glyph(screen))

    // the way out sits inside the state, under what it says
    const action = page.getByRole('button', { name: 'see changes' }).element()
    expect(compact.contains(action)).toBe(true)
    const said = compact.querySelector('[data-slot="empty-description"]')!
    expect(action.getBoundingClientRect().top).toBeGreaterThan(said.getBoundingClientRect().bottom)
  })
})

// A field that picks from a set, with nothing in the set: it answers where
// its choices would have stood, with what is missing in the field's own
// type, why underneath, and the way out. It used to leave a line of small
// grey type under the label. A group of boxes draws the field's box itself;
// a tree is kept in its caller's scrolling frame, and takes that frame as
// its box rather than drawing a second one four pixels inside it.
describe('a picker with nothing to pick from', () => {
  it('answers in the field’s own place, not in a stray note', async () => {
    await render(
      <UiProvider scheme="light">
        <div style={{ display: 'grid', gap: 24, width: 440 }}>
          <Field label="name">{(id) => <Input id={id} />}</Field>
          <div
            data-testid="tree"
            // the frame every caller keeps a tree in, at a height it is given
            style={{ border: '1px solid var(--q-border)', padding: 4, height: 256 }}
          >
            <TreeSelect
              value={[]}
              onChange={() => {}}
              nodes={[]}
              emptyLabel="no units"
              emptyHint="ask for a scope"
              emptyAction={<Button variant="outline">open units</Button>}
            />
          </div>
          <div data-testid="boxes">
            <CheckboxGroup
              legend="kinds"
              options={[]}
              selected={[]}
              onChange={() => {}}
              emptyLabel="no kinds"
              emptyHint="turn one on first"
            />
          </div>
        </div>
      </UiProvider>,
    )
    await expect.element(page.getByRole('button', { name: 'open units' })).toBeVisible()
    const answer = (host: string) =>
      page.getByTestId(host).element().querySelector<HTMLElement>('[data-slot="empty-field"]')!
    for (const host of ['tree', 'boxes']) {
      const field = answer(host)
      expect(field, host).not.toBeNull()
      expect(field.querySelector('[data-slot="empty-field-icon"] svg'), host).not.toBeNull()
      // what is missing in the field's own type, the why a step under it
      const size = (slot: string) =>
        parseFloat(getComputedStyle(field.querySelector(`[data-slot="${slot}"]`)!).fontSize)
      expect(size('empty-field-title'), host).toBeGreaterThanOrEqual(14)
      expect(size('empty-field-hint'), host).toBeLessThan(size('empty-field-title'))
    }

    // the boxes: the field's own measure, drawn as a box of its own
    const boxes = answer('boxes')
    expect(boxes.getBoundingClientRect().width).toBe(440)
    expect(boxes.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    expect(getComputedStyle(boxes).borderTopWidth).toBe('1px')
    expect(getComputedStyle(boxes).borderTopColor).not.toBe('rgba(0, 0, 0, 0)')
    // under its legend at the distance a field's label keeps from its control
    const legend = page.getByTestId('boxes').element().querySelector('legend')!
    const label = page.getByText('name', { exact: true }).element()
    const control = page.getByRole('textbox').element()
    const labelGap = control.getBoundingClientRect().top - label.getBoundingClientRect().bottom
    expect(labelGap).toBe(12)
    expect(boxes.getBoundingClientRect().top - legend.getBoundingClientRect().bottom).toBe(labelGap)
    // the legend is the heading; the answer under it is not a second one
    const weight = (element: Element) => Number(getComputedStyle(element).fontWeight)
    expect(weight(boxes.querySelector('[data-slot="empty-field-title"]')!)).toBeLessThan(
      weight(legend),
    )

    // the tree: one edge, its frame's - no border or ground of its own
    const tree = answer('tree')
    expect(getComputedStyle(tree).borderTopWidth).toBe('0px')
    expect(getComputedStyle(tree).backgroundColor).toBe('rgba(0, 0, 0, 0)')
    // and it stands in the middle of the height the frame gives it
    const frame = page.getByTestId('tree').element().getBoundingClientRect()
    const words = tree.querySelector('[data-slot="empty-field-title"]')!.getBoundingClientRect()
    expect(words.top - frame.top).toBeGreaterThan(64)
    expect(Math.abs(words.top - frame.top - (frame.bottom - words.bottom))).toBeLessThan(48)
    // the way out sits inside the answer
    expect(tree.contains(page.getByRole('button', { name: 'open units' }).element())).toBe(true)
  })
})
