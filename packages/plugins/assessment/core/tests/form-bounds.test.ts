import { describe, expect, it } from 'vitest'
import {
  DATE_MAXIMUM,
  DATE_MINIMUM,
  DECIMAL_FORMAT,
  DECIMAL_MAXIMUM,
  DECIMAL_MINIMUM,
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
        } as AtomicSchema,
        {
          type: 'string',
          format: DECIMAL_FORMAT,
          [MAX_SCALE]: 1,
          [DECIMAL_MINIMUM]: '0.5',
        } as AtomicSchema,
      ),
    ).toMatchObject({ [MAX_SCALE]: 1, [DECIMAL_MINIMUM]: '0.5', [DECIMAL_MAXIMUM]: '10.5' })
  })

  it('pulls a date window in, and shortens a text', () => {
    expect(
      admittedToday(
        { type: 'string', format: 'date', [DATE_MINIMUM]: '2026-03-01' } as AtomicSchema,
        {
          type: 'string',
          format: 'date',
          [DATE_MINIMUM]: '2026-02-01',
          [DATE_MAXIMUM]: '2026-08-31',
        } as AtomicSchema,
      ),
    ).toMatchObject({ [DATE_MINIMUM]: '2026-03-01', [DATE_MAXIMUM]: '2026-08-31' })
    expect(
      admittedToday({ type: 'string', maxLength: 200 }, { type: 'string', maxLength: 50 }),
    ).toMatchObject({ maxLength: 50 })
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
