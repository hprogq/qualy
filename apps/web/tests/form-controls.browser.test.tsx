import { useRef, useState } from 'react'
import { describe, expect, it } from 'vitest'
import * as stylex from '@stylexjs/stylex'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { Checkbox } from '@qualy/ui/checkbox'
import { DateRangePicker, type DateRange } from '@qualy/ui/date-range-picker'
import { DateTimePicker } from '@qualy/ui/date-time-picker'
import { Input } from '@qualy/ui/input'
import { NativeSelect } from '@qualy/ui/native-select'
import { UiProvider } from '@qualy/ui/provider'
import { RadioGroup, RadioGroupItem } from '@qualy/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import { Textarea } from '@qualy/ui/textarea'
import '../src/app.css'

// Form control contracts, asserted through roles, native state and form
// participation rather than any library's DOM shape. The checkbox carries
// the heaviest pins - an earlier migration found a substrate whose
// indicator ignored its state.

const mount = (ui: React.ReactNode) => render(<UiProvider scheme="light">{ui}</UiProvider>)

const box = (name: string) => page.getByRole('checkbox', { name }).element() as HTMLInputElement

describe('the checkbox owns its state', () => {
  it('toggles under control, through clicks and Space', async () => {
    function Harness() {
      const [checked, setChecked] = useState(false)
      return (
        <>
          <Checkbox aria-label="agree" checked={checked} onCheckedChange={setChecked} />
          <output data-testid="state">{String(checked)}</output>
        </>
      )
    }
    mount(<Harness />)
    const agree = page.getByRole('checkbox', { name: 'agree' })
    await expect.element(agree).not.toBeChecked()
    await agree.click()
    await expect.element(agree).toBeChecked()
    await expect.element(page.getByTestId('state')).toHaveTextContent('true')
    await userEvent.keyboard(' ')
    await expect.element(agree).not.toBeChecked()
    await expect.element(page.getByTestId('state')).toHaveTextContent('false')
  })

  it('indeterminate is the native mixed state and resolves both ways', async () => {
    function Harness() {
      const [checked, setChecked] = useState<boolean | 'indeterminate'>('indeterminate')
      return (
        <>
          <Checkbox aria-label="some" checked={checked} onCheckedChange={setChecked} />
          <button type="button" onClick={() => setChecked('indeterminate')}>
            back to mixed
          </button>
        </>
      )
    }
    mount(<Harness />)
    await expect.poll(() => box('some').indeterminate).toBe(true)
    // a click resolves the mixed state to a definite one
    await page.getByRole('checkbox', { name: 'some' }).click()
    await expect.element(page.getByRole('checkbox', { name: 'some' })).toBeChecked()
    expect(box('some').indeterminate).toBe(false)
    await page.getByRole('button', { name: 'back to mixed' }).click()
    await expect.poll(() => box('some').indeterminate).toBe(true)
  })

  it('disabled stays put, a wrapping label still toggles', async () => {
    function Harness() {
      const [picked, setPicked] = useState(false)
      return (
        <>
          <Checkbox aria-label="frozen" checked disabled />
          <label>
            through the label
            <Checkbox checked={picked} onCheckedChange={setPicked} />
          </label>
        </>
      )
    }
    mount(<Harness />)
    await expect.element(page.getByRole('checkbox', { name: 'frozen' })).toBeDisabled()
    // clicking the label text reaches the control, the native association
    await page.getByText('through the label').click()
    await expect.element(page.getByRole('checkbox', { name: 'through the label' })).toBeChecked()
  })
})

describe('the radio group picks one of several', () => {
  function Flavors({ onPick }: { onPick?: (value: string) => void }) {
    const [value, setValue] = useState('vanilla')
    return (
      <RadioGroup
        value={value}
        onValueChange={(next) => {
          setValue(next)
          onPick?.(next)
        }}
        name="flavor"
      >
        <label>
          vanilla
          <RadioGroupItem value="vanilla" />
        </label>
        <label>
          hazelnut
          <RadioGroupItem value="hazelnut" />
        </label>
        <label>
          burnt
          <RadioGroupItem value="burnt" disabled />
        </label>
      </RadioGroup>
    )
  }

  it('announces the group, follows clicks, skips disabled options', async () => {
    const picks: string[] = []
    mount(<Flavors onPick={(value) => picks.push(value)} />)
    await expect.element(page.getByRole('radiogroup')).toBeInTheDocument()
    await expect.element(page.getByRole('radio', { name: 'vanilla' })).toBeChecked()
    await page.getByRole('radio', { name: 'hazelnut' }).click()
    await expect.element(page.getByRole('radio', { name: 'hazelnut' })).toBeChecked()
    expect(picks).toEqual(['hazelnut'])
    await expect.element(page.getByRole('radio', { name: 'burnt' })).toBeDisabled()
  })

  it('arrow keys walk the group, as native radios do', async () => {
    mount(<Flavors />)
    const vanilla = page.getByRole('radio', { name: 'vanilla' })
    await expect.element(vanilla).toBeChecked()
    ;(vanilla.element() as HTMLInputElement).focus()
    await userEvent.keyboard('{ArrowDown}')
    await expect.element(page.getByRole('radio', { name: 'hazelnut' })).toBeChecked()
  })
})

