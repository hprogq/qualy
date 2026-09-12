import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

import { markGeometry } from '../../packages/web/brand/src/geometry.ts'
import { wordmark } from '../../packages/web/brand/src/wordmark-paths.ts'
import { openJost, solveWeight } from './font.ts'
import { TAIL_GAP, TRACKING, WORDMARK_S } from './spec.ts'
import { layoutWordmark, ringOf } from './wordmark.ts'

// A page to look at the brand on, and four screenshots of it.
//
// The mark, the wordmark and the loader at their sizes on both grounds, a
// bar of the kind the wordmark will actually sit in, and two switches the
// eye needs: a blur, which shows whether ring and letters weigh the same,
// and a mirror, which shows spacing the reading habit hides. Two rows are
// for the tools rather than the design - the live font drawn over the
// frozen outlines, which is the check that the outlines are the font's, and
// the two tunable clearances at neighbouring values. The window is wide
// enough for the 256 wordmark to sit inside its panel: an overflowing
// panel is mirrored off the page and out of the screenshot.

const ROOT = path.resolve(import.meta.dirname, '../..')
const OUT = path.join(import.meta.dirname, 'out')
fs.mkdirSync(OUT, { recursive: true })

const jost = await openJost()
const weight = solveWeight(jost.font)
const build = { wght: weight.wght, s: WORDMARK_S, tailGap: TAIL_GAP, tracking: TRACKING }
const layout = layoutWordmark(jost.font, build)
const mark = markGeometry()

const LIGHT = { background: '#FAFAF8', foreground: '#18191D' }
const DARK = { background: '#18191D', foreground: '#FAFAF8' }
const SIZES = [16, 24, 32, 48, 96, 256]

interface WordmarkData {
  readonly viewBox: string
  readonly s: number
  readonly capHeight: number
  readonly ringCenter: { readonly x: number; readonly y: number }
  readonly letters: readonly { readonly char: string; readonly d: string }[]
}

const markSvg = (size: number) =>
  `<svg viewBox="${mark.viewBox}" width="${size}" height="${size}" fill="currentColor"><path d="${mark.ring}"/><path d="${mark.piece}"/></svg>`

const wordmarkSvg = (capHeight: number, data: WordmarkData = wordmark, extra = '') => {
  const [, , width = 0, height = 0] = data.viewBox.split(' ').map(Number)
  const scale = capHeight / data.capHeight
  const ring = ringOf(data)
  const letters = data.letters.map((letter) => `<path d="${letter.d}"/>`).join('')
  return `<svg viewBox="${data.viewBox}" width="${width * scale}" height="${height * scale}" fill="currentColor"><path d="${ring.ring}"/><path d="${ring.piece}"/>${letters}${extra}</svg>`
}

const loaderSvg = (size: number) =>
  `<svg viewBox="${mark.viewBox}" width="${size}" height="${size}" fill="currentColor"><g class="moving"><path class="track" d="${mark.track}"/><g class="orbit"><path d="${mark.pieceHome}"/></g></g><g class="still"><path d="${mark.ring}"/><path d="${mark.piece}"/></g></svg>`

const cell = (label: string, content: string) =>
  `<div class="cell">${content}<span class="label">${label}</span></div>`

const panel = (scheme: 'light' | 'dark', content: string) =>
  `<div class="panel ${scheme}">${content}</div>`

const bothGrounds = (content: string) => panel('light', content) + panel('dark', content)

// the browser's own rendering of the same font, over the frozen outlines
const fontData = fs.readFileSync(path.join(ROOT, jost.file)).toString('base64')
const liveText = `<text x="${layout.letters[0]!.origin}" y="0" style="font-family:JostCheck;font-size:${layout.unitsPerEm * layout.scale}px;letter-spacing:${TRACKING * layout.unitsPerEm * layout.scale}px;font-variation-settings:'wght' ${weight.wght};fill:rgba(255,0,0,0.55)">ualy</text>`

const tailGapRow = [0.35, 0.5, 0.65, 0.8]
  .map((tailGap) =>
    cell(
      `tail clearance ${tailGap}s`,
      wordmarkSvg(48, layoutWordmark(jost.font, { ...build, tailGap })),
    ),
  )
  .join('')
