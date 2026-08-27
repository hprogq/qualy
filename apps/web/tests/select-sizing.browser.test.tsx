import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import * as stylex from '@stylexjs/stylex'
import { UiProvider } from '@qualy/ui/provider'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import '../src/app.css'

// The trigger's sizing contract: its fit-content default lives in the
// adapter's own StyleX base, so a caller's xstyle wins property by property
// in the same composition.
//
// This file also pinned the migration window's other half - that a caller
// still writing Tailwind kept winning by cascade - with a probe that had to
// be a utility production actually emitted. There are none left to borrow:
// the last literal class in the product is gone, so the case retired with
// the callers it was there for.

const caller = stylex.create({
  fixed: { width: 240 },
  full: { width: '100%' },
})

const seat = { width: 400, display: 'block' } as const

function Probe({
  testId,
  xstyle,
}: {
  testId: string
  xstyle?: (typeof caller)[keyof typeof caller]
}) {
  return (
    <div style={seat} data-testid={testId}>
      <Select value="a">
        <SelectTrigger aria-label={testId} {...(xstyle === undefined ? {} : { xstyle })}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">短</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

const widthOf = (testId: string) => {
  const trigger = document
    .querySelector(`[data-testid="${testId}"]`)
    ?.querySelector('[data-slot="select-trigger"]')
  return trigger instanceof HTMLElement ? trigger.getBoundingClientRect().width : null
}

describe('the select trigger sizing contract', () => {
  it('fits its content by default, and obeys xstyle property overrides', async () => {
    render(
      <UiProvider scheme="light">
        <Probe testId="bare" />
        <Probe testId="fixed" xstyle={caller.fixed} />
        <Probe testId="full" xstyle={caller.full} />
      </UiProvider>,
    )
    // fit-content: far narrower than the 400px seat it sits in
    await expect.poll(() => widthOf('bare')).not.toBeNull()
    expect(widthOf('bare')!).toBeGreaterThan(0)
    expect(widthOf('bare')!).toBeLessThan(200)
    // the caller's word is final, property by property
    expect(widthOf('fixed')).toBe(240)
    expect(widthOf('full')).toBe(400)
  })
})
