import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { fixed, wordmarkLayout } from '../../packages/web/brand/src/geometry.ts'

// What index.html carries, and why, since the file itself ships to every
// browser and explains nothing:
//
// - the cascade layer order, declared before any stylesheet can declare its
//   own (a layer's position is fixed by its first declaration; in dev the
//   StyleX runtime's sheet arrives ahead of app.css), kept in step with
//   src/app.css and tests/support/cascade-layers.ts;
// - a script that resolves the colour scheme before anything paints, from
//   the same key the runtime's ThemeProvider persists under and the system
//   preference when nothing is stored, setting the same class the tokens
//   switch on, so the first frame is painted in the colours the application
//   keeps;
// - the first frame: the wordmark, before any script has run, in the place
//   and at the size the loading screen takes it over at, in the
//   application's own background and foreground tokens.
//
// The wordmark is written by hand - a static file cannot import the geometry
// - and the loading screen draws the same wordmark from the geometry at run
// time. The two must not drift: same paths, same size, same place, same
// colours, same theme key. A gate of the repository rather than of the brand
// package, because it reads files and the web-side programs are typed
// without node.

const ROOT = path.resolve(import.meta.dirname, '../..')
const html = fs.readFileSync(path.join(ROOT, 'apps/web/index.html'), 'utf8')
const theme = fs.readFileSync(path.join(ROOT, 'packages/web/runtime/src/theme.tsx'), 'utf8')
const tokens = fs.readFileSync(path.join(ROOT, 'packages/web/ui/src/styles/tokens.css'), 'utf8')

const CAP = 28
const layout = wordmarkLayout(16)
const [, top = 0, width = 0, height = 0] = layout.viewBox.split(' ').map(Number)
const scale = CAP / layout.cap

describe('the first frame in index.html', () => {
  // attributes as the formatter lays them out, one per line or not
  const svg =
    /<svg\s+viewBox="([^"]+)"\s+width="([^"]+)"\s+height="([^"]+)"[^>]*>([\s\S]*?)<\/svg>/.exec(
      html,
    )

  it('draws the wordmark the geometry draws, at a 28px cap height', () => {
    expect(svg).not.toBeNull()
    const [, viewBox, svgWidth, svgHeight, body] = svg!
    expect(viewBox).toBe(layout.viewBox)
    expect(svgWidth).toBe(fixed(width * scale))
    expect(svgHeight).toBe(fixed(height * scale))
    const paths = [
      ...body!.matchAll(/<path\s+data-(seg|letter)="([^"]+)"\s+d="([^"]+)"\s*\/>/g),
    ].map((match) => [match[2], match[3]])
    expect(paths).toEqual([
      ['1-7', layout.band],
      ['0', layout.segments[0]],
      ...layout.letters.map((letter) => [letter.char, letter.d]),
    ])
  })

  it('puts the ring on the line the loading screen will use', () => {
    const drop = fixed((layout.ringCenter.y - top) * scale)
    expect(html).toContain(`top: calc(44vh - ${drop}px);`)
  })

  it('paints the application’s own colours', () => {
    const token = (block: string, name: string) =>
      new RegExp(`${block} \\{[^}]*--q-${name}: ([^;]+);`).exec(tokens)?.[1]
    expect(html).toContain(`background: ${token(':root', 'background')};`)
    expect(html).toContain(`color: ${token(':root', 'foreground')};`)
    expect(html).toContain(`background: ${token('.dark', 'background')};`)
    expect(html).toContain(`color: ${token('.dark', 'foreground')};`)
  })

  it('resolves the theme from the key the application persists under', () => {
    const key = /const STORAGE_KEY = '([^']+)'/.exec(theme)?.[1]
    expect(key).toBeDefined()
    expect(html).toContain(`localStorage.getItem('${key}')`)
  })

  it('names the favicon the export writes', () => {
    expect(html).toContain('href="/favicon.svg"')
    expect(fs.existsSync(path.join(ROOT, 'apps/web/public/favicon.svg'))).toBe(true)
  })
})
