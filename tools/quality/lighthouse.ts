import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'
import { signIn, stack, type Account } from '../e2e/stack.ts'

// Lighthouse against the deployment e2e-stack.ts started, the same way every
// time: a few pages as the people who use them, each loaded several times per
// form factor, and the median of every figure.
//
//   pnpm lighthouse [page ...] [--runs 3] [--form mobile|desktop|both]
//
// One Chrome, signed in through the sign-in page the way the journeys are;
// Lighthouse drives a tab of its own in it over the debugging port, so each
// run carries the session a person would have (between runs Lighthouse clears
// caches and service workers, not cookies). Lighthouse runs through pnpm dlx
// at a fixed version: as a dependency it moves the lockfile's peer resolution
// of packages the release image installs. Reports land in
// .qualy/lighthouse/<time>/, with summary.json beside them.

const LIGHTHOUSE = 'lighthouse@13.5.0'

// the baseline's open batch, as the journeys know it
const BATCH = '01a0eecf-3203-7965-bb14-2ac8fcace35f'

const PAGES: Record<string, { readonly path: string; readonly who?: Account }> = {
  login: { path: '/login' },
  batches: { path: '/assessment/batches', who: 'student' },
  'my-entries': { path: `/assessment/batches/${BATCH}/my-entries`, who: 'student' },
  'org-tree': { path: '/organization/tree', who: 'admin' },
}

type Form = 'mobile' | 'desktop'

const FIGURES = {
  performance: { label: 'perf', unit: 'score' },
  accessibility: { label: 'a11y', unit: 'score' },
  bestPractices: { label: 'bp', unit: 'score' },
  fcp: { label: 'FCP', unit: 'ms' },
  lcp: { label: 'LCP', unit: 'ms' },
  tbt: { label: 'TBT', unit: 'ms' },
  cls: { label: 'CLS', unit: 'shift' },
  speedIndex: { label: 'SI', unit: 'ms' },
} as const

type Figures = Record<keyof typeof FIGURES, number | null>

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    runs: { type: 'string', default: '3' },
    form: { type: 'string', default: 'both' },
  },
})
const runs = Number(values.runs)
if (!Number.isInteger(runs) || runs < 1)
  throw new Error(`--runs takes a whole number, not ${values.runs}`)
const forms: readonly Form[] =
  values.form === 'both'
    ? ['mobile', 'desktop']
    : values.form === 'mobile' || values.form === 'desktop'
      ? [values.form]
      : (() => {
          throw new Error(`--form is mobile, desktop or both, not ${values.form}`)
        })()
const unknown = positionals.filter((name) => !(name in PAGES))
if (unknown.length > 0) {
  throw new Error(`no page ${unknown.join(', ')}; the pages are ${Object.keys(PAGES).join(', ')}`)
}
const chosen = positionals.length > 0 ? positionals : Object.keys(PAGES)

const repoRoot = path.resolve(import.meta.dirname, '../..')
const out = path.join(
  repoRoot,
  '.qualy/lighthouse',
  new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19),
)
fs.mkdirSync(out, { recursive: true })

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo
      server.close(() => resolve(port))
    })
  })