const trackingRow = [-0.01, -0.02, -0.03]
  .map((tracking) =>
    cell(
      `tracking ${tracking}em`,
      wordmarkSvg(48, layoutWordmark(jost.font, { ...build, tracking })),
    ),
  )
  .join('')

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Qualy brand preview</title>
<style>
  @font-face { font-family: JostCheck; src: url(data:font/woff2;base64,${fontData}) format('woff2'); font-weight: 100 900; }
  body { margin: 0; font: 13px/1.4 system-ui, sans-serif; }
  body.light { background: ${LIGHT.background}; color: ${LIGHT.foreground}; }
  body.dark { background: ${DARK.background}; color: ${DARK.foreground}; }
  header { display: flex; flex-wrap: wrap; gap: 24px; align-items: center; padding: 12px 24px; border-bottom: 1px solid color-mix(in oklab, currentColor 15%, transparent); }
  header b { font-variant-numeric: tabular-nums; }
  main { padding: 24px; display: grid; gap: 32px; }
  h2 { font-size: 13px; font-weight: 600; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 0.06em; opacity: 0.7; }
  .grounds { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .panel { padding: 24px; display: flex; flex-wrap: wrap; align-items: flex-end; gap: 32px; }
  .panel.light { background: ${LIGHT.background}; color: ${LIGHT.foreground}; }
  .panel.dark { background: ${DARK.background}; color: ${DARK.foreground}; }
  .cell { display: flex; flex-direction: column; align-items: center; gap: 8px; }
  .cell svg { display: block; }
  .label { font-size: 11px; opacity: 0.6; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .bar { display: flex; align-items: center; gap: 24px; height: 56px; padding: 0 16px; border-bottom: 1px solid color-mix(in oklab, currentColor 15%, transparent); font: 14px/20px system-ui, -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; }
  .bar nav { display: flex; gap: 4px; }
  .bar nav span { padding: 6px 12px; border-radius: 6px; }
  .bar nav span.active { background: color-mix(in oklab, currentColor 8%, transparent); font-weight: 500; }
  .bar nav span.idle { opacity: 0.6; }
  .bar .end { margin-left: auto; width: 28px; height: 28px; border-radius: 50%; background: color-mix(in oklab, currentColor 20%, transparent); }
  .bar svg { display: block; }
  .track { fill: color-mix(in oklab, currentColor 18%, transparent); }
  .orbit { transform-box: view-box; transform-origin: 50% 50%; animation: orbit 1.2s linear infinite; }
  .still { display: none; }
  @keyframes orbit { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .moving { display: none; } .still { display: inline; } }
  body.blur .stage { filter: blur(4px); }
  body.mirror .stage { transform: scaleX(-1); }
</style>
</head>
<body class="light">
<header>
  <span>wght <b>${weight.wght}</b></span>
  <span>s <b>${layout.s}</b> (stem ${weight.stem} font units, ${layout.scale.toFixed(4)} per unit)</span>
  <span>ring / cap <b>${weight.ratio.toFixed(4)}</b></span>
  <span>A tail clearance <b>${TAIL_GAP}s</b></span>
  <span>B tracking <b>${TRACKING}em</b></span>
  <span>whitespace in s: ${['tail-u', 'u-a', 'a-l', 'l-y'].map((pair, at) => `${pair} <b>${layout.gaps[at]!.toFixed(3)}</b>`).join(' · ')}</span>
  <label><input type="checkbox" id="blur"> blur 4px</label>
  <label><input type="checkbox" id="mirror"> mirror</label>
  <label><input type="checkbox" id="theme"> dark page</label>
</header>
<main class="stage">
  <section>
    <h2>Mark</h2>
    <div class="grounds">${bothGrounds(SIZES.map((size) => cell(`${size}`, markSvg(size))).join(''))}</div>
  </section>
  <section>
    <h2>Wordmark (sizes are cap height)</h2>
    <div class="grounds">${bothGrounds(SIZES.map((size) => cell(`${size}`, wordmarkSvg(size))).join(''))}</div>
  </section>
  <section>
    <h2>Top bar, 14px cap height</h2>
    <div class="bar">${wordmarkSvg(14)}<nav><span class="active">测评</span><span class="idle">工作台</span><span class="idle">资源库</span></nav><span class="end"></span></div>
  </section>
  <section>
    <h2>Loader</h2>
    <div class="grounds">${bothGrounds([16, 24, 32].map((size) => cell(`${size}`, loaderSvg(size))).join(''))}</div>
  </section>
  <section>
    <h2>Check: the browser's Jost at wght ${weight.wght} (red) over the frozen outlines</h2>
    <div class="grounds">${panel('light', cell('96', wordmarkSvg(96, layout, liveText)))}</div>
  </section>
  <section>
    <h2>Tuning: A, tail clearance (48)</h2>
    <div class="grounds">${bothGrounds(tailGapRow)}</div>
  </section>
  <section>
    <h2>Tuning: B, tracking (48)</h2>
    <div class="grounds">${bothGrounds(trackingRow)}</div>
  </section>
</main>
<script>
  const params = new URLSearchParams(location.search)
  const flags = { blur: params.get('blur') === '1', mirror: params.get('mirror') === '1', theme: params.get('theme') === 'dark' }
  const apply = () => {
    document.body.classList.toggle('blur', flags.blur)
    document.body.classList.toggle('mirror', flags.mirror)
    document.body.classList.toggle('dark', flags.theme)
    document.body.classList.toggle('light', !flags.theme)
  }
  for (const key of Object.keys(flags)) {
    const box = document.getElementById(key)
    box.checked = flags[key]
    box.addEventListener('change', () => { flags[key] = box.checked; apply() })
  }
  apply()
</script>
</body>
</html>
`

const page = path.join(OUT, 'preview.html')
fs.writeFileSync(page, html)
console.log(`brand: wrote ${path.relative(ROOT, page)}`)

const shots = [
  ['preview-light.png', ''],
  ['preview-dark.png', '?theme=dark'],
  ['preview-light-blur.png', '?blur=1'],
  ['preview-light-mirror.png', '?mirror=1'],
] as const
const browser = await chromium.launch()
try {
  const tab = await browser.newPage({
    viewport: { width: 2000, height: 900 },
    deviceScaleFactor: 2,
  })
  for (const [file, query] of shots) {
    await tab.goto(`${pathToFileURL(page).href}${query}`)
    await tab.waitForFunction('document.fonts.status === "loaded"')
    await tab.screenshot({ path: path.join(OUT, file), fullPage: true })
    console.log(`brand: wrote ${path.relative(ROOT, path.join(OUT, file))}`)
  }
} finally {
  await browser.close()
}
