import { describe, expect, it } from 'vitest'
import {
  DATE_MAXIMUM,
  DATE_MINIMUM,
  DECIMAL_FORMAT,
  DECIMAL_MAXIMUM,
  DECIMAL_MINIMUM,
  IN_MATERIAL_RANGE,
  MAX_SCALE,
  type AtomicSchema,
} from '@qualy/value-schema'
import { admittedToday } from '../src/review/form-bounds.ts'

// The approve form offers what both the round's contract and today's
// question admit, because the decision refuses a value either one refuses.

describe('what the approve form offers when the question narrowed mid-round', () => {
  it('pulls a number range in from both ends', () => {
    expect(
      admittedToday(
        { type: 'integer', minimum: 1, maximum: 10 },
        { type: 'integer', minimum: 2, maximum: 5 },
      ),
    ).toMatchObject({ minimum: 2, maximum: 5 })
    expect(
      admittedToday(
        {
          type: 'string',
          format: DECIMAL_FORMAT,
          [MAX_SCALE]: 2,
          [DECIMAL_MINIMUM]: '0',
          [DECIMAL_MAXIMUM]: '10.5',
        },
        {
          type: 'string',
          format: DECIMAL_FORMAT,
          [MAX_SCALE]: 1,
          [DECIMAL_MINIMUM]: '0.5',
        },
      ),
    ).toMatchObject({ [MAX_SCALE]: 1, [DECIMAL_MINIMUM]: '0.5', [DECIMAL_MAXIMUM]: '10.5' })
  })

  it('pulls a date window in, and shortens a text', () => {
    expect(
      admittedToday(
        { type: 'string', format: 'date', [DATE_MINIMUM]: '2026-03-01' },
        {
          type: 'string',
          format: 'date',
          [DATE_MINIMUM]: '2026-02-01',
          [DATE_MAXIMUM]: '2026-08-31',
        },
      ),
    ).toMatchObject({ [DATE_MINIMUM]: '2026-03-01', [DATE_MAXIMUM]: '2026-08-31' })
    expect(
      admittedToday({ type: 'string', maxLength: 200 }, { type: 'string', maxLength: 50 }),
    ).toMatchObject({ maxLength: 50 })
  })

  // what the day's version added on top of a range is part of what the
  // decision holds the value to, so the form asks for it too
  it('asks for the pattern and the round window the day added', () => {
    expect(
      admittedToday({ type: 'string' }, { type: 'string', pattern: '^[A-Z]{2}\\d{4}$' }),
    ).toMatchObject({ pattern: '^[A-Z]{2}\\d{4}$' })
    expect(
      admittedToday({ type: 'string', pattern: '^\\d+$' }, { type: 'string', pattern: '^\\d{6}$' }),
    ).toMatchObject({ pattern: '^\\d{6}$' })
    // a pattern the day dropped still binds the round's own contract
    expect(admittedToday({ type: 'string', pattern: '^\\d+$' }, { type: 'string' })).toMatchObject({
      pattern: '^\\d+$',
    })
    expect(
      admittedToday(
        { type: 'string', format: 'date' },
        { type: 'string', format: 'date', [IN_MATERIAL_RANGE]: true },
      ),
    ).toMatchObject({ [IN_MATERIAL_RANGE]: true })
    expect(
      admittedToday(
        { type: 'string', format: 'date', [IN_MATERIAL_RANGE]: true },
        { type: 'string', format: 'date' },
      ),
    ).toMatchObject({ [IN_MATERIAL_RANGE]: true })
  })

  it('keeps only the options both admit', () => {
    expect(
      admittedToday(
        { type: 'string', enum: ['school', 'province', 'national'] },
        { type: 'string', enum: ['national', 'school'] },
      ),
    ).toMatchObject({ enum: ['school', 'national'] })
  })

  it('leaves a field alone where the two share nothing or are not the same kind', () => {
    const frozen: AtomicSchema = { type: 'integer', minimum: 1, maximum: 3 }
    expect(admittedToday(frozen, { type: 'integer', minimum: 5, maximum: 9 })).toBe(frozen)
    expect(admittedToday(frozen, { type: 'string', maxLength: 10 })).toBe(frozen)
  })
})
