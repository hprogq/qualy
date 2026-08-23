import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { DateTimePicker } from '@qualy/ui/date-time-picker'
import '../src/app.css'

// The one control behind every start time in the product.
//
// Its predecessor was two popovers, and the time half was two scrolling
// columns of buttons. It broke in a way no unit test could see: the popover
// grew a `flex-col` default, the call site's `flex` did not override it, and
// the two columns silently stacked into one tall list. So the assertions
// here drive the composed, laid-out thing.
//
// Typing is what the time boxes are for, so typing is what is checked -
// including the two rules that are easy to lose in a refactor: a pair of
// digits hands the caret on by itself, and a box refuses a value it cannot
// mean rather than accepting one and complaining later.

function Harness({ initial }: { initial: string | null }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <DateTimePicker
        value={value}
        onChange={setValue}
        placeholder="pick a start"
        hourLabel="hour"
        minuteLabel="minute"
        secondLabel="second"
        clearLabel="clear"
        localeTag="en-US"
      />
      {/* the value itself, where an assertion can read it without going
          through anything this component chose to display */}
      <output data-testid="value">{value ?? ''}</output>
    </>
  )
}

const written = () => new Date(page.getByTestId('value').element().textContent!)
const hourBox = () => page.getByRole('spinbutton', { name: 'hour' })
const minuteBox = () => page.getByRole('spinbutton', { name: 'minute' })
const secondBox = () => page.getByRole('spinbutton', { name: 'second' })
const open = async () => userEvent.click(page.getByRole('button').first())

describe('choosing an instant', () => {
  it('opens onto the time it already holds', async () => {
    render(<Harness initial={new Date(2026, 7, 25, 9, 30).toISOString()} />)
    await open()
    await expect.element(hourBox()).toHaveValue('09')
    await expect.element(minuteBox()).toHaveValue('30')
  })

  it('takes a whole time typed straight through, handing the caret on', async () => {
    render(<Harness initial={new Date(2026, 7, 25, 0, 0).toISOString()} />)
    await open()

    await userEvent.click(hourBox())
    await userEvent.keyboard('093045')

    expect([written().getHours(), written().getMinutes(), written().getSeconds()]).toEqual([
      9, 30, 45,
    ])
    // each pair moved on by itself; nothing was tabbed
    expect(document.activeElement).toBe(secondBox().element())
    expect(written().getDate()).toBe(25)
  })

  it('finishes a box early when no second digit could follow', async () => {
    render(<Harness initial={new Date(2026, 7, 25, 0, 0).toISOString()} />)
    await open()

    // 5 cannot begin an hour, so it is the whole hour
    await userEvent.click(hourBox())
    await userEvent.keyboard('5')
    await expect.element(hourBox()).toHaveValue('05')
    expect(document.activeElement).toBe(minuteBox().element())
  })

  it('steps with the arrows and comes round rather than stopping', async () => {
    render(<Harness initial={new Date(2026, 7, 25, 23, 59).toISOString()} />)
    await open()

    await userEvent.click(hourBox())
    await userEvent.keyboard('{ArrowUp}')
    expect(written().getHours()).toBe(0)

    await userEvent.click(minuteBox())
    await userEvent.keyboard('{ArrowUp}')
    expect(written().getMinutes()).toBe(0)
  })

  it('keeps the panel open after a day is chosen, because the time is on it', async () => {
    render(<Harness initial={new Date(2026, 7, 25, 9, 30).toISOString()} />)
    await open()

    // a day is named the way it is read out, not by the numeral in the cell
    await userEvent.click(page.getByRole('button', { name: /August 26/ }))
    expect(written().getDate()).toBe(26)
    // the half of the answer that lives under the calendar is still reachable
    await expect.element(hourBox()).toBeVisible()
    expect([written().getHours(), written().getMinutes()]).toEqual([9, 30])
  })

  it('offers nothing to clear until there is something to clear', async () => {
    render(<Harness initial={null} />)
    expect(page.getByRole('button', { name: 'clear' }).elements()).toHaveLength(0)

    await open()
    await userEvent.click(hourBox())
    await userEvent.keyboard('08')
    expect(page.getByTestId('value').element().textContent).not.toBe('')

    await userEvent.click(page.getByRole('button', { name: 'clear' }))
    expect(page.getByTestId('value').element().textContent).toBe('')
  })
})