const run = (command: string, args: readonly string[]) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let errors = ''
    child.stderr.on('data', (chunk: Buffer) => (errors += chunk.toString()))
    child.once('error', reject)
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${String(code)}\n${errors}`)),
    )
  })

interface Report {
  readonly runtimeError?: { readonly code: string; readonly message: string }
  readonly categories: Record<string, { readonly score: number | null } | undefined>
  readonly audits: Record<string, { readonly numericValue?: number } | undefined>
}

const figuresOf = (report: Report): Figures => {
  const score = (key: string) => {
    const value = report.categories[key]?.score
    return value === null || value === undefined ? null : Math.round(value * 100)
  }
  const metric = (key: string) => report.audits[key]?.numericValue ?? null
  return {
    performance: score('performance'),
    accessibility: score('accessibility'),
    bestPractices: score('best-practices'),
    fcp: metric('first-contentful-paint'),
    lcp: metric('largest-contentful-paint'),
    tbt: metric('total-blocking-time'),
    cls: metric('cumulative-layout-shift'),
    speedIndex: metric('speed-index'),
  }
}

const median = (numbers: readonly (number | null)[]): number | null => {
  const known = numbers.filter((value) => value !== null).sort((a, b) => a - b)
  if (known.length === 0) return null
  const middle = Math.floor(known.length / 2)
  return known.length % 2 === 1 ? known[middle]! : (known[middle - 1]! + known[middle]!) / 2
}

const port = await freePort()
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-lighthouse-'))
const browser = await chromium.launchPersistentContext(profile, {
  channel: 'chrome',
  headless: true,
  baseURL: stack.base,
  // Lighthouse emulates the device on its own tab; a viewport of ours would race it
  viewport: null,
  ignoreHTTPSErrors: true,
  // the edge's certificate is its own, and Lighthouse's tab needs to accept it too
  args: [`--remote-debugging-port=${String(port)}`, '--ignore-certificate-errors', '--lang=zh-CN'],
})

const summary: {
  page: string
  form: Form
  median: Figures
  runs: Figures[]
  report: string
  errors: string[]
}[] = []
try {
  const tab = browser.pages()[0] ?? (await browser.newPage())
  // pages grouped by who opens them: one sign-in each
  const byWho = new Map<Account | undefined, string[]>()
  for (const name of chosen) {
    const who = PAGES[name]!.who
    byWho.set(who, [...(byWho.get(who) ?? []), name])
  }
  for (const [who, names] of byWho) {
    await browser.clearCookies()
    if (who !== undefined) await signIn(tab, who)
    // out of the way: a page of ours left open keeps its own requests going
    await tab.goto('about:blank')
    for (const name of names) {
      const url = new URL(PAGES[name]!.path, stack.base).href
      for (const form of forms) {
        const reports: { figures: Figures; file: string }[] = []
        const errors: string[] = []
        for (let index = 1; index <= runs; index++) {
          const base = path.join(out, `${name}-${form}-${String(index)}`)
          process.stdout.write(`${name} ${form} ${String(index)}/${String(runs)}\n`)
          await run('pnpm', [
            'dlx',
            LIGHTHOUSE,
            url,
            `--port=${String(port)}`,
            '--output=json',
            '--output=html',
            `--output-path=${base}`,
            '--quiet',
            ...(form === 'desktop' ? ['--preset=desktop'] : []),
          ])
          const report = JSON.parse(fs.readFileSync(`${base}.report.json`, 'utf8')) as Report
          if (report.runtimeError !== undefined) {
            errors.push(`${report.runtimeError.code}: ${report.runtimeError.message}`)
          }
          reports.push({ figures: figuresOf(report), file: `${base}.report.html` })
        }
        const middle = Object.fromEntries(
          Object.keys(FIGURES).map((key) => [
            key,
            median(reports.map((entry) => entry.figures[key as keyof Figures])),
          ]),
        ) as Figures
        // the run whose performance score is the median one, to open and read
        const representative =
          reports.find((entry) => entry.figures.performance === middle.performance) ?? reports[0]!
        summary.push({
          page: name,
          form,
          median: middle,
          runs: reports.map((entry) => entry.figures),
          report: path.relative(repoRoot, representative.file),
          errors,
        })
      }
    }
  }
} finally {
  await browser.close()
  fs.rmSync(profile, { recursive: true, force: true })
}

fs.writeFileSync(path.join(out, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)

const shown = (key: keyof typeof FIGURES, value: number | null) =>
  value === null
    ? '-'
    : FIGURES[key].unit === 'shift'
      ? value.toFixed(3)
      : String(Math.round(value))
const header = ['page', 'form', ...Object.values(FIGURES).map((figure) => figure.label)]
const rows = summary.map((entry) => [
  entry.page,
  entry.form,
  ...(Object.keys(FIGURES) as (keyof typeof FIGURES)[]).map((key) => shown(key, entry.median[key])),
])
const widths = header.map((cell, column) =>
  Math.max(cell.length, ...rows.map((row) => row[column]!.length)),
)
const line = (cells: readonly string[]) =>
  cells.map((cell, column) => cell.padEnd(widths[column]!)).join('  ')
console.log(`\nmedian of ${String(runs)} (${LIGHTHOUSE}, ${stack.base})\n`)
console.log(line(header))
for (const row of rows) console.log(line(row))
for (const entry of summary) {
  for (const error of entry.errors) console.log(`\n${entry.page} ${entry.form}: ${error}`)
}
console.log(`\nreports: ${path.relative(repoRoot, out)}`)
