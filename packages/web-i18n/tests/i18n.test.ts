import { setupI18n } from '@lingui/core'
import { compileMessage } from '@lingui/message-utils/compileMessage'
import { uiTextSchema, literal, message, type MessageCatalog } from '@qualy/i18n-contract'
import { describe, expect, it } from 'vitest'
import { loadCatalogs, resolveLocale } from '../src/index.tsx'
import zhCN from '../src/catalogs/zh-CN.ts'
import { commonMessages } from '../src/messages.ts'
import {
  commonErrorMessages,
  formatApiError,
  networkErrorMessage,
  unexpectedErrorMessage,
  type MessageFormatter,
} from '../src/format.ts'

// a formatter over the real icu engine: catalog hit wins, otherwise the
// descriptor's english default is formatted
const formatterFor = (catalog: MessageCatalog, locale = 'zh-CN'): MessageFormatter => {
  const i18n = setupI18n()
  i18n.setMessagesCompiler(compileMessage)
  i18n.load(locale, catalog)
  i18n.activate(locale)
  return {
    format: (descriptor, values) =>
      i18n._({ id: descriptor.id, message: descriptor.defaultMessage, values }),
  }
}

const apiError = (code: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error('backend fallback message'), { name: 'ORPCError', code, ...extra })

describe('web i18n runtime', () => {
  it('translates through the catalog and falls back to the english default', () => {
    const formatter = formatterFor(zhCN)
    expect(formatter.format(commonMessages.retry)).toBe('重试')
    expect(formatter.format(commonMessages.componentMissing, { component: 'org/OrgPage' })).toBe(
      '渲染器缺失：org/OrgPage',
    )
    // an untranslated id renders its english default, never an empty string
    expect(formatter.format({ id: 'x/untranslated', defaultMessage: 'Plain default' })).toBe(
      'Plain default',
    )
  })

  it('formats icu plurals per locale', () => {
    const descriptor = {
      id: 'test/count',
      defaultMessage: '{n, plural, one {# item} other {# items}}',
    }
    expect(formatterFor({}, 'en-US').format(descriptor, { n: 1 })).toBe('1 item')
    expect(formatterFor({}, 'en-US').format(descriptor, { n: 3 })).toBe('3 items')
    expect(formatterFor({ 'test/count': '{n} 项' }).format(descriptor, { n: 3 })).toBe('3 项')
  })

  it('resolves api errors by code, data and transport failure', () => {
    const formatter = formatterFor(zhCN)
    // network failures never carry a code
    expect(formatApiError(new TypeError('fetch failed'), formatter)).toBe(
      formatter.format(networkErrorMessage),
    )
    // common codes are owned by the runtime
    expect(formatApiError(apiError('FORBIDDEN'), formatter)).toBe('你没有执行该操作的权限。')
    // a plugin registry wins over the common map and projects typed data
    const registry = {
      DEMO_INCOMPATIBLE: {
        message: { id: 'demo/error/incompatible', defaultMessage: '{count} blocked' },
        values: (data: unknown) => ({ count: (data as { count: number }).count }),
      },
      FORBIDDEN: {
        message: { id: 'demo/error/forbidden', defaultMessage: 'Plugin says no' },
      },
    }
    expect(
      formatApiError(apiError('DEMO_INCOMPATIBLE', { data: { count: 3 } }), formatter, registry),
    ).toBe('3 blocked')
    expect(formatApiError(apiError('FORBIDDEN'), formatter, registry)).toBe('Plugin says no')
    // an unmapped code degrades to the backend english message
    expect(formatApiError(apiError('SOMETHING_NEW'), formatter, registry)).toBe(
      'backend fallback message',
    )
    // a non-api throwable degrades to the generic message
    expect(formatApiError({ oops: true }, formatter)).toBe(
      formatter.format(unexpectedErrorMessage),
    )
  })

  it('keeps the zh-CN catalog complete and free of orphans', () => {
    const declared = new Set([
      ...Object.values(commonMessages).map((descriptor) => descriptor.id),
      ...Object.values(commonErrorMessages).map((entry) => entry.message.id),
      networkErrorMessage.id,
      unexpectedErrorMessage.id,
    ])
    const translated = new Set(Object.keys(zhCN))
    expect([...declared].filter((id) => !translated.has(id))).toEqual([])
    expect([...translated].filter((id) => !declared.has(id))).toEqual([])
  })

  it('validates ui text references at the contract boundary', () => {
    expect(uiTextSchema.parse(message('org/navigation/organization', 'Organization'))).toEqual({
      kind: 'message',
      id: 'org/navigation/organization',
      defaultMessage: 'Organization',
    })
    // business data passes through untranslated
    expect(uiTextSchema.parse(literal('软件学院'))).toEqual({ kind: 'literal', value: '软件学院' })
    // a bare string, an unnamespaced id or an empty default are rejected
    expect(uiTextSchema.safeParse('组织架构').success).toBe(false)
    expect(
      uiTextSchema.safeParse({ kind: 'message', id: 'organization', defaultMessage: 'x' }).success,
    ).toBe(false)
    expect(
      uiTextSchema.safeParse({ kind: 'message', id: 'org/nav', defaultMessage: '' }).success,
    ).toBe(false)
  })

  it('resolves the locale through the documented preference chain', () => {
    // a stored preference always wins
    expect(resolveLocale({ stored: 'en-US', preferred: ['zh-CN'] })).toBe('en-US')
    // an unsupported or absent preference falls through to the browser
    expect(resolveLocale({ stored: 'fr-FR', preferred: ['en-US'] })).toBe('en-US')
    // exact match beats a later subtag match
    expect(resolveLocale({ preferred: ['en-GB', 'en-US'] })).toBe('en-US')
    // a subtag match is accepted when no exact match exists
    expect(resolveLocale({ preferred: ['zh-TW'] })).toBe('zh-CN')
    // nothing usable falls back to the deployment default
    expect(resolveLocale({ preferred: ['fr-FR', 'de-DE'] })).toBe('zh-CN')
    expect(resolveLocale({})).toBe('zh-CN')
  })

  it('merges the common catalog with every plugin catalog for a locale', async () => {
    const merged = await loadCatalogs('zh-CN', [
      {
        namespace: 'demo',
        messages: [{ id: 'demo/a', defaultMessage: 'A' }],
        locales: { 'zh-CN': () => Promise.resolve({ default: { 'demo/a': '甲' } }) },
      },
      {
        // a plugin without a catalog for this locale contributes nothing
        namespace: 'other',
        messages: [{ id: 'other/a', defaultMessage: 'B' }],
        locales: {},
      },
    ])
    expect(merged['demo/a']).toBe('甲')
    expect(merged['other/a']).toBeUndefined()
    expect(merged['common/action/retry']).toBe('重试')
  })
})
