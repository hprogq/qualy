import { describe, expect, it } from 'vitest'
import {
  DOCUMENT_ENTRANCE_KEY,
  prepareDocumentEntrance,
} from '@qualy/web-runtime/document-entrance'
import { prepareDocument } from '../src/rsc/early-document.ts'

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aN8AAAAASUVORK5CYII='
describe('login glyphs before hydration', () => {
  it('records real image success and failure before React attaches', async () => {
    expect(prepareDocument(document.documentElement)).toBe(true)
    const host = document.createElement('div')
    host.innerHTML = `<span data-login-glyph-state="pending"><img data-login-glyph-image src="${PNG}" /></span><span data-login-glyph-state="pending"><img data-login-glyph-image src="data:image/png;base64,invalid" /></span>`
    document.body.append(host)
    try {
      const glyphs = host.querySelectorAll<HTMLElement>('[data-login-glyph-state]')
      await expect.poll(() => glyphs[0]?.dataset.loginGlyphState).toBe('loaded')
      await expect.poll(() => glyphs[1]?.dataset.loginGlyphState).toBe('error')
      expect(glyphs[0]?.querySelector('img')?.naturalWidth).toBeGreaterThan(0)
    } finally {
      host.remove()
    }
  })
})

describe('document entrance intent', () => {
  it('animates explicit identity transitions once and leaves external visits visible', () => {
    const root = document.createElement('div')
    sessionStorage.removeItem(DOCUMENT_ENTRANCE_KEY)
    prepareDocument(root, DOCUMENT_ENTRANCE_KEY)
    expect(root.hasAttribute('data-document-entrance')).toBe(false)
    prepareDocumentEntrance(location.href)
    prepareDocument(root, DOCUMENT_ENTRANCE_KEY)
    expect(root.hasAttribute('data-document-entrance')).toBe(true)
    expect(sessionStorage.getItem(DOCUMENT_ENTRANCE_KEY)).toBeNull()
    root.removeAttribute('data-document-entrance')
    prepareDocument(root, DOCUMENT_ENTRANCE_KEY)
    expect(root.hasAttribute('data-document-entrance')).toBe(false)
  })
  it('ignores stale, cancelled-target and malformed intents', () => {
    const root = document.createElement('div')
    for (const intent of [
      'broken',
      JSON.stringify({ at: Date.now() - 700_000 }),
      JSON.stringify({ at: Date.now(), target: '/a-different-page' }),
    ]) {
      sessionStorage.setItem(DOCUMENT_ENTRANCE_KEY, intent)
      prepareDocument(root, DOCUMENT_ENTRANCE_KEY)
      expect(root.hasAttribute('data-document-entrance')).toBe(false)
      expect(sessionStorage.getItem(DOCUMENT_ENTRANCE_KEY)).toBeNull()
    }
  })
})
