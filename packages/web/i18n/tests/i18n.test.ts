import { supportedLocales } from '@qualy/i18n-contract'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveLocale } from '../src/index.tsx'
import { bootstrapMessages } from '../src/bootstrap.ts'
import {
  assertNever,
  isUseCaseApiFailure,
  formatPlatformFailure,
  isTransportError,
} from '../src/format.ts'
import * as commonMessages from '#messages'

// A page's language is marked on its root, and a message reads it there;
// outside a page nothing is marked, so a message is given its locale.
const onPage = (locale: string) => {
  ;(globalThis as { document?: unknown }).document = {
    documentElement: { dataset: { locale } },
  }
}

afterEach(() => {
  delete (globalThis as { document?: unknown }).document
})

// what an http api error decodes back into: the tagged class itself, its
// fields on the instance, and the english message the server sends for
// clients that do not localize
const apiError = (code: string, fields: Record<string, unknown> = {}) =>
  Object.assign(new Error('backend fallback message'), { _tag: code, ...fields })

describe('web i18n runtime', () => {
  it('says a message in the language of the page it is on', () => {
    onPage('zh-CN')
    expect(commonMessages.action_retry()).toBe(commonMessages.action_retry({}, { locale: 'zh-CN' }))
    onPage('en-US')
    expect(commonMessages.action_retry()).toBe(commonMessages.action_retry({}, { locale: 'en-US' }))
    expect(commonMessages.action_retry({}, { locale: 'zh-CN' })).not.toBe(
      commonMessages.action_retry({}, { locale: 'en-US' }),
    )
  })

  it('refuses to guess a language where there is no page', () => {
    expect(() => commonMessages.action_retry()).toThrow(/no locale/)
  })

  it('resolves api errors by code, data and transport failure', () => {
    onPage('zh-CN')
    // network failures never carry a code
    expect(formatPlatformFailure(new TypeError('fetch failed'))).toBe(
      commonMessages.error_network(),
    )
    // and what a screen actually receives is the http client's wrapper, not
    // the fetch's own TypeError: the runtime turns every browser call into an
    // effect, and this shape is what its failure squashes to
    const unreachable = Object.assign(new Error('Transport error'), {
      _tag: 'HttpClientError',
      reason: { _tag: 'TransportError' },
    })
    expect(isTransportError(unreachable)).toBe(true)
    expect(formatPlatformFailure(unreachable)).toBe(commonMessages.error_network())
    // a refusal that DID reach the server is not a transport failure
    expect(isTransportError(apiError('ACCESS_DENIED'))).toBe(false)
    // common codes are owned by the runtime
    expect(formatPlatformFailure(apiError('ACCESS_DENIED'))).toBe(
      commonMessages.error_accessDenied(),
    )
    expect(formatPlatformFailure(apiError('SOMETHING_NEW'))).toBe(commonMessages.error_unexpected())
    // a non-api throwable degrades to the generic message
    expect(formatPlatformFailure({ oops: true })).toBe(commonMessages.error_unexpected())
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

  it('says every line said before the application, in every locale', () => {
    for (const locale of supportedLocales) {
      for (const line of Object.values(bootstrapMessages[locale])) expect(line.trim()).not.toBe('')
    }
    // the same message, whichever side of the start it is said on
    expect(bootstrapMessages['en-US'].retry).toBe(
      commonMessages.action_retry({}, { locale: 'en-US' }),
    )
  })
})

it('separates platform failures while preserving exhaustive domain payloads', () => {
  type Failure =
    | { _tag: 'EXAMPLE_MISSING'; id: string }
    | { _tag: 'EXAMPLE_CONFLICT'; count: number }
    | { _tag: 'ACCESS_DENIED' }
  const say = (error: Failure) => {
    const domain = isUseCaseApiFailure(error) ? error : undefined
    if (domain === undefined) return 'platform'
    switch (domain._tag) {
      case 'EXAMPLE_MISSING':
        return domain.id
      case 'EXAMPLE_CONFLICT':
        return `${domain.count} conflicts`
      default:
        return assertNever(domain)
    }
  }
  expect(say({ _tag: 'EXAMPLE_CONFLICT', count: 3 })).toBe('3 conflicts')
  expect(say({ _tag: 'ACCESS_DENIED' })).toBe('platform')
  const domain = { _tag: 'EXAMPLE_MISSING', id: 'x' } as Failure
  if (domain && domain._tag === 'EXAMPLE_MISSING') {
    // @ts-expect-error another endpoint failure's payload is inaccessible
    void domain.count
  }
})
