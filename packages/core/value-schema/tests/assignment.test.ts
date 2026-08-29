import { describe, expect, it } from 'vitest'
import { assignmentPlan, type AssignmentPlan } from '../src/assignment.ts'
import type { AtomicSchema, DecimalSchema, IntegerSchema } from '../src/profile.ts'

// The prover answers about EVERY legal source value, never the ones stored.
// Each refusal here is a case where some legal source value would break the
// target; each direct is a proof that none can.

const integer = (minimum: number, maximum: number): IntegerSchema => ({
  type: 'integer',
  minimum,
  maximum,
})

const decimal = (minimum: string | null, maximum: string | null, maxScale = 2): DecimalSchema => ({
  type: 'string',
  format: 'qualy-decimal',
  'x-qualy-maxScale': maxScale,
  ...(minimum === null ? {} : { 'x-qualy-minimum': minimum }),
  ...(maximum === null ? {} : { 'x-qualy-maximum': maximum }),
})

const choice = (...values: string[]): AtomicSchema => ({ type: 'string', enum: values })

const code = (plan: AssignmentPlan): string =>
  plan.kind === 'incompatible' ? plan.code : plan.kind

describe('same-kind containment', () => {
  it('integer intervals must nest', () => {
    expect(assignmentPlan(integer(10, 20), integer(0, 100)).kind).toBe('direct')
    expect(assignmentPlan(integer(10, 20), integer(10, 20)).kind).toBe('direct')
    expect(code(assignmentPlan(integer(1, 20), integer(10, 100)))).toBe('integer-range-widens')
    expect(code(assignmentPlan(integer(10, 200), integer(10, 100)))).toBe('integer-range-widens')
  })

  it('decimal ranges nest by exact arithmetic and scale may only narrow', () => {
    expect(assignmentPlan(decimal('1.00', '5.00'), decimal('0', '10', 4)).kind).toBe('direct')
    expect(code(assignmentPlan(decimal('1', '5', 4), decimal('1', '5', 2)))).toBe(
      'decimal-scale-widens',
    )
    expect(code(assignmentPlan(decimal('0.99', '5'), decimal('1', '5')))).toBe(
      'decimal-range-widens',
    )
    // an unbounded source side cannot flow into a bounded target side
    expect(code(assignmentPlan(decimal(null, '5'), decimal('0', '5')))).toBe('decimal-range-widens')
    expect(assignmentPlan(decimal(null, null), decimal(null, null, 9)).kind).toBe('direct')
  })

  it('choices must be a subset, labels play no part', () => {
    expect(assignmentPlan(choice('a'), choice('a', 'b')).kind).toBe('direct')
    const widened = assignmentPlan(choice('a', 'c'), choice('a', 'b'))
    expect(code(widened)).toBe('choice-widens')
    expect(widened).toMatchObject({ detail: { extra: ['c'] } })
  })

  it('text lengths must nest and patterns are proved only by identity', () => {
    expect(
      assignmentPlan(
        { type: 'string', minLength: 2, maxLength: 10 },
        { type: 'string', maxLength: 20 },
      ).kind,
    ).toBe('direct')
    expect(code(assignmentPlan({ type: 'string' }, { type: 'string', maxLength: 20 }))).toBe(
      'text-length-widens',
    )
    expect(
      code(assignmentPlan({ type: 'string', minLength: 0 }, { type: 'string', minLength: 1 })),
    ).toBe('text-length-widens')
    expect(
      assignmentPlan({ type: 'string', pattern: '^x$' }, { type: 'string', pattern: '^x$' }).kind,
    ).toBe('direct')
    expect(code(assignmentPlan({ type: 'string' }, { type: 'string', pattern: '^x$' }))).toBe(
      'pattern-unprovable',
    )
    // even a pattern that plainly includes the other is not proved
    expect(
      code(
        assignmentPlan({ type: 'string', pattern: '^ab$' }, { type: 'string', pattern: '^a.$' }),
      ),
    ).toBe('pattern-unprovable')
  })

  it('boolean and date carry no parameters', () => {
    expect(assignmentPlan({ type: 'boolean' }, { type: 'boolean' }).kind).toBe('direct')
    expect(
      assignmentPlan({ type: 'string', format: 'date' }, { type: 'string', format: 'date' }).kind,
    ).toBe('direct')
  })
})

describe('across kinds', () => {
  it('everything but integer→decimal is refused outright', () => {
    for (const [source, target] of [
      [{ type: 'string' }, integer(0, 9)],
      [decimal('0', '9'), integer(0, 9)],
      [{ type: 'string' }, { type: 'string', format: 'date' }],
      [choice('a'), { type: 'string' }],
      [{ type: 'boolean' }, { type: 'string', format: 'date' }],
    ] as const) {
      expect(code(assignmentPlan(source as AtomicSchema, target as AtomicSchema))).toBe(
        'kind-mismatch',
      )
    }
  })

  it('integer→decimal converts only when the whole domain fits the bounds', () => {
    expect(assignmentPlan(integer(1, 5), decimal('0', '10'))).toEqual({
      kind: 'convert',
      converter: 'integer-to-decimal@1',
    })
    expect(assignmentPlan(integer(1, 5), decimal(null, null)).kind).toBe('convert')
    // 50 is a legal source value and exceeds "10" — the plan must refuse even
    // if every currently stored value happens to be small
    expect(code(assignmentPlan(integer(1, 50), decimal('0', '10')))).toBe(
      'converter-domain-exceeds',
    )
    expect(code(assignmentPlan(integer(-1, 5), decimal('0', '10')))).toBe(
      'converter-domain-exceeds',
    )
    // exact edges convert
    expect(assignmentPlan(integer(0, 10), decimal('0', '10')).kind).toBe('convert')
  })
})
