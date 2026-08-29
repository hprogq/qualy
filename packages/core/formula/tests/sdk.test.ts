import { describe, expect, it } from 'vitest'
import { Schema, defineFormula, FORMULA_ABI_VERSION } from '../src/index.ts'
import {
  decimalFromString,
  decimalToString,
  decodeInput,
  encodeOutput,
  formulaContext,
  isFormulaFailure,
} from '../src/runtime.ts'

const q = formulaContext
const dec = (value: string) => decimalFromString(value)!
const show = (value: Parameters<typeof decimalToString>[0]) => decimalToString(value)

describe('the decimal arithmetic', () => {
  it('keeps whatever scale the operations produce', () => {
    expect(show(q.decimal.add(dec('0.1'), dec('0.2')))).toBe('0.3')
    expect(show(q.decimal.mul(dec('2.00'), dec('0.50')))).toBe('1')
    expect(show(q.decimal.mul(dec('0.001'), dec('0.001')))).toBe('0.000001')
    expect(show(q.decimal.sub(dec('1'), dec('0.999')))).toBe('0.001')
    expect(show(q.decimal.mulInteger(dec('0.10'), 3))).toBe('0.3')
    expect(show(q.decimal.negate(dec('1.5')))).toBe('-1.5')
    expect(show(q.decimal.abs(dec('-1.5')))).toBe('1.5')
    expect(q.decimal.compare(dec('3.10'), dec('3.1'))).toBe(0)
    expect(show(q.decimal.min(dec('1.2'), dec('1.10')))).toBe('1.1')
    expect(show(q.decimal.max(dec('-1'), dec('-2')))).toBe('-1')
    expect(show(q.decimal.fromInteger(-7))).toBe('-7')
  })

  it('quantizes half away from zero, in both signs', () => {
    expect(show(q.decimal.quantize(dec('2.345'), 2))).toBe('2.35')
    expect(show(q.decimal.quantize(dec('-2.345'), 2))).toBe('-2.35')
    expect(show(q.decimal.quantize(dec('2.344'), 2))).toBe('2.34')
    expect(show(q.decimal.quantize(dec('2.5'), 0))).toBe('3')
    expect(show(q.decimal.quantize(dec('-2.5'), 0))).toBe('-3')
    // widening the scale is exact and display-invisible (canonical drops it)
    expect(show(q.decimal.quantize(dec('2.3'), 4))).toBe('2.3')
  })

  it('refuses non-integers where an integer is the contract', () => {
    expect(() => q.decimal.mulInteger(dec('1'), 1.5)).toThrowError()
    expect(() => q.decimal.fromInteger(2 ** 53)).toThrowError()
    try {
      q.decimal.quantize(dec('1'), -1)
      expect.unreachable()
    } catch (error) {
      expect(isFormulaFailure(error)).toBe(true)
    }
  })
})

describe('the runtime boundary', () => {
  const contract = Schema.input({
    level: Schema.choice({ national: '国家级', provincial: '省部级' }),
    ordinal: Schema.integer({ minimum: 1 }),
    base: Schema.decimal({ maxScale: 4 }),
  })

  it('decodes decimals into opaque values and leaves the rest alone', () => {
    const decoded = decodeInput(contract, { level: 'national', ordinal: 2, base: '3.00' })
    expect(decoded['level']).toBe('national')
    expect(decoded['ordinal']).toBe(2)
    expect(show(decoded['base'] as never)).toBe('3')
    expect(Object.isFrozen(decoded)).toBe(true)
  })

  it('encodes only a decimal, canonically', () => {
    expect(encodeOutput(Schema.decimal(), dec('0.90'))).toBe('0.9')
    expect(() => encodeOutput(Schema.decimal(), true)).toThrowError(/did not return a decimal/)
    expect(() => encodeOutput(Schema.decimal(), '0.9')).toThrowError(/did not return a decimal/)
  })

  it('runs the blueprint competition formula to the exact ledger amount', () => {
    const formula = defineFormula({
      input: Schema.input({
        level: Schema.choice({ national: '国家级', provincial: '省部级', city: '市级' }),
        ordinal: Schema.integer({ minimum: 1 }),
        projectType: Schema.choice({ individual: '个人', team: '集体' }),
        nationalBase: Schema.decimal({ maxScale: 4 }),
        provincialBase: Schema.decimal({ maxScale: 4 }),
        cityBase: Schema.decimal({ maxScale: 4 }),
        individualStep: Schema.decimal({ maxScale: 4 }),
        teamFactor: Schema.decimal({ maxScale: 4 }),
        teamStep: Schema.decimal({ maxScale: 4 }),
        floor: Schema.decimal({ maxScale: 4 }),
      }),
      output: Schema.decimal({ maxScale: 4 }),
      run(input, context) {
        const base =
          input.level === 'national'
            ? input.nationalBase
            : input.level === 'provincial'
              ? input.provincialBase
              : input.cityBase
        const first =
          input.projectType === 'team' ? context.decimal.mul(base, input.teamFactor) : base
        const step = input.projectType === 'team' ? input.teamStep : input.individualStep
        const decline = context.decimal.mulInteger(step, input.ordinal - 1)
        return context.decimal.max(context.decimal.sub(first, decline), input.floor)
      },
    })
    const amount = encodeOutput(
      formula.output,
      formula.run(
        decodeInput(formula.input, {
          level: 'provincial',
          ordinal: 2,
          projectType: 'team',
          nationalBase: '3.00',
          provincialBase: '2.00',
          cityBase: '1.00',
          individualStep: '0.20',
          teamFactor: '0.50',
          teamStep: '0.10',
          floor: '0.00',
        }) as never,
        formulaContext,
      ),
    )
    expect(amount).toBe('0.9')
  })
})

describe('the authoring surface', () => {
  it('produces frozen value-schema profile objects, labels included', () => {
    const level = Schema.choice({ national: '国家级' })
    expect(level).toMatchObject({
      type: 'string',
      enum: ['national'],
      'x-qualy-enumLabels': { national: '国家级' },
    })
    expect(Object.isFrozen(level)).toBe(true)
    const bounded = Schema.integer()
    expect(bounded.minimum).toBe(Number.MIN_SAFE_INTEGER)
    expect(bounded.maximum).toBe(Number.MAX_SAFE_INTEGER)
    const output = Schema.decimal()
    expect(output['x-qualy-maxScale']).toBe(4)
    const empty = Schema.input({})
    expect(empty.required).toEqual([])
    const definition = defineFormula({
      input: empty,
      output,
      run: (_input, context) => context.decimal.fromInteger(1),
    })
    expect(Object.isFrozen(definition)).toBe(true)
    expect(FORMULA_ABI_VERSION).toBe(1)
  })

  it('marks q.fail structurally, unlike a plain throw', () => {
    try {
      q.fail('refused by policy')
      expect.unreachable()
    } catch (error) {
      expect(isFormulaFailure(error)).toBe(true)
      expect((error as Error).message).toBe('refused by policy')
    }
    expect(isFormulaFailure(new Error('plain'))).toBe(false)
    expect(isFormulaFailure(null)).toBe(false)
  })
})
