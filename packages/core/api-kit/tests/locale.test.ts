import { describe, expect, it } from 'vitest'
import { localeOfAcceptLanguage, localeOfRequest } from '../src/locale.ts'

// The page names its language, the cookie a choice wrote comes next, then
// what the browser's settings ask for, then the product's own.

const request = (headers: Record<string, string>, cookies: Record<string, string> = {}) => ({
  headers,
  cookies,
})

describe('the language an answer is written in', () => {
  it("takes the page's own before anything the browser says", () => {
    expect(
      localeOfRequest(
        request(
          { 'x-qualy-locale': 'en-US', 'accept-language': 'zh-CN' },
          { 'qualy.locale': 'zh-CN' },
        ),
      ),
    ).toBe('en-US')
  })

  it('takes a choice kept in this browser next, then its settings, then the product default', () => {
    expect(
      localeOfRequest(request({ 'accept-language': 'zh-CN' }, { 'qualy.locale': 'en-US' })),
    ).toBe('en-US')
    expect(localeOfRequest(request({ 'accept-language': 'en-GB,en;q=0.8' }))).toBe('en-US')
    expect(localeOfRequest(request({}))).toBe('zh-CN')
  })

  it('ignores what it does not speak', () => {
    expect(localeOfRequest(request({ 'x-qualy-locale': 'fr-FR' }, { 'qualy.locale': 'de' }))).toBe(
      'zh-CN',
    )
  })

  it('reads Accept-Language by weight, not by order', () => {
    expect(localeOfAcceptLanguage('fr;q=0.9, en-US;q=0.5, zh-TW;q=0.7')).toBe('zh-CN')
    expect(localeOfAcceptLanguage('*, fr')).toBeUndefined()
    expect(localeOfAcceptLanguage('en;q=0, zh')).toBe('zh-CN')
  })
})
