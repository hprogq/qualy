import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

import {
  markPaths,
  wordmarkLayout,
  type WordmarkLayout,
} from '../../packages/web/brand/src/geometry.ts'
import { LEAD, loopCss, PERIOD } from './loop.ts'

// A page to look at the brand on, and four screenshots of it.
//
// The mark and the wordmark at their sizes on both grounds, a bar of the
// kind the wordmark will actually sit in, and three switches the eye needs:
// a blur, which shows whether ring and letters weigh the same; a mirror and
// an upside-down turn, which show spacing the reading habit hides. One row
// is for the rule rather than the design: the spacing at neighbouring
// amounts of white. The loader and the live wordmark run on the same
// keyframes the components use, spelled out from the rule in loop.ts, and
// twelve frames of the live wordmark are taken by stepping its animations
// rather than by waiting, so every run shows the same moments. The window is wide enough for the 256 wordmark to sit
// inside its panel - an overflowing panel is mirrored off the page and out
// of the screenshot. The output folder is emptied first, so a picture from
// an earlier design cannot survive next to the new ones.

const ROOT = path.resolve(import.meta.dirname, '../..')
const OUT = path.join(import.meta.dirname, 'out')
fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })

const LIGHT = { background: '#FAFAF8', foreground: '#18191D' }
const DARK = { background: '#18191D', foreground: '#FAFAF8' }
const SIZES = [16, 24, 32, 48, 96, 256]
/** the frozen white and a step either side of it, in s */
const WHITES = [0.85, 0.97, 1.09]

const mark = markPaths(16)
const wordmark = wordmarkLayout(16)

/** which part the head is on t ms after the loop starts, for a caption */
const headAt = (t: number): string => {
  const u = (((t - LEAD) % PERIOD) + PERIOD) % PERIOD
  if (t < LEAD) return 'nothing yet, the tail leaning'
  const dwell = [280, 160, 160, 160, 160, 160, 160, 160]
  let at = 0
  for (let i = 0; i < 8; i += 1) {
    if (u < at + dwell[i]!) return i === 0 ? 'the tail' : `sector ${i}`
    at += dwell[i]!
  }
  return 'the tail'
}

const whole = (band: string, tail: string) =>
  `<path data-seg="1-7" d="${band}"/><path data-seg="0" d="${tail}"/>`

const segmented = (paths: readonly string[]) =>
  paths.map((d, k) => `<path data-seg="${k}" d="${d}"/>`).join('')

const loaderSvg = (size: number, polarity: 'dark' | 'light') =>
  `<svg class="q-${polarity}" viewBox="${mark.viewBox}" width="${size}" height="${size}" fill="currentColor">${segmented(mark.segments)}</svg>`

const liveWordmarkSvg = (capHeight: number, id: string) => {
  const [, , width = 0, height = 0] = wordmark.viewBox.split(' ').map(Number)
  const scale = capHeight / wordmark.cap
  const letters = wordmark.letters
    .map((letter) => `<path data-letter="${letter.char}" d="${letter.d}"/>`)
    .join('')
  return `<svg id="${id}" class="q-dark q-delayed" viewBox="${wordmark.viewBox}" width="${width * scale}" height="${height * scale}" fill="currentColor">${segmented(wordmark.segments)}${letters}</svg>`
}

const markSvg = (size: number) =>
  `<svg viewBox="${mark.viewBox}" width="${size}" height="${size}" fill="currentColor">${whole(mark.band, mark.tail)}</svg>`

const wordmarkSvg = (capHeight: number, layout: WordmarkLayout = wordmark) => {
  const [, , width = 0, height = 0] = layout.viewBox.split(' ').map(Number)
  const scale = capHeight / layout.cap
  const letters = layout.letters
    .map((letter) => `<path data-letter="${letter.char}" d="${letter.d}"/>`)
    .join('')
  return `<svg viewBox="${layout.viewBox}" width="${width * scale}" height="${height * scale}" fill="currentColor">${whole(layout.band, layout.segments[0]!)}${letters}</svg>`
}

