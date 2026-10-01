import { defineConfig } from 'vitest/config'
import base from './vitest.browser.config.ts'

// Engine-sensitive cold-start timing and shared keyboard controls also run in
// WebKit. Pointer focus and text selection differ from Chromium; these tests
// guard the actual time-entry and nested Escape regressions found there.

const test = base.test!
export default defineConfig({
  ...base,
  test: {
    ...test,
    include: [
      'tests/cold-start.browser.test.tsx',
      'tests/brand.browser.test.tsx',
      'tests/date-time-picker.browser.test.tsx',
      'tests/form-controls.browser.test.tsx',
      'tests/overlay-widgets.browser.test.tsx',
    ],
    browser: {
      ...test.browser!,
      instances: [{ browser: 'webkit' }],
    },
  },
})
