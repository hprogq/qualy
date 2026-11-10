import { playwright } from '@vitest/browser-playwright'
import { mergeConfig } from 'vitest/config'
import base from './vitest.browser.config.ts'

// Exercise the date-time control across a device clock's DST transition.
export default mergeConfig(base, {
  test: {
    include: ['tests/date-time-picker.browser.test.tsx'],
    browser: {
      provider: playwright({
        contextOptions: { reducedMotion: 'reduce', timezoneId: 'America/New_York' },
      }),
    },
  },
})
