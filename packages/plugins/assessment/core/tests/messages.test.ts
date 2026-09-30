import { describe, expect, it } from 'vitest'
import * as m from '#messages'

// What the package's #messages facade promises beyond what Paraglide types:
// an ICU plural reads a number, and a message said anywhere that is not a
// page is told its language rather than guessing one.

describe("this package's messages", () => {
  it('takes a number where a plural reads one', () => {
    expect(m.roster_count({ count: 2 }, { locale: 'en-US' })).toContain('2')
    // @ts-expect-error a plural reads a number, not a string
    void (() => m.roster_count({ count: 'abc' }, { locale: 'en-US' }))
  })

  it('refuses to guess a language where there is no page', () => {
    expect(() => m.roster_count({ count: 1 })).toThrow(/no locale/)
    expect(m.roster_count({ count: 1 }, { locale: 'zh-CN' })).not.toBe(
      m.roster_count({ count: 1 }, { locale: 'en-US' }),
    )
  })
})
