import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatList } from '../src/list.ts'

describe('compact list enumeration', () => {
  beforeEach(() => {
    // Host ICU data must not decide compact enumeration punctuation.
    vi.spyOn(Intl, 'ListFormat').mockImplementation(() => {
      throw new Error('Compact enumeration must not use Intl.ListFormat')
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    { locale: 'zh-CN', items: [], expected: '' },
    { locale: 'zh-CN', items: ['A'], expected: 'A' },
    { locale: 'zh-CN', items: ['A', 'B'], expected: 'A、B' },
    { locale: 'zh-CN', items: ['A', 'B', 'C'], expected: 'A、B、C' },
    { locale: 'en-US', items: [], expected: '' },
    { locale: 'en-US', items: ['A'], expected: 'A' },
    { locale: 'en-US', items: ['A', 'B'], expected: 'A, B' },
    { locale: 'en-US', items: ['A', 'B', 'C'], expected: 'A, B, C' },
  ] as const)('$locale enumerates $items as "$expected"', ({ locale, items, expected }) => {
    // No document is present: SSR must use the explicit locale as well.
    expect(formatList(items, locale)).toBe(expected)
  })
})
