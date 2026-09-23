import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

import { markPaths, wordmarkLayout } from '../../packages/web/brand/src/geometry.ts'

// Writes the brand's static files from the geometry.
//
// There are three kinds of exported asset:
//
// - mark.svg / wordmark.svg:
//   generic monochrome vectors. They inherit currentColor and therefore
//   carry no fixed brand ink of their own.
//
// - favicon.svg / favicon.png / apple-touch-icon.png:
//   browser and home-screen assets using Qualy's application colours.
//
// - platform-mark.*:
//   transparent, fixed-colour Q for platforms that provide their own
//   background or badge surface.
//
// - platform-icon.*:
//   self-contained Q on Qualy's light background for platforms that only
//   accept one complete image.
//
// This is a design export tool rather than a build step. Its output is
// reviewed and committed like an export from a drawing program.

const ROOT = path.resolve(import.meta.dirname, '../..')
const ASSETS = path.join(ROOT, 'packages/web/brand/assets')
const PUBLIC = path.join(ROOT, 'apps/web/public')

const FAVICON = path.join(PUBLIC, 'favicon.svg')
const PLATFORM_MARK = path.join(ASSETS, 'platform-mark.svg')
const PLATFORM_ICON = path.join(ASSETS, 'platform-icon.svg')

const mark = markPaths(16)
const wordmark = wordmarkLayout(16)

// Qualy's application colour tokens:
//
// light:
//   --q-background: oklch(0.99 0.001 80)
//   --q-foreground: oklch(0.21 0.006 80)
//
// dark:
//   --q-background: oklch(0.17 0.006 80)
//   --q-foreground: oklch(0.93 0.004 80)
//
// Static assets use their sRGB equivalents for maximum compatibility with
// image processors, design applications and platforms that do not understand
// CSS Color 4.
const LIGHT_BACKGROUND = 'oklch(0.99 0.001 80)'
const LIGHT_FOREGROUND = 'oklch(0.21 0.006 80)'

const DARK_BACKGROUND = 'oklch(0.17 0.006 80)'
const DARK_FOREGROUND = 'oklch(0.93 0.004 80)'

const svg = (viewBox: string, body: readonly string[], attributes = ' fill="currentColor"') =>
  [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"${attributes}>`,
    ...body.map((line) => `  ${line}`),
    '</svg>',
    '',
  ].join('\n')

/** The whole Q: the continuous ring band and the displaced tail. */
const whole = (band: string, tail: string) => [
  `<path data-seg="1-7" d="${band}"/>`,
  `<path data-seg="0" d="${tail}"/>`,
]

/**
 * Places the mark on a square platform canvas.
 *
 * `scale` describes how much of the outer square is occupied by the mark's
 * own 128×128 design canvas:
 *
 * - 1.0: transparent platform mark. The design canvas fills the export.
 * - 0.8: self-contained platform icon. The mark keeps a 10% safety area
 *        around each side before any platform-side masking is applied.
 *
 * The Q's detached tail gives the drawing more visual weight at the lower
 * right. A small upper-left optical correction keeps the isolated mark from
 * appearing to sag.
 */
const platformArtwork = (
  size: number,
  {
    scale,
    background,
  }: {
    scale: number
    background?: string
  },
) => {
  const span = size * scale
  const inset = (size - span) / 2

  // Optical compensation established for the isolated Q.
  const opticalShiftX = size * 0.018
  const opticalShiftY = size * 0.02

  const x = inset - opticalShiftX
  const y = inset - opticalShiftY

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(size)}" height="${String(size)}" viewBox="0 0 ${String(size)} ${String(size)}">`,
    '  <title>Qualy</title>',
    ...(background === undefined
      ? []
      : [`  <rect width="${String(size)}" height="${String(size)}" fill="${background}"/>`]),
    `  <svg x="${String(x)}" y="${String(y)}" width="${String(span)}" height="${String(span)}" viewBox="${mark.viewBox}" fill="${LIGHT_FOREGROUND}">`,
    ...whole(mark.band, mark.tail).map((line) => `    ${line}`),
    '  </svg>',
    '</svg>',
    '',
  ].join('\n')
}

/**
 * Transparent platform mark.
 *
 * The Q's complete design canvas occupies 100% of the exported square.
 * The geometry itself still contains its intentional internal clear space.
 *
 * Intended for platforms such as GitHub that compose the logo over a
 * separately configured background.
 */
const platformMark = (size: number) =>
  platformArtwork(size, {
    scale: 1,
  })

/**
 * Self-contained platform icon.
 *
 * The image carries Qualy's light application background and leaves a
 * larger safety area around the Q. Intended for platforms where the
 * uploaded image is the complete icon.
 */
const platformIcon = (size: number) =>
  platformArtwork(size, {
    scale: 0.8,
    background: LIGHT_BACKGROUND,
  })

/**
 * Browser / home-screen raster tile.
 *
 * These remain deliberately more conservative than the platform assets:
 * the mark's design canvas occupies 62% of the square.
 */
