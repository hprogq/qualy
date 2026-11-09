import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { brotliCompressSync } from 'node:zlib'
import { build } from 'vite'
import { chromium } from 'playwright'
import { repoRoot } from '../lib/manifest.ts'

// Same code and UTF-16 evidence in Node, Bun and Chromium. No product DB,
// business server or global Intl replacement is needed for this comparison.
const directory = path.join(repoRoot, 'node_modules/.cache/date-format-acceptance')
await fs.mkdir(directory, { recursive: true })
const entry = path.join(directory, 'cases.mjs')
const formatter = pathToFileURL(path.join(repoRoot, 'packages/core/date-format/src/index.ts')).href
const cases = ['en-US', 'zh-CN'].flatMap((locale) =>
  [
    'UTC',
    'Asia/Shanghai',
    'America/New_York',
    'Europe/London',
    'Asia/Kathmandu',
    'Pacific/Apia',
  ].flatMap((zone) =>
    [
      '2026-11-07T10:49:56Z',
      '2026-03-08T06:59:59Z',
      '2026-03-08T07:00:00Z',
      '2026-11-01T05:30:00Z',
      '2026-11-01T06:30:00Z',
      '2011-12-30T10:00:00Z',
    ].flatMap((at) =>
      ['event-time', 'date-time', 'month-day-clock', 'date'].map((style) => ({
        locale,
        zone,
        at,
        style,
      })),
    ),
  ),
)
await fs.writeFile(
  entry,
  `import { formatDateTime } from ${JSON.stringify(formatter)}
const cases = ${JSON.stringify(cases)}
const options = {
  'event-time': { dateStyle: 'medium', timeStyle: 'medium' },
  'date-time': { dateStyle: 'medium', timeStyle: 'short' },
  'month-day-clock': { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
  date: { dateStyle: 'medium' },
}
export const results = cases.map(({locale, zone, at, style}) => {
  const date = new Date(at)
  const text = formatDateTime(date, locale, style, zone)
  return { locale, zone, at, style, text,
    units: Array.from({length: text.length}, (_, i) => text.charCodeAt(i)),
    native: new Intl.DateTimeFormat(locale, {...options[style], timeZone: zone}).format(date),
  }
})
`,
)
const driver = path.join(directory, 'driver.mjs')
await fs.writeFile(
  driver,
  `import {results} from './cases.mjs'; console.log(JSON.stringify(results))`,
)
type Result = { text: string; units: number[]; native: string }
const run = async (runtime: string): Promise<Result[]> => {
  const { stdout } = await promisify(execFile)(runtime, [driver], { maxBuffer: 4_000_000 })
  return JSON.parse(stdout) as Result[]
}
const node = await run(process.execPath)
const bun = await run('bun')
await build({
  configFile: false,
  root: repoRoot,
  logLevel: 'error',
  build: {
    outDir: path.join(directory, 'client'),
    emptyOutDir: true,
    lib: { entry, formats: ['es'], fileName: () => 'cases.js' },
    minify: true,
  },
})
const bundle = await fs.readFile(path.join(directory, 'client/cases.js'))
const server = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/javascript')
  response.end(bundle)
})
const browser = await chromium.launch()
try {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(5186, '127.0.0.1', resolve)
  })
  const page = await browser.newPage()
  await page.goto('http://127.0.0.1:5186')
  const chromiumRows = await page.evaluate<Result[]>(
    `import('/cases.js').then(module => module.results)`,
  )
  const display = (rows: Result[]) => rows.map(({ text, units }) => ({ text, units }))
  assert.deepEqual(display(bun), display(node), 'Bun and Node must emit identical UTF-16')
  assert.deepEqual(
    display(chromiumRows),
    display(node),
    'Chromium and SSR must emit identical UTF-16',
  )
  const report = {
    cases: cases.length,
    bundleBrotliBytes: brotliCompressSync(bundle).length,
    nativeDifferences: node.filter(
      (row, i) => row.native !== bun[i]!.native || row.native !== chromiumRows[i]!.native,
    ).length,
    node,
    bun,
    chromium: chromiumRows,
  }
  await fs.writeFile(path.join(directory, 'results.json'), JSON.stringify(report, null, 2))
  console.log(
    `date-format-acceptance: ${String(cases.length)} Node/Bun/Chromium cases match byte-for-byte; native mismatches ${String(report.nativeDifferences)}; fixture bundle ${String(report.bundleBrotliBytes)} Brotli bytes`,
  )
} finally {
  try {
    await browser.close()
  } finally {
    if (server.listening)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
  }
}