const cell = (label: string, content: string) =>
  `<div class="cell">${content}<span class="label">${label}</span></div>`

const panel = (scheme: 'light' | 'dark', content: string) =>
  `<div class="panel ${scheme}">${content}</div>`

const bothGrounds = (content: string) => panel('light', content) + panel('dark', content)

const describe = (layout: WordmarkLayout) =>
  `white ${layout.target.toFixed(2)}s · ring–u ${layout.ringToU.toFixed(3)}s · tail clearance ${layout.tailClearance.toFixed(3)}s`

const whiteRow = WHITES.map((white) => {
  const layout = wordmarkLayout(16, { white })
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
  .q-delayed [data-seg] { animation-delay: 400ms; }
  ${loopCss('dark')}
  ${loopCss('light')}
</style>
</head>
<body class="light">
<header>
  <span>s <b>16</b> · cap <b>${wordmark.cap.toFixed(3)}</b> · inner stretch <b>1.05</b></span>
  <span>target white <b>${wordmark.target.toFixed(2)}s</b></span>
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
    <h2>Loader: light polarity at 16 and 24, dark at 48</h2>
    <div class="grounds">${bothGrounds(cell('16 light', loaderSvg(16, 'light')) + cell('24 light', loaderSvg(24, 'light')) + cell('48 dark', loaderSvg(48, 'dark')))}</div>
  </section>
  <section>
    <h2>Live wordmark, 28px cap height, loop from 400ms</h2>
    <div class="grounds">${panel('light', cell('28 live', liveWordmarkSvg(28, 'live-light')))}${panel('dark', cell('28 live', liveWordmarkSvg(28, 'live-dark')))}</div>
  </section>
  <section>
    <h2>Spacing rule at neighbouring whites (48)</h2>
    <div class="grounds">${bothGrounds(whiteRow)}</div>
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
  ['preview-light-mirror.png', '?mirror=1'],
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

  // twelve moments of the live wordmark over three seconds, a quarter of a
  // second apart, taken by pausing its animations and setting their time:
  // the 400ms delay is part of the animation's own clock, so a moment t
  // after the loop starts is currentTime 400 + t
  await tab.goto(pathToFileURL(page).href)
  const frames: string[] = []
  for (let i = 0; i < 12; i += 1) {
    const t = i * 250
    await tab.evaluate(
      `for (const a of document.getElementById('live-light').getAnimations({ subtree: true })) { a.pause(); a.currentTime = ${400 + t} }`,
    )
    const file = `live-${String(i + 1).padStart(2, '0')}.png`
    const shot = await tab.locator('#live-light').screenshot({ path: path.join(OUT, file) })
    frames.push(
      `<figure><img src="data:image/png;base64,${shot.toString('base64')}"><figcaption>${t}ms · head on ${headAt(t)}</figcaption></figure>`,
    )
  }
  console.log(`brand: wrote ${path.relative(ROOT, OUT)}/live-01.png … live-12.png`)
  const strip = path.join(OUT, 'live-strip.html')
  fs.writeFileSync(
    strip,
    `<!doctype html><meta charset="utf-8"><title>Qualy live wordmark, 12 frames</title><style>body{margin:0;background:${LIGHT.background};color:${LIGHT.foreground};font:12px system-ui}main{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;padding:16px}figure{margin:0;display:grid;gap:6px}img{width:100%;display:block}figcaption{opacity:.6;font-variant-numeric:tabular-nums}</style><main>${frames.join('')}</main>`,
  )
  await tab.goto(pathToFileURL(strip).href)
  await tab.screenshot({ path: path.join(OUT, 'live-strip.png'), fullPage: true })
  console.log(`brand: wrote ${path.relative(ROOT, path.join(OUT, 'live-strip.png'))}`)
} finally {
  await browser.close()
}
