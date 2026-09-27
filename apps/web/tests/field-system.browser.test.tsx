import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { useState } from 'react'
import { Field, FieldContent, FieldDescription, FieldLabel } from '@qualy/ui/field'
import {
  Field as AdminField,
  RadioGroup as AdminRadioGroup,
  useSettledCheck,
} from '@qualy/ui/admin'
import { Checkbox } from '@qualy/ui/checkbox'
import { Input } from '@qualy/ui/input'
import { Textarea } from '@qualy/ui/textarea'
import { UiProvider } from '@qualy/ui/provider'
import '../src/app.css'

// The field system's behaviors, pinned across the styling migration. What
// used to be CSS :has() archaeology is explicit component state now, and
// state can regress silently - so the two load-bearing outcomes (label
// wiring, row alignment) are asserted on the rendered result.

const mount = (ui: React.ReactNode) => render(<UiProvider scheme="light">{ui}</UiProvider>)

describe('the admin field wires its label', () => {
  it('the generated id ties the label to the control by name', async () => {
    await mount(<AdminField label="批次名称">{(id) => <Input id={id} name="title" />}</AdminField>)
    // reachable by accessible name is the entire point of the wiring
    await expect.element(page.getByLabelText('批次名称')).toBeVisible()
  })

  it('hands the control what it must say: required, refused, and where the words are', async () => {
    await mount(
      <AdminField label="邮箱" required hint="用于找回密码" error="该邮箱已被占用">
        {(id, control) => <Input id={id} {...control} />}
      </AdminField>,
    )
    const input = page.getByRole('textbox', { name: '邮箱' })
    await expect.element(input).toHaveAttribute('aria-required', 'true')
    await expect.element(input).toHaveAttribute('aria-invalid', 'true')
    const error = page.getByTestId('field-error')
    await expect.element(error).toBeVisible()
    // the refusal is read first, then the hint
    const described = input.element().getAttribute('aria-describedby')!.split(' ')
    expect(described).toHaveLength(2)
    expect(described[0]).toBe(error.element().id)
  })

  // the widget behind the textarea wraps it in a layer of its own that knows
  // none of the caller's words; they reach the element all the same
  it('hands a textarea the same, through the layer its widget wraps it in', async () => {
    await mount(
      <AdminField label="退回事由" required hint="写给申报人看" error="请填写事由">
        {(id, control) => <Textarea id={id} {...control} />}
      </AdminField>,
    )
    const box = page.getByRole('textbox', { name: '退回事由' })
    await expect.element(box).toHaveAttribute('aria-required', 'true')
    await expect.element(box).toHaveAttribute('aria-invalid', 'true')
    const described = box.element().getAttribute('aria-describedby')!.split(' ')
    expect(described).toHaveLength(2)
    expect(described[0]).toBe(page.getByTestId('field-error').element().id)
  })

  it('says nothing of a field that is neither required nor refused', async () => {
    await mount(
      <AdminField label="备注">{(id, control) => <Input id={id} {...control} />}</AdminField>,
    )
    const input = page.getByRole('textbox', { name: '备注' }).element()
    expect(input.hasAttribute('aria-required')).toBe(false)
    expect(input.hasAttribute('aria-invalid')).toBe(false)
    expect(input.hasAttribute('aria-describedby')).toBe(false)
  })
})

describe('a check on what is typed waits for the typing to settle', () => {
  // long enough that a loaded machine does not settle it between two steps
  const PAUSE = 1500
  const settled = { timeout: PAUSE * 4 }
  function Probe() {
    const [value, setValue] = useState('')
    const check = useSettledCheck(value, (typed) => (typed.includes('@') ? null : 'bad'), PAUSE)
    return (
      <>
        <input
          aria-label="probe"
          value={value}
          onBlur={check.onBlur}
          onChange={(e) => setValue(e.target.value)}
        />
        <output data-testid="said">{check.error ?? ''}</output>
      </>
    )
  }

  it('says nothing at the first character, and says it once the typing stops', async () => {
    await mount(<Probe />)
    const input = page.getByRole('textbox', { name: 'probe' })
    await input.fill('a')
    expect(page.getByTestId('said').element().textContent).toBe('')
    await expect.poll(() => page.getByTestId('said').element().textContent, settled).toBe('bad')
    // fixed, and the next settle takes the refusal back
    await input.fill('a@b')
    await expect.poll(() => page.getByTestId('said').element().textContent, settled).toBe('')
  })

  it('says it at once when the field is left', async () => {
    await mount(<Probe />)
    const input = page.getByRole('textbox', { name: 'probe' })
    await input.fill('a')
    ;(input.element() as HTMLInputElement).blur()
    await expect.poll(() => page.getByTestId('said').element().textContent).toBe('bad')
  })

  it('judges nothing of an empty field', async () => {
    await mount(<Probe />)
    const input = page.getByRole('textbox', { name: 'probe' })
    await input.fill('')
    ;(input.element() as HTMLInputElement).blur()
    await new Promise((resolve) => setTimeout(resolve, PAUSE + 200))
    expect(page.getByTestId('said').element().textContent).toBe('')
  })
})

describe('a horizontal field aligns by what it holds', () => {
  it('a bare row centres; a row carrying a content column tops out', async () => {
    await mount(
      <>
        <span data-testid="bare">
          <Field orientation="horizontal">
            <Checkbox aria-label="bare" />
            <FieldLabel>只有一行</FieldLabel>
          </Field>
        </span>
        <span data-testid="stacked">
          <Field orientation="horizontal">
            <Checkbox aria-label="stacked" />
            <FieldContent>
              <FieldLabel>标题一行</FieldLabel>
              <FieldDescription>说明第二行</FieldDescription>
            </FieldContent>
          </Field>
        </span>
      </>,
    )
    const align = (name: string) => {
      const field = page.getByTestId(name).element().querySelector('[data-slot="field"]')
      return field === null ? null : getComputedStyle(field).alignItems
    }
    await expect.poll(() => align('bare')).toBe('center')
    expect(align('stacked')).toBe('flex-start')
  })
})

describe('the cards variant answers with real radios', () => {
  function Cards() {
    const [mode, setMode] = useState('open')
    return (
      <AdminRadioGroup
        legend="站位模式"
        name="placement"
        variant="cards"
        selected={mode}
        onChange={setMode}
        options={[
          { value: 'open', label: '不限位置', hint: '任何节点都可站立' },
          { value: 'list', label: '仅限清单', hint: '空清单即无处可站' },
        ]}
      />
    )
  }
  it('clicking a card checks its radio and moves the picked mark', async () => {
    await mount(<Cards />)
    const second = page.getByRole('radio', { name: '仅限清单', exact: false })
    await expect.element(page.getByRole('radio', { name: '不限位置', exact: false })).toBeChecked()
    await second.click()
    await expect.element(second).toBeChecked()
    const picked = [...document.querySelectorAll('[data-picked="true"]')]
    expect(picked).toHaveLength(1)
    expect(picked[0]!.textContent).toContain('仅限清单')
  })
})
