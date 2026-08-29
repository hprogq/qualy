import { StrictMode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { I18nProvider } from '@qualy/web-i18n'
import { UiProvider } from '@qualy/ui/provider'
import { catalogs, errorMessages } from 'virtual:qualy/plugins'
import {
  draftFromValue,
  draftsFromStored,
  materializeField,
  materializeInput,
} from '@qualy/plugin-assessment-formula/client/value-form/model'
import { InputValueForm } from '@qualy/plugin-assessment-formula/client/value-form/InputValueForm'
import { normalizeAtomicSchema, normalizeInputSchema } from '@qualy/value-schema'
import '../src/app.css'

// The schema-driven form in two layers: the draft/materialize model (a
// person mid-edit holds shapes no schema admits; only materialization
// produces wire values, judged by the same validator the server runs) and
// the generated form itself - authored order, annotation labels, per-field
// problems.

const contract = normalizeInputSchema({
  type: 'object',
  properties: {
    level: {
      type: 'string',
      enum: ['national', 'provincial'],
      'x-qualy-enumLabels': { national: '国家级', provincial: '省级' },
      title: '赛事级别',
    },
    ordinal: { type: 'integer', minimum: 1, maximum: 10, title: '奖项序位' },
    base: {
      type: 'string',
      format: 'qualy-decimal',
      'x-qualy-maxScale': 2,
      'x-qualy-minimum': '0',
      'x-qualy-maximum': '10',
    },
    awarded: { type: 'boolean' },
  },
  required: ['awarded', 'base', 'level', 'ordinal'],
  additionalProperties: false,
  'x-qualy-order': ['level', 'ordinal', 'base', 'awarded'],
})

describe('draft to wire value', () => {
  it('materializes each kind, canonically', () => {
    expect(materializeField(contract.properties['ordinal']!, '3')).toEqual({
      kind: 'value',
      value: 3,
    })
    expect(materializeField(contract.properties['ordinal']!, '3.5')).toEqual({
      kind: 'invalid',
      reason: 'not-an-integer',
    })
    expect(materializeField(contract.properties['ordinal']!, '')).toEqual({ kind: 'empty' })
    expect(materializeField(contract.properties['base']!, '2.50')).toEqual({
      kind: 'value',
      value: '2.5',
    })
    expect(materializeField(contract.properties['base']!, '1.')).toEqual({
      kind: 'invalid',
      reason: 'not-a-decimal',
    })
    expect(materializeField(contract.properties['level']!, 'national')).toEqual({
      kind: 'value',
      value: 'national',
    })
    expect(materializeField(contract.properties['awarded']!, true)).toEqual({
      kind: 'value',
      value: true,
    })
  })

  it('assembles the object and lets validateValue judge the bounds', () => {
    const good = materializeInput(contract, {
      level: 'national',
      ordinal: '2',
      base: '4.00',
      awarded: true,
    })
    expect(good.value).toEqual({ level: 'national', ordinal: 2, base: '4', awarded: true })

    const missing = materializeInput(contract, { level: '', ordinal: '2', base: '4', awarded: false })
    expect(missing.value).toBeNull()
    expect(missing.issues.get('level')).toBe('required')

    const outOfRange = materializeInput(contract, {
      level: 'national',
      ordinal: '99',
      base: '4',
      awarded: false,
    })
    expect(outOfRange.value).toBeNull()
    expect(outOfRange.issues.get('ordinal')).toBe('maximum')
  })

  it('redraws stored values as drafts, losslessly for legal ones', () => {
    const drafts = draftsFromStored(contract, {
      level: 'provincial',
      ordinal: 2,
      base: '4.5',
      awarded: true,
    })
    expect(drafts).toEqual({ level: 'provincial', ordinal: '2', base: '4.5', awarded: true })
    // a value from an older, differently-typed contract still renders
    expect(draftFromValue(contract.properties['base']!, 3)).toBe('3')
    expect(draftFromValue(contract.properties['level']!, undefined)).toBe('')
  })
})

describe('the generated form', () => {
  const mount = (element: React.ReactElement) =>
    render(
      <StrictMode>
        <I18nProvider catalogs={catalogs} errorMessages={errorMessages} fallback={null}>
          <UiProvider scheme="light">{element}</UiProvider>
        </I18nProvider>
      </StrictMode>,
    )

  it('renders authored order, annotation labels and choice words', async () => {
    const screen = await mount(
      <InputValueForm
        schema={contract}
        drafts={{}}
        onDraft={() => {}}
        locale="zh-CN"
        scope="probe"
      />,
    )
    await vi.waitFor(
      () => {
        if (screen.container.querySelector('[data-testid="value-form-probe"]') === null)
          throw new Error('form not mounted yet')
      },
      { timeout: 5_000 },
    )
    const form = screen.container.querySelector('[data-testid="value-form-probe"]')!
    const parameters = [...form.querySelectorAll('[data-parameter]')].map((node) =>
      node.getAttribute('data-parameter'),
    )
    expect(parameters).toEqual(['level', 'ordinal', 'base', 'awarded'])
    // the annotation label, not the machine name
    expect(form.textContent).toContain('赛事级别')
    expect(form.textContent).toContain('奖项序位')
    // no words for base/awarded: the key is the fallback
    expect(form.textContent).toContain('base')
    const select = form.querySelector('select')!
    expect([...select.options].map((option) => option.textContent)).toContain('国家级')
  })

  it('surfaces per-field problems where the field is', async () => {
    const screen = await mount(
      <InputValueForm
        schema={contract}
        drafts={{ ordinal: 'x' }}
        onDraft={() => {}}
        locale="zh-CN"
        problems={new Map([['ordinal', '请输入整数']])}
        scope="probe2"
      />,
    )
    await vi.waitFor(
      () => {
        if (screen.container.querySelector('[data-testid="value-form-probe2"]') === null)
          throw new Error('form not mounted yet')
      },
      { timeout: 5_000 },
    )
    const field = screen.container.querySelector(
      '[data-testid="value-form-probe2"] [data-parameter="ordinal"]',
    )!
    expect(field.getAttribute('data-invalid')).toBe('true')
    expect(field.textContent).toContain('请输入整数')
  })
})
