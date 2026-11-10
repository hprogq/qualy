import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { defaultLocale, supportedLocales } from '@qualy/i18n-contract'
import { bootFrame } from '../../packages/web/brand/src/boot.ts'
import { bootstrapMessages } from '../../packages/web/i18n/src/bootstrap.ts'
import { localeOfRequest } from '../../packages/core/api-kit/src/locale.ts'

// The page the edge serves while no release answers - an upgrade under
// maintenance, or both colors down - is the one screen of Qualy no build
// touches: the proxy hands deploy/demo/maintenance.html out as it stands
// (ops/reverse-proxy/Caddyfile). So it is written by hand, and held here to
// what it stands in for: the first frame's wordmark in the first frame's
// place, the application's colours, its words from the bootstrap table in
// every locale, the theme resolved the way a document resolves it and the
// language the server would have drawn the page in, and nothing fetched
// from the server that is down.
//
// Everything the page needs is in the file. While it is up, every request
// that is not the API's is answered with it - a favicon included - so the
// icon is a data URI and nothing else is linked.

const ROOT = path.resolve(import.meta.dirname, '../..')
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8')
const page = read('deploy/demo/maintenance.html')
const document = read('apps/web/src/rsc/early-document.ts')
const tokens = read('packages/web/ui/src/styles/tokens.css')
const caddy = read('ops/reverse-proxy/Caddyfile')

const attribute = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1]
const svgOf = (source: string) => {
  const svg = /<svg[\s\S]*?<\/svg>/.exec(source)?.[0] ?? ''
  const open = /<svg[\s\S]*?>/.exec(svg)?.[0] ?? ''
  return {
    viewBox: attribute(open, 'viewBox'),
    width: attribute(open, 'width'),
    height: attribute(open, 'height'),
    paths: [...svg.matchAll(/<path[\s\S]*?\/>/g)].map((match) => attribute(match[0], 'd')),
  }
}
const token = (block: 'light' | 'dark', name: string) => {
  const start =
    block === 'light' ? tokens.indexOf(':root {') : tokens.indexOf(":root[data-mode='dark']")
  return new RegExp(`--q-${name}:\\s*([^;]+);`).exec(tokens.slice(start))?.[1]
}

