import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

import {
  markPaths,
  wordmarkLayout,
  type WordmarkLayout,
} from '../../packages/web/brand/src/geometry.ts'

// A page to look at the brand on, and four screenshots of it.
//
// The mark and the wordmark at their sizes on both grounds, a bar of the
// kind the wordmark will actually sit in, and three switches the eye needs:
// a blur, which shows whether ring and letters weigh the same; a mirror and
// an upside-down turn, which show spacing the reading habit hides. One row
// is for the rule rather than the design: the spacing at neighbouring
// values of k. The window is wide enough for the 256 wordmark to sit inside
// its panel - an overflowing panel is mirrored off the page and out of the
// screenshot.

const ROOT = path.resolve(import.meta.dirname, '../..')
const OUT = path.join(import.meta.dirname, 'out')
fs.mkdirSync(OUT, { recursive: true })

const LIGHT = { background: '#FAFAF8', foreground: '#18191D' }
const DARK = { background: '#18191D', foreground: '#FAFAF8' }
const SIZES = [16, 24, 32, 48, 96, 256]
const K_VALUES = [0.75, 0.85, 0.95]

const mark = markPaths(16)
const wordmark = wordmarkLayout(16)

const segments = (paths: readonly string[]) =>
  paths.map((d, k) => `<path data-seg="${k}" d="${d}"/>`).join('')

const markSvg = (size: number) =>
  `<svg viewBox="${mark.viewBox}" width="${size}" height="${size}" fill="currentColor">${segments(mark.segments)}</svg>`

const wordmarkSvg = (capHeight: number, layout: WordmarkLayout = wordmark) => {
  const [, , width = 0, height = 0] = layout.viewBox.split(' ').map(Number)
  const scale = capHeight / layout.cap
  const letters = layout.letters
    .map((letter) => `<path data-letter="${letter.char}" d="${letter.d}"/>`)
    .join('')
  return `<svg viewBox="${layout.viewBox}" width="${width * scale}" height="${height * scale}" fill="currentColor">${segments(layout.segments)}${letters}</svg>`
}

const cell = (label: string, content: string) =>
  `<div class="cell">${content}<span class="label">${label}</span></div>`

const panel = (scheme: 'light' | 'dark', content: string) =>
  `<div class="panel ${scheme}">${content}</div>`

const bothGrounds = (content: string) => panel('light', content) + panel('dark', content)

const describe = (layout: WordmarkLayout) =>
  `k ${layout.k} · white ${layout.target.toFixed(3)}s · ring–u ${layout.ringToU.toFixed(3)}s · tail clearance ${layout.tailClearance.toFixed(3)}s`

const kRow = K_VALUES.map((k) => {
  const layout = wordmarkLayout(16, { k })
  return cell(describe(layout), wordmarkSvg(48, layout))
}).join('')

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Qualy brand preview</title>
<style>
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
  body.blur .stage { filter: blur(4px); }
  body.mirror .stage { transform: scaleX(-1); }
  body.flip .stage { transform: rotate(180deg); }
</style>
</head>
<body class="light">
<header>
  <span>s <b>16</b> · cap <b>${wordmark.cap.toFixed(3)}</b> · inner stretch <b>1.05</b></span>
  <span>k <b>${wordmark.k}</b> · target white <b>${wordmark.target.toFixed(3)}s</b></span>
  <span>whites: ${(['Qu', 'ua', 'al', 'ly'] as const).map((pair) => `${pair} <b>${wordmark.whites[pair].toFixed(3)}</b>`).join(' · ')}</span>
  <span>tail clearance <b>${wordmark.tailClearance.toFixed(3)}s</b> · ring–u <b>${wordmark.ringToU.toFixed(3)}s</b> (by white alone ${wordmark.ringToUByWhite.toFixed(3)}s)</span>
  <span>kern <b>${JSON.stringify(wordmark.kern)}</b></span>
  <label><input type="checkbox" id="blur"> blur 4px</label>
  <label><input type="checkbox" id="mirror"> mirror</label>
  <label><input type="checkbox" id="flip"> upside down</label>
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
    <h2>Spacing rule at neighbouring k (48)</h2>
    <div class="grounds">${bothGrounds(kRow)}</div>
  </section>
</main>
<script>
  const params = new URLSearchParams(location.search)
  const flags = { blur: params.get('blur') === '1', mirror: params.get('mirror') === '1', flip: params.get('flip') === '1', theme: params.get('theme') === 'dark' }
  const apply = () => {
    for (const key of ['blur', 'mirror', 'flip']) document.body.classList.toggle(key, flags[key])
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
  ['preview-light-flip.png', '?flip=1'],
] as const
const browser = await chromium.launch()
try {
  const tab = await browser.newPage({
    viewport: { width: 2000, height: 900 },
    deviceScaleFactor: 2,
  })
  for (const [file, query] of shots) {
    await tab.goto(`${pathToFileURL(page).href}${query}`)
    await tab.screenshot({ path: path.join(OUT, file), fullPage: true })
    console.log(`brand: wrote ${path.relative(ROOT, path.join(OUT, file))}`)
  }
} finally {
  await browser.close()
}
