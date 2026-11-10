import { describe, expect, it } from 'vitest'
import { localeOfRequest } from '@qualy/api-kit/locale'
import { documentCookies } from '../src/rsc/document-cookies.ts'

describe('document cookies', () => {
  it('preserves a valid locale alongside an unrelated malformed value', () => {
    const cookies = documentCookies('other=%E0%A4%A; qualy.locale=en%2DUS')
    expect(localeOfRequest({ headers: {}, cookies })).toBe('en-US')
  })

  it('falls back from a malformed locale without affecting valid cookies', () => {
    const cookies = documentCookies('qualy.locale=%FF; other=valid%20value')
    expect(cookies.other).toBe('valid value')
    expect(localeOfRequest({ headers: { 'accept-language': 'zh-CN' }, cookies })).toBe('zh-CN')
  })
})
