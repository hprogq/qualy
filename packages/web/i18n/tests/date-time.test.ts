import { afterEach, expect, it, vi } from 'vitest'
import { supportedLocales } from '@qualy/i18n-contract'
import { formatDateTime } from '../src/index.tsx'

afterEach(() => vi.restoreAllMocks())

it.each([
  ['en-US', 'Nov 7, 2026, 10:49:56 AM'],
  ['zh-CN', '2026年11月7日 10:49:56'],
] as const)(
  'uses pinned templates rather than the host date formatter in %s',
  (locale, expected) => {
    const Native = Intl.DateTimeFormat
    // tz uses the host's offset data, never its visible date/time patterns.
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (tag, options) {
      if (options?.timeZoneName === 'longOffset') return new Native(tag, options)
      throw new Error('A host formatter must not decide hydration text')
    })
    expect(formatDateTime(new Date('2026-11-07T10:49:56Z'), locale, 'event-time', 'UTC')).toBe(
      expected,
    )
  },
)

it.each(supportedLocales)('has templates and locale data for %s', (locale) => {
  expect(formatDateTime(new Date('2026-11-07T10:49:56Z'), locale, 'date', 'UTC')).toBeTruthy()
})

it('keeps render zones independent', () => {
  const at = new Date('2026-11-07T10:49:56Z')
  expect(formatDateTime(at, 'en-US', 'month-day-clock', 'Asia/Shanghai')).toBe('Nov 7, 18:49')
  expect(formatDateTime(at, 'en-US', 'month-day-clock', 'America/New_York')).toBe('Nov 7, 05:49')
  expect(formatDateTime(at, 'en-US', 'month-day-clock', 'Asia/Shanghai')).toBe('Nov 7, 18:49')
})