describe('the maintenance page', () => {
  it('draws the first frame: the same wordmark, in the same place', () => {
    const frame = bootFrame()
    const drawn = svgOf(page)
    expect(drawn).toEqual(svgOf(frame.svg))
    expect(drawn.paths.length).toBeGreaterThan(2)
    const placed = /<main style="([^"]*)"/.exec(page)?.[1]?.replace(/\s+/g, '')
    expect(placed).toBe(
      `--boot-top:${frame.placement.top};--boot-hint-gap:${String(frame.placement.hintGap)}px`.replace(
        /\s+/g,
        '',
      ),
    )
  })

  it('says what the bootstrap table says, in every locale', () => {
    for (const locale of supportedLocales) {
      const block = new RegExp(`data-copy="${locale}">([\\s\\S]*?)</div>`).exec(page)?.[1]
      expect(block, locale).toBeDefined()
      expect(/<h1>([\s\S]*?)<\/h1>/.exec(block!)?.[1]?.trim()).toBe(
        bootstrapMessages[locale].maintenanceTitle,
      )
      expect(/<p>([\s\S]*?)<\/p>/.exec(block!)?.[1]?.trim()).toBe(
        bootstrapMessages[locale].maintenanceHint,
      )
      // shown only for its own locale
      expect(page).toContain(`html[data-locale='${locale}'] [data-copy='${locale}']`)
    }
    // before any script runs, and when none can, the default locale is shown
    expect(page).toContain(`<html lang="${defaultLocale}" data-locale="${defaultLocale}"`)
  })

  it('resolves the theme from the key the document resolves it from', () => {
    expect(page).toContain(`localStorage.getItem('qualy.theme')`)
    expect(document).toContain(`localStorage.getItem('qualy.theme')`)
  })

  it('picks the language the server would have drawn the page in', () => {
    const listed = /var locales = (\[[^\]]*\])/.exec(page)?.[1]
    expect(JSON.parse(listed!.replaceAll("'", '"'))).toEqual([...supportedLocales])
    // Execute the marked source of this checked-in fixture, not arbitrary HTML.
    const [, afterStart, ...starts] = page.split('// maintenance-bootstrap:start')
    const [script, afterEnd, ...ends] = (afterStart ?? '').split('// maintenance-bootstrap:end')
    if (script === undefined || afterEnd === undefined || starts.length + ends.length !== 0)
      throw new Error('Expected exactly one marked maintenance bootstrap')
    const decided = (cookie: string, languages: readonly string[]) => {
      const root = {
        lang: '',
        style: {} as Record<string, string>,
        classList: { add: () => {} },
        attributes: {} as Record<string, string>,
        setAttribute(name: string, value: string) {
          this.attributes[name] = value
        },
      }
      // eslint-disable-next-line typescript/no-implied-eval -- runs the page's own script in a stand-in browser
      new Function(
        'document',
        'localStorage',
        'matchMedia',
        'navigator',
        'fetch',
        'setTimeout',
        'location',
        script,
      )(
        { cookie, documentElement: root },
        { getItem: () => null },
        () => ({ matches: false }),
        { languages, language: languages[0] },
        () => Promise.resolve({ ok: false }),
        () => 0,
        { reload: () => {} },
      )
      return root.attributes['data-locale']
    }
    for (const [cookie, languages] of [
      ['qualy.locale=en-US', ['zh-CN']],
      ['qualy.locale=xx', ['en-GB', 'zh-CN']],
      ['', ['fr-FR', 'en']],
      ['', ['fr-FR']],
      ['', []],
    ] as const) {
      const server = localeOfRequest({
        headers: { 'accept-language': languages.join(',') },
        cookies: Object.fromEntries(cookie === '' ? [] : [cookie.split('=') as [string, string]]),
      })
      expect(decided(cookie, languages), `${cookie} ${languages.join(',')}`).toBe(server)
    }
  })

  it("paints in the application's colours, light and dark", () => {
    for (const [mode, selector] of [
      ['light', /html \{([\s\S]*?)\}/],
      ['dark', /html\[data-mode='dark'\] \{([\s\S]*?)\}/],
    ] as const) {
      const rule = selector.exec(page)?.[1] ?? ''
      expect(rule, mode).toContain(`background: ${token(mode, 'background')!};`)
      expect(rule, mode).toContain(`color: ${token(mode, 'foreground')!};`)
      expect(rule, mode).toContain(`--muted: ${token(mode, 'muted-foreground')!};`)
    }
  })

  it('needs nothing from the server that is down', () => {
    const link = /<link[^>]*rel="icon"[^>]*>/.exec(page)?.[0] ?? ''
    expect(attribute(link, 'type')).toBe('image/svg+xml')
    const icon = /^data:image\/svg\+xml,(.+)$/.exec(attribute(link, 'href') ?? '')?.[1]
    expect(icon).toBeDefined()
    expect(decodeURIComponent(icon!)).toBe(read('apps/web/public/favicon.svg').trim())
    // no other link, image or script source: every one of them would be answered with this page
    expect(page.match(/\s(?:src|href)="/g)).toHaveLength(1)
    // it comes back on its own: the probe, and a refresh when scripts cannot run
    expect(page).toContain("fetch('/health/ready', { cache: 'no-store' })")
    expect(page).toMatch(/<noscript><meta http-equiv="refresh" content="\d+" \/><\/noscript>/)
  })

  it('is what the edge serves, and the API is answered in its own error shape', () => {
    const errors = /handle_errors 502 503 504 \{([\s\S]*?)\n\t\}/.exec(caddy)?.[1] ?? ''
    expect(errors).toContain('root * /opt/qualy/current/deploy/demo')
    expect(errors).toContain('rewrite * /maintenance.html')
    const body = /respond `(\{[^`]*\})` 503/.exec(errors)?.[1]
    expect(body).toBeDefined()
    const parsed = JSON.parse(body!) as Record<string, unknown>
    expect(parsed).toEqual({ _tag: 'SERVICE_UNAVAILABLE', message: expect.any(String) })
  })
})
