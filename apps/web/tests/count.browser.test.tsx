import { expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { UiProvider } from '@qualy/ui/provider'
import { Count } from '@qualy/ui/count'
import { Chip, ChipGroup } from '@qualy/ui/chip'
import { Tabs, TabsList, TabsTrigger } from '@qualy/ui/tabs'
import '../src/app.css'

// A count has to be legible on every ground it rides.
//
// The same component sits on the selected segment (a pale ground), on a
// resting one, and on a chosen chip - which in this product is near-black.
// Any pinned pair of colours is invisible on one of the three, which is how
// two of these ended up with no styling at all and one with a ground that
// would have disappeared the moment a chip was picked. So the ground is a
// wash of whatever ink the label is already using, and this asserts that it
// really does follow.

const settle = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

/** how far the count's ground is from the surface it sits on, 0 = invisible */
function contrastOf(el: Element) {
  const own = getComputedStyle(el).backgroundColor
  // a transparent wash of the current ink always states an alpha; a ground
  // that resolved to nothing at all would not
  const alpha = /\/\s*([\d.]+)\s*\)/.exec(own)?.[1]
  return alpha === undefined ? 0 : Number(alpha)
}

it('keeps its ground on every surface a label puts it on', async () => {
  render(
    <UiProvider scheme="light">
      <Tabs variant="segmented" value="a">
        <TabsList>
          <TabsTrigger value="a">
            picked<Count>2</Count>
          </TabsTrigger>
          <TabsTrigger value="b">
            resting<Count>7</Count>
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <ChipGroup value="x" onChange={() => {}}>
        <Chip value="x">
          chosen<Count>3</Count>
        </Chip>
        <Chip value="y">
          plain<Count>9</Count>
        </Chip>
      </ChipGroup>
    </UiProvider>,
  )
  await settle()
  const counts = [...document.querySelectorAll('[data-slot="count"]')]
  expect(counts).toHaveLength(4)
  for (const count of counts) {
    expect(contrastOf(count)).toBeGreaterThan(0)
    // and its ink is the label's, not a colour of its own
    expect(getComputedStyle(count).color).toBe(getComputedStyle(count.parentElement!).color)
  }
  // the chosen chip is the one a pinned ground would vanish on: its ink is
  // the light one, so its wash must be light too
  expect(getComputedStyle(counts[2]!).backgroundColor).not.toBe(
    getComputedStyle(counts[3]!).backgroundColor,
  )
})

it('reserves a digit of room before the number arrives', async () => {
  render(
    <UiProvider scheme="light">
      <p>
        empty<Count>{''}</Count>
      </p>
    </UiProvider>,
  )
  await settle()
  const count = document.querySelector('[data-slot="count"]')!
  expect(count.getBoundingClientRect().width).toBeGreaterThan(8)
})
