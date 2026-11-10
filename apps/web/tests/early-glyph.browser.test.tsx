import { describe, expect, it } from 'vitest'
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
