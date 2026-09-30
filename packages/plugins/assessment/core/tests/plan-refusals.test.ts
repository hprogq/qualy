import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { supportedLocales } from '@qualy/i18n-contract'
import { MAX_PLAN_PHASES } from '../src/api.ts'
import * as m from '#messages'

// A refused plan names its limit in the sentence the administrator reads.
// Written into the messages, the number and the api's own bound were two
// facts that agreed only until one of them moved.

describe('a plan refused for its length', () => {
  it('says the limit the api holds the plan to, in every locale', () => {
    for (const locale of supportedLocales) {
      const source = (
        JSON.parse(
          fs.readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'),
        ) as Record<string, string>
      )['refusal_planTooLong']!
      expect(source, locale).toContain('{most}')
      expect(source, locale).not.toContain(String(MAX_PLAN_PHASES))
      expect(m.refusal_planTooLong({ most: MAX_PLAN_PHASES }, { locale })).toContain(
        String(MAX_PLAN_PHASES),
      )
    }
  })
})
