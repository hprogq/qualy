import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

import { markPaths, wordmarkLayout } from '../../packages/web/brand/src/geometry.ts'

// Writes the brand's static files from the geometry: the two SVGs other
// people take (a README, a partner's slide), the favicon, and the raster
// icons for the tabs that ignore an svg one. A design tool rather than a
// build step - what it writes is reviewed and committed like an export
// from a drawing program, and nothing checks that running it again
// produces no diff (docs/brand.md); the favicon's agreement with the
// geometry is what a test guards, not a generator.
//
// Two icons, two grounds. The svg is the bare mark and carries both inks,
// picking by the system scheme, for the browsers that take an svg. Safari
// does not, on any platform, and a bare black mark on its dark tab bar is
// no mark at all - so the png it gets, and the home-screen icon with it,
// stand the mark on a white rounded square of their own.

const ROOT = path.resolve(import.meta.dirname, '../..')
const ASSETS = path.join(ROOT, 'packages/web/brand/assets')
const PUBLIC = path.join(ROOT, 'apps/web/public')
const FAVICON = path.join(PUBLIC, 'favicon.svg')

const mark = markPaths(16)
const wordmark = wordmarkLayout(16)

const svg = (viewBox: string, body: readonly string[], attributes = ' fill="currentColor"') =>
  [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"${attributes}>`,
    ...body.map((line) => `  ${line}`),
    '</svg>',
    '',
  ].join('\n')

/** the whole drawing: the band as one path, the tail as another */
const whole = (band: string, tail: string) => [
  `<path data-seg="1-7" d="${band}"/>`,
  `<path data-seg="0" d="${tail}"/>`,
]

const files: readonly [string, string][] = [
  [
    path.join(ASSETS, 'mark.svg'),
    svg(mark.viewBox, ['<title>Qualy</title>', ...whole(mark.band, mark.tail)]),
  ],
  [
    path.join(ASSETS, 'wordmark.svg'),
    svg(wordmark.viewBox, [
      '<title>Qualy</title>',
      ...whole(wordmark.band, wordmark.segments[0]!),
      ...wordmark.letters.map((letter) => `<path data-letter="${letter.char}" d="${letter.d}"/>`),
    ]),
  ],
  // the browser tab has no page colour to inherit, so the icon carries the
  // two inks itself and picks by the system scheme
  [
    FAVICON,
    svg(
      mark.viewBox,
      [
        '<style>path{fill:#18191D}@media (prefers-color-scheme:dark){path{fill:#FAFAF8}}</style>',
        ...whole(mark.band, mark.tail),
      ],
      '',
    ),
  ],
]

for (const [file, content] of files) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
  console.log(`brand: wrote ${path.relative(ROOT, file)}`)
}

/** the mark on a white rounded square, as one document sized to the icon */
const tile = (size: number) => {
  const radius = Math.round(size * 0.22)
  // the mark takes 62% of the square, centred; the geometry's own box is 8s
  const inset = Math.round(size * 0.19)
  const span = size - inset * 2
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(size)}" height="${String(size)}" viewBox="0 0 ${String(size)} ${String(size)}">`,
    `  <rect width="${String(size)}" height="${String(size)}" rx="${String(radius)}" fill="#FFFFFF"/>`,
    `  <svg x="${String(inset)}" y="${String(inset)}" width="${String(span)}" height="${String(span)}" viewBox="${mark.viewBox}" fill="#18191D">`,
    ...whole(mark.band, mark.tail).map((line) => `    ${line}`),
    '  </svg>',
    '</svg>',
  ].join('\n')
}

const rasters: readonly [string, number][] = [
  [path.join(PUBLIC, 'favicon.png'), 32],
  [path.join(PUBLIC, 'apple-touch-icon.png'), 180],
]

const browser = await chromium.launch()
try {
  for (const [file, size] of rasters) {
    const page = await browser.newPage({ viewport: { width: size, height: size } })
    await page.setContent(
      `<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block}</style></head><body>${tile(size)}</body></html>`,
    )
    await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } })
    await page.close()
    console.log(`brand: wrote ${path.relative(ROOT, file)}`)
  }
} finally {
  await browser.close()
}
