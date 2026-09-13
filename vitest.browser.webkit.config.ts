import { defineConfig } from 'vitest/config'
import base from './vitest.browser.config.ts'

// The few screens whose defects are engine timing rather than logic - the
// cold start's hand-over, the brand's drawing - run once more in WebKit.
// Not the whole suite: that would buy every engine difference in every
// component for a class of bug that lives in two files. The hand-over's
// double wordmark and its doubled flight were both WebKit findings that
// Chromium hid, and this leg is what keeps them found.

const test = base.test!
export default defineConfig({
  ...base,
  test: {
    ...test,
    include: ['tests/cold-start.browser.test.tsx', 'tests/brand.browser.test.tsx'],
    browser: {
      ...test.browser!,
      instances: [{ browser: 'webkit' }],
    },
  },
})
