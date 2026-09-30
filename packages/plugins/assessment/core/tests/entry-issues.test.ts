import { describe, expect, it } from 'vitest'
import { issueSentence } from '../src/client/entry/issues.ts'
import * as m from '#messages'

// The sentence a refused field gets. The evidence driver folds a date
// field's own bounds and the round's material window into one range and
// reports either as `out-of-range`, so which of the two it broke is read
// off the date that was sent.

describe('which bound a refused date is said to have broken', () => {
  const window = { start: '2026-03-01', end: '2026-09-01' }
  const bound = { type: 'date', inMaterialRange: true }
  const narrowed = { ...bound, min: '2026-05-01' }

  it.each([
    ['a date before the window', bound, '2026-02-01', m.entry_issueOutOfMaterialRange],
    [
      'the day the window ends, which it does not hold',
      bound,
      '2026-09-01',
      m.entry_issueOutOfMaterialRange,
    ],
    [
      'a date in the window, before the field’s own earliest',
      narrowed,
      '2026-04-01',
      m.entry_issueOutOfRange,
    ],
    ['a date before both', narrowed, '2026-02-01', m.entry_issueOutOfMaterialRange],
  ] as const)('%s', (_case, field, value, sentence) => {
    expect(issueSentence('out-of-range', field, { value, materialRange: window })).toBe(sentence)
  })

  it('reads the field alone where the date is not known', () => {
    // only the window binds it, so only the window can have refused it
    expect(issueSentence('out-of-range', bound)).toBe(m.entry_issueOutOfMaterialRange)
    // either could have: the field's own words are true of both
    expect(issueSentence('out-of-range', narrowed)).toBe(m.entry_issueOutOfRange)
    // a date the window does not bind, and a number, broke their own bounds
    expect(
      issueSentence(
        'out-of-range',
        { type: 'date' },
        { value: '2026-02-01', materialRange: window },
      ),
    ).toBe(m.entry_issueOutOfRange)
    expect(issueSentence('out-of-range', { type: 'decimal' })).toBe(m.entry_issueOutOfRange)
    expect(issueSentence('required', bound)).toBe(m.entry_issueRequired)
  })
})
