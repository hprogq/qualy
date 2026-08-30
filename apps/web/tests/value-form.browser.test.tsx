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
  materializeFields,
  draftsFromFields,
} from '@qualy/web-value-form/model'
import { InputValueForm, ValueFieldsForm } from '@qualy/web-value-form/InputValueForm'
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

    const missing = materializeInput(contract, {
      level: '',
      ordinal: '2',
      base: '4',
      awarded: false,
    })
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
    // and NO stored value stays no draft: absence is part of the model
    expect(draftFromValue(contract.properties['level']!, undefined)).toBeUndefined()
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

  it('treats prototype names as ids like any other', () => {
    // `__proto__`, `constructor`, `toString` are legal opaque ids. The
    // model reads drafts and stored values as own keys and builds its
    // answer without a prototype, so a missing value is `required` - never
    // quietly filled from Object.prototype - and an answered `__proto__`
    // is a key of the wire value, not a mutation of its prototype.
    for (const hostile of ['__proto__', 'constructor', 'toString']) {
      const fields = [{ id: hostile, schema: { type: 'integer', minimum: 0, maximum: 9 } as const }]
      expect(draftsFromFields(fields, {}), hostile).toEqual({})
      const empty = materializeFields(fields, {})
      expect(empty.value, hostile).toBeNull()
      expect(empty.issues.get(hostile), hostile).toBe('required')
      const done = materializeFields(fields, Object.fromEntries([[hostile, '3']]))
      expect(done.value, hostile).not.toBeNull()
      expect(Object.hasOwn(done.value!, hostile), hostile).toBe(true)
      expect((done.value as Record<string, unknown>)[hostile], hostile).toBe(3)
      expect(Object.getPrototypeOf(done.value), hostile).toBeNull()
    }
  })

  it('treats field ids as opaque identities, not identifiers', async () => {
    // a recognition contract addresses values by stable ids - hyphens,
    // uuid-looking strings, anything - and the fields form must never
    // borrow the parameter-name grammar an input contract happens to have
    const fields = [
      {
        id: 'recognition-uuid-a',
        schema: { type: 'string', enum: ['national', 'provincial'] } as const,
      },
      {
        id: 'rec-2.ordinal',
        schema: { type: 'integer', minimum: 1, maximum: 10 } as const,
      },
    ]
    const drafts = draftsFromFields(fields, { 'recognition-uuid-a': 'provincial' })
    expect(drafts['recognition-uuid-a']).toBe('provincial')
    const done = materializeFields(fields, { ...drafts, 'rec-2.ordinal': '3' })
    expect(done.value).toEqual({ 'recognition-uuid-a': 'provincial', 'rec-2.ordinal': 3 })

    const screen = await mount(
      <ValueFieldsForm
        fields={fields}
        drafts={drafts}
        onDraft={() => {}}
        locale="zh-CN"
        scope="opaque"
      />,
    )
    await vi.waitFor(
      () => {
        if (screen.container.querySelector('[data-testid="value-form-opaque"]') === null)
          throw new Error('form not mounted yet')
      },
      { timeout: 5_000 },
    )
    const form = screen.container.querySelector('[data-testid="value-form-opaque"]')!
    const rendered = [...form.querySelectorAll('[data-parameter]')].map((one) =>
      one.getAttribute('data-parameter'),
    )
    expect(rendered).toEqual(['recognition-uuid-a', 'rec-2.ordinal'])
  })
})
