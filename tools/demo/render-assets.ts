// Proof images for the demonstration, rendered once and committed.
//
//   node tools/demo/render-assets.ts
//
// What each picture shows is in tools/demo/pictures.ts.

import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { PICTURES } from './pictures.ts'

const OUT = 'tools/demo/assets'

// `node tools/demo/render-assets.ts notice-1 signature-1` renders only those,
// leaving the committed bytes of every other picture as they are
const only = process.argv.slice(2)
const unknown = only.filter((name) => !(name in PICTURES))
if (unknown.length > 0) throw new Error(`no such picture: ${unknown.join(', ')}`)

fs.mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 960, height: 680 } })
const tab = await context.newPage()
let rendered = 0
for (const [name, html] of Object.entries(PICTURES)) {
  if (only.length > 0 && !only.includes(name)) continue
  rendered += 1
  await tab.setContent(html, { waitUntil: 'load' })
  await tab.screenshot({ path: path.join(OUT, `${name}.jpg`), type: 'jpeg', quality: 72 })
}
await browser.close()
console.log(`rendered ${rendered} images into ${OUT}`)