describe('the input is a native form citizen', () => {
  it('label reaches it, typing lands, submit carries name and value', async () => {
    function Harness() {
      const [sent, setSent] = useState('')
      const ref = useRef<HTMLInputElement>(null)
      return (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            setSent(String(new FormData(event.currentTarget).get('who')))
            // the ref points at the real input element
            expect(ref.current).toBeInstanceOf(HTMLInputElement)
          }}
        >
          <label htmlFor="who-field">name</label>
          <Input id="who-field" name="who" defaultValue="ada" ref={ref} />
          <button type="submit">send</button>
          <output data-testid="sent">{sent}</output>
        </form>
      )
    }
    mount(<Harness />)
    const field = page.getByLabelText('name')
    await expect.element(field).toHaveValue('ada')
    await field.fill('lovelace')
    await page.getByRole('button', { name: 'send' }).click()
    await expect.element(page.getByTestId('sent')).toHaveTextContent('lovelace')
  })

  it('marks invalid through aria-invalid, the accessibility fact', async () => {
    mount(<Input aria-label="broken" aria-invalid readOnly value="x" />)
    const field = page.getByRole('textbox', { name: 'broken' })
    await expect.element(field).toHaveAttribute('aria-invalid', 'true')
    // the invalid state is painted from the product danger token
    await expect
      .poll(() => getComputedStyle(field.element()).borderColor, { timeout: 5000 })
      .toBe('oklch(0.577 0.245 27.325)')
  })
})

// fixture-owned styling compiles with the test, never borrowed from the
// production Tailwind scan: the scenario needs these styles to actually
// apply, and a scan that stops emitting them must not blank the contract
const glassStyles = stylex.create({
  seat: {
    position: 'relative',
  },
  glass: {
    pointerEvents: 'none',
    position: 'absolute',
    top: '50%',
    left: 12,
    width: 14,
    height: 14,
    transform: 'translateY(-50%)',
  },
  indented: {
    paddingLeft: 34,
  },
})

describe('a leading icon laid over the input', () => {
  // caught by eye: the widget's positioning wrapper painted over the
  // absolutely-laid search glass every list screen draws inside its field,
  // leaving 40px of blank padding. The icon must be the thing under the
  // cursor at its own coordinates.
  it('stays visible above the field', async () => {
    mount(
      <div {...stylex.props(glassStyles.seat)}>
        <svg
          data-testid="glass"
          aria-hidden
          viewBox="0 0 24 24"
          {...stylex.props(glassStyles.glass)}
        />
        <Input
          aria-label="find"
          name="find"
          className={stylex.props(glassStyles.indented).className}
        />
      </div>,
    )
    await expect.element(page.getByRole('textbox', { name: 'find' })).toBeVisible()
    const glass = page.getByTestId('glass').element()
    const rect = glass.getBoundingClientRect()
    const onTop = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    // pointer-events none makes hit-testing skip the icon itself; strip it
    // for the probe so the answer names whoever paints on top
    ;(glass as SVGElement).style.pointerEvents = 'auto'
    const winner = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    expect(onTop).not.toBeNull()
    expect(winner).toBe(glass)
  })
})

describe('the input family types at one size', () => {
  // A form must not read at two type sizes because one of its fields is a
  // <button> underneath and another is an <input>. One token carries the
  // family's type - 14px here, 16px under a finger, where iOS Safari would
  // otherwise zoom the page at a focused field - and the density (a 36px
  // field, its padding) is a separate decision that does not move with it.
  it('every control shows its value at one size and keeps its own height', async () => {
    function Harness() {
      const [range, setRange] = useState<DateRange>({ start: '', end: '' })
      const [moment, setMoment] = useState<string | null>(null)
      return (
        <>
          <Input aria-label="text" />
          <Textarea aria-label="notes" />
          <NativeSelect aria-label="native">
            <option>a</option>
          </NativeSelect>
          <Select>
            <SelectTrigger aria-label="picked">
              <SelectValue placeholder="pick" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="a">a</SelectItem>
            </SelectContent>
          </Select>
          <Select>
            <SelectTrigger size="sm" aria-label="compact">
              <SelectValue placeholder="pick" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="a">a</SelectItem>
            </SelectContent>
          </Select>
          <DateRangePicker value={range} onChange={setRange} placeholder="span" localeTag="en-US" />
          <DateTimePicker
            value={moment}
            onChange={setMoment}
            placeholder="moment"
            localeTag="en-US"
            hourLabel="hour"
            minuteLabel="minute"
            secondLabel="second"
            clearLabel="clear"
          />
        </>
      )
    }
    mount(<Harness />)
    const sizeOf = (el: Element | null) => {
      if (el === null) return 'missing'
      const style = getComputedStyle(el)
      return `${style.fontSize}/${style.height}`
    }
    // the pickers are located by the slot they publish: they are named by
    // the field's own label in a form, not by an aria-label of their own
    const face = (label: string) => sizeOf(page.getByLabelText(label).element())
    const slot = (name: string) => sizeOf(document.querySelector(`[data-slot="${name}"]`))
    await expect.poll(() => face('text'), { timeout: 5000 }).toBe('14px/36px')
    expect(face('notes')).toBe('14px/64px')
    expect(face('native')).toBe('14px/36px')
    expect(face('picked')).toBe('14px/36px')
    expect(slot('date-range-picker')).toBe('14px/36px')
    expect(slot('date-time-picker')).toBe('14px/36px')
    // a control asked to be compact keeps the family's type and gives up
    // height instead
    expect(face('compact')).toBe('14px/30px')

    // and they are one family rather than seven controls that happen to
    // agree: move the token and every one of them moves, which is what a
    // touch screen does
    document.documentElement.style.setProperty('--q-input-fz', '21px')
    await expect.poll(() => face('text')).toBe('21px/36px')
    for (const control of ['notes', 'native', 'picked', 'compact'])
      expect(face(control).startsWith('21px')).toBe(true)
    for (const picker of ['date-range-picker', 'date-time-picker'])
      expect(slot(picker).startsWith('21px')).toBe(true)
    document.documentElement.style.removeProperty('--q-input-fz')
  })
})
