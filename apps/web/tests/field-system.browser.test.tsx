import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { useState } from 'react'
import { Field, FieldContent, FieldDescription, FieldLabel } from '@qualy/ui/field'
import { Field as AdminField, RadioGroup as AdminRadioGroup } from '@qualy/ui/admin'
import { Checkbox } from '@qualy/ui/checkbox'
import { Input } from '@qualy/ui/input'
import { UiProvider } from '@qualy/ui/provider'
import '../src/app.css'

// The field system's behaviors, pinned across the styling migration. What
// used to be CSS :has() archaeology is explicit component state now, and
// state can regress silently - so the two load-bearing outcomes (label
// wiring, row alignment) are asserted on the rendered result.

const mount = (ui: React.ReactNode) => render(<UiProvider scheme="light">{ui}</UiProvider>)

describe('the admin field wires its label', () => {
  it('the generated id ties the label to the control by name', async () => {
    mount(<AdminField label="批次名称">{(id) => <Input id={id} name="title" />}</AdminField>)
    // reachable by accessible name is the entire point of the wiring
    await expect.element(page.getByLabelText('批次名称')).toBeVisible()
  })
})

describe('a horizontal field aligns by what it holds', () => {
  it('a bare row centres; a row carrying a content column tops out', async () => {
    mount(
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
    mount(<Cards />)
    const second = page.getByRole('radio', { name: '仅限清单' })
    await expect.element(page.getByRole('radio', { name: '不限位置' })).toBeChecked()
    await second.click()
    await expect.element(second).toBeChecked()
    const picked = [...document.querySelectorAll('[data-picked="true"]')]
    expect(picked).toHaveLength(1)
    expect(picked[0]!.textContent).toContain('仅限清单')
  })
})
