import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { defaultLocale, supportedLocales } from '@qualy/i18n-contract'
import { bootFrame } from '../../packages/web/brand/src/boot.ts'
import { bootstrapMessages } from '../../packages/web/i18n/src/bootstrap.ts'

// The page the edge serves while no release answers - an upgrade under
// maintenance, or both colors down - is the one screen of Qualy no build
// touches: the proxy hands deploy/demo/maintenance.html out as it stands
// (ops/reverse-proxy/Caddyfile). So it is written by hand, and held here to
// what it stands in for: the first frame's wordmark in the first frame's
// place, the application's colours, its words from the bootstrap table in
// every locale, the locale and theme resolved the way the shell resolves
// them, and nothing fetched from the server that is down.
//
// Everything the page needs is in the file. While it is up, every request
// that is not the API's is answered with it - a favicon included - so the
// icon is a data URI and nothing else is linked.

const ROOT = path.resolve(import.meta.dirname, '../..')
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8')
const page = read('deploy/demo/maintenance.html')
const shell = read('apps/web/index.html')
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

  it('resolves the locale and the theme as the shell does', () => {
    for (const key of ['qualy.theme', 'qualy.locale']) {
      expect(page).toContain(`localStorage.getItem('${key}')`)
      expect(shell).toContain(`localStorage.getItem('${key}')`)
    }
    const listed = /var locales = (\[[^\]]*\])/.exec(page)?.[1]
    expect(JSON.parse(listed!.replaceAll("'", '"'))).toEqual([...supportedLocales])
    expect(page).toContain(`if (locale === null) locale = '${defaultLocale}'`)
    const resolution = (source: string) =>
      /var languages[\s\S]*?root\.setAttribute\('data-locale', locale\)/.exec(source)?.[0]
    expect(resolution(page)).toBeDefined()
    expect(resolution(page)).toBe(resolution(shell))
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
