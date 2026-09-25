import type { MessageDescriptor } from '@qualy/i18n-contract'
import { describe, expect, it } from 'vitest'
import { MAX_PLAN_PHASES } from '../src/api.ts'
import { planRefusalWords } from '../src/client/refusals.ts'
import { assessmentMessages as m } from '../src/client/i18n.ts'
import zhCN from '../src/client/locales/zh-CN.ts'

// A refused plan names its limit in the sentence the administrator reads.
// Written into the catalog, the number and the api's own bound were two
// facts that agreed only until one of them moved.

describe('a plan refused for its length', () => {
  it('says the limit the api holds the plan to, in every locale', () => {
    const asked: { id: string; values: unknown }[] = []
    const format = ((descriptor: MessageDescriptor, values?: unknown) => {
      asked.push({ id: descriptor.id, values })
      return descriptor.id
    }) as Parameters<typeof planRefusalWords>[0]
    planRefusalWords(format, 'plan-too-long')
    expect(asked).toEqual([
      { id: 'assessment/refusal/plan-too-long', values: { most: MAX_PLAN_PHASES } },
    ])
    for (const words of [
      m['refusal.plan-too-long'].defaultMessage,
      zhCN['assessment/refusal/plan-too-long'],
    ]) {
      expect(words).toContain('{most}')
      expect(words).not.toContain(String(MAX_PLAN_PHASES))
    }
  })
})
