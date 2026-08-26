import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import * as stylex from '@stylexjs/stylex'
import { UiProvider } from '@qualy/ui/provider'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import '../src/app.css'

// The trigger's sizing contract. Its fit-content default lives in the
// adapter's own StyleX base, so a caller's xstyle wins property by property
// in the same composition - and a caller still on Tailwind keeps winning by
// cascade, which is what lets the unmigrated screens wait their turn.

const caller = stylex.create({
  fixed: { width: 240 },
  full: { width: '100%' },
})

const seat = { width: 400, display: 'block' } as const

function Probe({
  testId,
  xstyle,
  className,
}: {
  testId: string
  xstyle?: (typeof caller)[keyof typeof caller]
  className?: string
}) {
  return (
    <div style={seat} data-testid={testId}>
      <Select value="a">
        <SelectTrigger
          aria-label={testId}
          {...(xstyle === undefined ? {} : { xstyle })}
          {...(className === undefined ? {} : { className })}
        >
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

  it('a legacy utility className still wins by cascade for unmigrated callers', async () => {
    render(
      <UiProvider scheme="light">
        <Probe testId="legacy" className="w-56" />
      </UiProvider>,
    )
    // 14rem from the utility layer, over the adapter's StyleX base
    await expect.poll(() => widthOf('legacy')).toBe(224)
  })
})