const browserTile = (size: number) => {
  const radius = Math.round(size * 0.22)
  const inset = Math.round(size * 0.19)
  const span = size - inset * 2

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(size)}" height="${String(size)}" viewBox="0 0 ${String(size)} ${String(size)}">`,
    `  <rect width="${String(size)}" height="${String(size)}" rx="${String(radius)}" fill="${LIGHT_BACKGROUND}"/>`,
    `  <svg x="${String(inset)}" y="${String(inset)}" width="${String(span)}" height="${String(span)}" viewBox="${mark.viewBox}" fill="${LIGHT_FOREGROUND}">`,
    ...whole(mark.band, mark.tail).map((line) => `    ${line}`),
    '  </svg>',
    '</svg>',
  ].join('\n')
}

const files: readonly [string, string][] = [
  // Generic mark. currentColor is intentional: this asset has no fixed ink.
  [
    path.join(ASSETS, 'mark.svg'),
    svg(mark.viewBox, ['<title>Qualy</title>', ...whole(mark.band, mark.tail)]),
  ],

  // Generic wordmark. Same currentColor contract as mark.svg.
  [
    path.join(ASSETS, 'wordmark.svg'),
    svg(wordmark.viewBox, [
      '<title>Qualy</title>',
      ...whole(wordmark.band, wordmark.segments[0]!),
      ...wordmark.letters.map((letter) => `<path data-letter="${letter.char}" d="${letter.d}"/>`),
    ]),
  ],

  // The browser tab has no page colour to inherit, so the SVG carries the
  // application's actual light/dark foreground colours itself.
  [
    FAVICON,
    svg(
      mark.viewBox,
      [
        `<style>path{fill:${LIGHT_FOREGROUND}}@media (prefers-color-scheme:dark){path{fill:${DARK_FOREGROUND}}}</style>`,
        ...whole(mark.band, mark.tail),
      ],
      '',
    ),
  ],

  // Transparent fixed-colour platform mark.
  [PLATFORM_MARK, platformMark(1024)],

  // Complete light platform icon.
  [PLATFORM_ICON, platformIcon(1024)],
]

for (const [file, content] of files) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
  console.log(`brand: wrote ${path.relative(ROOT, file)}`)
}

const browserRasters: readonly [string, number][] = [
  [path.join(PUBLIC, 'favicon.png'), 32],
  [path.join(PUBLIC, 'apple-touch-icon.png'), 180],
]

const platformMarkRasters: readonly [string, number][] = [
  [path.join(ASSETS, 'platform-mark-512.png'), 512],
  [path.join(ASSETS, 'platform-mark.png'), 1024],
]

const platformIconRasters: readonly [string, number][] = [
  [path.join(ASSETS, 'platform-icon-512.png'), 512],
  [path.join(ASSETS, 'platform-icon.png'), 1024],
]

const browser = await chromium.launch()

try {
  for (const [file, size] of browserRasters) {
    const page = await browser.newPage({
      viewport: {
        width: size,
        height: size,
      },
    })

    await page.setContent(
      [
        '<!doctype html>',
        '<html>',
        '<head>',
        '<style>',
        'html,body{margin:0;background:transparent}',
        'svg{display:block}',
        '</style>',
        '</head>',
        `<body>${browserTile(size)}</body>`,
        '</html>',
      ].join(''),
    )

    await page.screenshot({
      path: file,
      omitBackground: true,
      clip: {
        x: 0,
        y: 0,
        width: size,
        height: size,
      },
    })

    await page.close()

    console.log(`brand: wrote ${path.relative(ROOT, file)}`)
  }

  for (const [file, size] of platformMarkRasters) {
    const page = await browser.newPage({
      viewport: {
        width: size,
        height: size,
      },
    })

    await page.setContent(
      [
        '<!doctype html>',
        '<html>',
        '<head>',
        '<style>',
        'html,body{margin:0;width:100%;height:100%;background:transparent;overflow:hidden}',
        'svg{display:block}',
        '</style>',
        '</head>',
        `<body>${platformMark(size)}</body>`,
        '</html>',
      ].join(''),
    )

    await page.screenshot({
      path: file,
      omitBackground: true,
      clip: {
        x: 0,
        y: 0,
        width: size,
        height: size,
      },
    })

    await page.close()

    console.log(`brand: wrote ${path.relative(ROOT, file)}`)
  }

  for (const [file, size] of platformIconRasters) {
    const page = await browser.newPage({
      viewport: {
        width: size,
        height: size,
      },
    })

    await page.setContent(
      [
        '<!doctype html>',
        '<html>',
        '<head>',
        '<style>',
        `html,body{margin:0;width:100%;height:100%;background:${LIGHT_BACKGROUND};overflow:hidden}`,
        'svg{display:block}',
        '</style>',
        '</head>',
        `<body>${platformIcon(size)}</body>`,
        '</html>',
      ].join(''),
    )

    await page.screenshot({
      path: file,
      clip: {
        x: 0,
        y: 0,
        width: size,
        height: size,
      },
    })

    await page.close()

    console.log(`brand: wrote ${path.relative(ROOT, file)}`)
  }
} finally {
  await browser.close()
}
