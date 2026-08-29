import { describe, expect, it } from 'vitest'
import type { DecimalSchema, InputSchema } from '../src/profile.ts'
import { validateValue } from '../src/validate.ts'

const decimal: DecimalSchema = {
  type: 'string',
  format: 'qualy-decimal',
  'x-qualy-maxScale': 2,
  'x-qualy-minimum': '1.00',
  'x-qualy-maximum': '6.00',
}

const reasons = (schema: Parameters<typeof validateValue>[0], value: unknown) =>
  validateValue(schema, value).map((issue) => issue.reason)

describe('instance validation', () => {
  it('judges decimals by the frozen semantics', () => {
    expect(reasons(decimal, '3.5')).toEqual([])
    // trailing zeros are lexical noise: the semantic digits fit the scale
    expect(reasons(decimal, '3.1400')).toEqual([])
    expect(reasons(decimal, '3.145')).toEqual(['x-qualy-maxScale'])
    expect(reasons(decimal, '0.5')).toEqual(['x-qualy-minimum'])
    expect(reasons(decimal, '7')).toEqual(['x-qualy-maximum'])
    // lexical failure is the format's verdict alone — bounds abstain
    expect(reasons(decimal, '03')).toEqual(['format'])
    expect(reasons(decimal, 3.5)).toEqual(['type'])
  })

  it('never coerces, defaults or strips', () => {
    expect(reasons({ type: 'integer', minimum: 1, maximum: 10 }, '3')).toEqual(['type'])
    expect(reasons({ type: 'boolean' }, 'true')).toEqual(['type'])
    const input: InputSchema = {
      type: 'object',
      properties: { n: { type: 'integer', minimum: 0, maximum: 9 } },
      required: ['n'],
      additionalProperties: false,
    }
    expect(reasons(input, {})).toEqual(['required'])
    const extra = { n: 3, stray: 1 }
    expect(reasons(input, extra)).toEqual(['additionalProperties'])
    // removeAdditional stays off: the judged object is untouched
    expect(extra).toEqual({ n: 3, stray: 1 })
  })

  it('walks every property and reports paths', () => {
    const input: InputSchema = {
      type: 'object',
      properties: {
        level: { type: 'string', enum: ['a', 'b'] },
        when: { type: 'string', format: 'date' },
      },
      required: ['level', 'when'],
      additionalProperties: false,
    }
    const issues = validateValue(input, { level: 'c', when: '2026-02-29' })
    expect(issues).toContainEqual({ path: '/level', reason: 'enum' })
    expect(issues).toContainEqual({ path: '/when', reason: 'format' })
  })
})
