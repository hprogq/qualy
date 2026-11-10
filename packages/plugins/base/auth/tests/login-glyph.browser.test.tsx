import { ThemeProvider } from '@qualy/web-runtime'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LoginMethodGlyph } from '../src/client/sign-in/glyph.tsx'
import { authUrls } from '../src/client/api.ts'
import './support/screen.tsx'

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aN8AAAAASUVORK5CYII='
const icon = { kind: 'image' as const, version: 'light', onDark: 'dark' }
const image = (surface: 'light' | 'dark' = 'light') => (
  <ThemeProvider>
    <LoginMethodGlyph code="school" name="School" icon={icon} surface={surface} />
  </ThemeProvider>
)
afterEach(() => vi.restoreAllMocks())
describe('uploaded login method image', () => {
  it('keeps the image visible before hydration when it loaded early', async () => {
    vi.spyOn(authUrls.loginIcon, 'getLoginMethodIcon').mockReturnValue(PNG)
    const host = document.createElement('div')
    host.innerHTML = renderToString(image())
    document.body.append(host)
    const glyph = host.querySelector<HTMLElement>('[data-login-glyph-state]')!
    const img = glyph.querySelector('img')!
    await expect.poll(() => img.complete && img.naturalWidth > 0).toBe(true)
    // The parser-time image listener can update the paint before hydration.
    glyph.dataset.loginGlyphState = 'loaded'
    const bone = glyph.querySelector<HTMLElement>('[data-login-glyph-placeholder]')!
    expect(getComputedStyle(bone).display).toBe('none')
    const errors: unknown[] = []
    const root = hydrateRoot(host, image(), { onRecoverableError: (error) => errors.push(error) })
    try {
      await expect.poll(() => glyph.dataset.loginGlyphState).toBe('loaded')
      expect(glyph.querySelector('img')).toBe(img)
      expect(errors).toEqual([])
    } finally {
      root.unmount()
      host.remove()
    }
  })
  it('falls back to the initial if the image fails', async () => {
    vi.spyOn(authUrls.loginIcon, 'getLoginMethodIcon').mockReturnValue(
      'data:image/png;base64,invalid',
    )
    const host = document.createElement('div')
    host.innerHTML = renderToString(image())
    document.body.append(host)
    const glyph = host.querySelector<HTMLElement>('[data-login-glyph-state]')!
    const img = glyph.querySelector('img')!
    await expect.poll(() => img.complete).toBe(true)
    expect(img.naturalWidth).toBe(0)
    // The early error listener displays the fallback before hydration too.
    glyph.dataset.loginGlyphState = 'error'
    const errors: unknown[] = []
    const root = hydrateRoot(host, image(), { onRecoverableError: (error) => errors.push(error) })
    try {
      await expect
        .poll(
          () =>
            host.querySelector<HTMLElement>('[data-login-glyph-state]')?.dataset.loginGlyphState,
        )
        .toBe('error')
      expect(getComputedStyle(glyph.querySelector('img')!).visibility).toBe('hidden')
      expect(
        getComputedStyle(glyph.querySelector<HTMLElement>('[data-login-glyph-placeholder]')!)
          .display,
      ).toBe('none')
      expect(glyph.textContent).toContain('S')
      expect(errors).toEqual([])
    } finally {
      root.unmount()
      host.remove()
    }
  })
  it('loads each surface independently when its icon changes', async () => {
    vi.spyOn(authUrls.loginIcon, 'getLoginMethodIcon').mockImplementation((options) =>
      options.query?.surface === 'dark' ? `${PNG}#dark` : PNG,
    )
    const host = document.createElement('div')
    host.innerHTML = renderToString(image())
    document.body.append(host)
    const root = hydrateRoot(host, image())
    try {
      const glyph = host.querySelector<HTMLElement>('[data-login-glyph-state]')!
      await expect.poll(() => glyph.dataset.loginGlyphState).toBe('loaded')
      root.render(image('dark'))
      await expect.poll(() => glyph.dataset.version).toBe('dark')
      await expect.poll(() => glyph.dataset.loginGlyphState).toBe('loaded')
      expect(glyph.querySelector('img')?.getAttribute('src')).toBe(`${PNG}#dark`)
      root.render(image('light'))
      await expect.poll(() => glyph.dataset.version).toBe('light')
      await expect.poll(() => glyph.dataset.loginGlyphState).toBe('loaded')
    } finally {
      root.unmount()
      host.remove()
    }
  })
  it('disables placeholder animation for reduced motion', async () => {
    expect(matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(true)
    vi.spyOn(authUrls.loginIcon, 'getLoginMethodIcon').mockReturnValue('/never-loaded')
    const host = document.createElement('div')
    host.innerHTML = renderToString(image())
    document.body.append(host)
    try {
      const bone = host.querySelector<HTMLElement>('[data-login-glyph-placeholder]')!
      expect(getComputedStyle(bone).animationName).toBe('none')
      expect(getComputedStyle(bone).display).toBe('block')
      expect(bone.getBoundingClientRect().width).toBe(20)
      expect(bone.getBoundingClientRect().height).toBe(20)
    } finally {
      host.remove()
    }
  })
})
