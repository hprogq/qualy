import { afterEach, expect, it, vi } from 'vitest'
import { formatDateTime } from '../src/date-time.ts'

afterEach(() => vi.restoreAllMocks())

it.each([
  ['en-US', 'Sep 19, 05:30'],
  ['zh-CN', '9月19日 05:30'],
] as const)('owns date/time punctuation in %s across ICU versions', (locale, expected) => {
  const Native = Intl.DateTimeFormat
  vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (locale, options) {
    if (options?.month !== undefined && options.hour !== undefined)
      throw new Error('The date/time join must not depend on the host ICU pattern')
    return new Native(locale, options)
  })
  expect(
    formatDateTime(
      new Date('2026-09-19T05:30:00Z'),
      locale,
      { month: 'short', day: 'numeric', timeZone: 'UTC' },
      { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' },
    ),
  ).toBe(expected)
})
