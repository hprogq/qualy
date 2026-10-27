import { describe, expect, it } from 'vitest'
import { localeOfAcceptLanguage } from '../src/index.ts'

describe('the language an Accept-Language header asks for', () => {
  it('goes by weight, not by which tag comes first', () => {
    expect(localeOfAcceptLanguage('en;q=0.2, zh;q=1')).toBe('zh-CN')
    expect(localeOfAcceptLanguage('en;q=0.1,zh-CN;q=0.9')).toBe('zh-CN')
  })

  it('never answers in a language the reader refused', () => {
    expect(localeOfAcceptLanguage('zh;q=0, en;q=1')).toBe('en-US')
    expect(localeOfAcceptLanguage('zh-CN;q=0,en;q=1')).toBe('en-US')
  })

  it('passes over what it does not speak to the next it does', () => {
    expect(localeOfAcceptLanguage('fr-FR, zh-CN;q=0.9, en;q=0.5')).toBe('zh-CN')
    expect(localeOfAcceptLanguage('zh-Hant-TW')).toBe('zh-CN')
  })

  it('names none when nothing asked for is spoken', () => {
    expect(localeOfAcceptLanguage(undefined)).toBeUndefined()
    expect(localeOfAcceptLanguage('')).toBeUndefined()
    expect(localeOfAcceptLanguage('*')).toBeUndefined()
    expect(localeOfAcceptLanguage('fr, de;q=0.5')).toBeUndefined()
  })
})
