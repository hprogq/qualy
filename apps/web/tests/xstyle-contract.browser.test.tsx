import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import * as stylex from '@stylexjs/stylex'
import { UiProvider } from '@qualy/ui/provider'
import { Empty } from '@qualy/ui/empty'
import { PersonCell } from '@qualy/ui/person'
import { Blank } from '@qualy/ui/screen'
import '../src/app.css'

// The xstyle contract: a caller's StyleX composes over a product
// component's base styles property by property, last one wins. This is the
// shared layer's official extension seat, so the resolution order is pinned
// on computed results - if a refactor ever spreads xstyle before the base,
// callers everywhere lose their overrides silently.

const caller = stylex.create({
  tighter: { padding: 24 },
  wider: { gap: 20 },
  shorter: { minHeight: '10rem' },
})

const mount = (ui: React.ReactNode) => render(<UiProvider scheme="light">{ui}</UiProvider>)

/** the computed value of `property` on the first `selector` match, once it exists */
const computed = (selector: string, property: string) => () => {
  const element = document.querySelector(selector)
  return element === null ? null : getComputedStyle(element).getPropertyValue(property)
}

describe('xstyle composes over component base styles', () => {
  it('a caller override beats the base value and untouched properties survive', async () => {
    mount(<Empty xstyle={caller.tighter}>空</Empty>)
    // base padding is 48px; the caller said 24px
    await expect.poll(computed('[data-slot="empty"]', 'padding-top')).toBe('24px')
    // properties the caller left alone still come from the base
    expect(computed('[data-slot="empty"]', 'border-top-style')()).toBe('dashed')
  })

  it('the row gap of a person cell obeys the caller', async () => {
    mount(
      <div data-cell>
        <PersonCell name="张明远" xstyle={caller.wider} />
      </div>,
    )
    await expect.poll(computed('[data-cell] > span', 'gap')).toBe('20px')
  })

  it('an override rides through a composed component to its substrate', async () => {
    mount(<Blank title="还没有内容" xstyle={caller.shorter} />)
    // Blank sets 22rem; the caller's 10rem must win through the chain
    await expect.poll(computed('[data-slot="empty"]', 'min-height')).toBe('160px')
  })
})
