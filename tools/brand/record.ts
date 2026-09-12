import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'

import { repoRoot } from '../lib/manifest.ts'

// Two cold starts of the real product, twelve frames each.
//
// The production entry is booted over the staged assets and the committed
// lock, an administrator signs in, and a browser opens the shell twice: once
// with the manifest answered so that the shell is ready around 300ms, once
// around 3s. Frames come from the browser's own screencast, stamped by the
// compositor, so each one is the picture at the moment its caption says -
// the first frame index.html paints, the take-over, the loop if the wait
// ran past the threshold, the rest, the flight into the top bar.
//
// A design tool, run by hand: `pnpm brand:record`. It needs `pnpm build`,
// the compose database with the seed applied, and QUALY_ADMIN_USERNAME /
// QUALY_ADMIN_PASSWORD in .env - the same things `pnpm start` needs.

// A port nobody holds, asked of the system rather than fixed: a run that
// followed another too closely once found the previous server still
// answering its readiness probe, then gone by the time the shell asked
// for its chunks, and recorded a shell that could not load.
const freePort = (): Promise<string> =>
  new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      probe.close(() => {
        if (address === null || typeof address === 'string') reject(new Error('no port'))
        else resolve(String(address.port))
      })
    })
  })
const PORT = process.env.RECORD_PORT ?? (await freePort())
const BASE = `http://127.0.0.1:${PORT}`
const OUT = path.join(import.meta.dirname, 'out')
const RUNS = [
  {
    name: 'ready-300ms',
    readyAt: 300,
    at: [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1200],
  },
  {
    name: 'ready-3s',
    readyAt: 3000,
    at: [0, 200, 400, 800, 1400, 2000, 2600, 3000, 3300, 3500, 3700, 4000],
  },
] as const

const env = (name: string): string => {
  const value = process.env[name]
  if (value === undefined || value === '') throw new Error(`${name} is not set; put it in .env`)
  return value
}

// --- the server ------------------------------------------------------------

const server = spawn(
  process.execPath,
  ['--env-file-if-exists=.env', path.join(repoRoot, 'apps/server/src/run.ts'), 'production'],
  { cwd: repoRoot, env: { ...process.env, PORT }, stdio: ['ignore', 'pipe', 'pipe'] },
)
const output: string[] = []
server.stdout.on('data', (chunk: Buffer) => output.push(chunk.toString()))
server.stderr.on('data', (chunk: Buffer) => output.push(chunk.toString()))

const stop = async () => {
  if (server.exitCode !== null) return
  const exited = new Promise((resolve) => server.once('exit', resolve))
  server.kill('SIGTERM')
  await Promise.race([exited, delay(10_000)])
  if (server.exitCode === null) {
    server.kill('SIGKILL')
    await exited
  }
}

const ready = async () => {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const response = await fetch(`${BASE}/health/ready`).catch(() => undefined)
    if (response?.ok) return
    await delay(200)
  }
  await stop()
  throw new Error(`the server did not become ready\n${output.join('')}`)
}

// the same sign-in a person makes, read from the same variables the seed
// reads, so the recording shows the shell an administrator sees
const signIn = async (): Promise<string> => {
  const identifier = env('QUALY_ADMIN_USERNAME')
  const password = env('QUALY_ADMIN_PASSWORD')
  const response = await fetch(`${BASE}/api/auth/local/local/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  })
  if (!response.ok) throw new Error(`sign-in failed: ${response.status} ${await response.text()}`)
  const cookie = /qualy_session=([^;]+)/.exec(response.headers.get('set-cookie') ?? '')?.[1]
  if (cookie === undefined) throw new Error('the sign-in answered without a session cookie')
  return cookie
}

// --- the recording -----------------------------------------------------------

interface Frame {
  readonly at: number
  readonly png: Buffer
}

/**
 * One cold start: the manifest is held until `readyAt` ms after navigation
 * began, and every compositor frame is kept with the time it was painted,
 * relative to that same origin.
 */
const record = async (
  cookie: string,
  readyAt: number,
  until: number,
): Promise<readonly Frame[]> => {
  const browser = await chromium.launch()
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      colorScheme: 'light',
    })
    await context.addCookies([
      { name: 'qualy_session', value: cookie, url: BASE, httpOnly: true, sameSite: 'Lax' },
    ])
    const page = await context.newPage()
    // whatever the page reports goes into the log: a frame that shows the
    // shell failing is only useful next to the reason it gave
    page.on('pageerror', (error) => console.log(`record: page error: ${error.message}`))
    page.on('console', (message) => {
      if (message.type() === 'error') console.log(`record: console error: ${message.text()}`)
    })
    let began = 0
    await page.route('**/api/app/manifest*', async (route) => {
      const wait = began + readyAt - Date.now()
      if (wait > 0) await delay(wait)
      await route.continue()
    })
    const frames: { time: number; data: string }[] = []
    const cdp = await context.newCDPSession(page)
    cdp.on('Page.screencastFrame', (event) => {
      frames.push({ time: event.metadata.timestamp ?? 0, data: event.data })
      void cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId })
    })
    await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 })
    began = Date.now()
    await page.goto(BASE, { waitUntil: 'commit' })
    // navigation start on the page's own clock, which the frames are stamped by
    const origin = (await page.evaluate('performance.timeOrigin')) as number
    await delay(until + 500)
    await cdp.send('Page.stopScreencast')
    await context.close()
    return frames
      .map((frame) => ({
        at: Math.round(frame.time * 1000 - origin),
        png: Buffer.from(frame.data, 'base64'),
      }))
      .filter((frame) => frame.at >= -50)
      .sort((a, b) => a.at - b.at)
  } finally {
    await browser.close()
  }
}

/** the frame painted closest to each moment asked for, at or after it */
const pick = (frames: readonly Frame[], at: number): Frame | undefined =>
  frames.find((frame) => frame.at >= at) ?? frames.at(-1)

const strip = (title: string, cells: readonly { caption: string; png: Buffer }[]) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><style>body{margin:0;background:#FAFAF8;color:#18191D;font:12px system-ui}h1{font:600 13px system-ui;margin:16px 16px 0;text-transform:uppercase;letter-spacing:.06em;opacity:.7}main{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding:16px}figure{margin:0;display:grid;gap:6px}img{width:100%;display:block;border:1px solid #ddd}figcaption{opacity:.7;font-variant-numeric:tabular-nums}</style><h1>${title}</h1><main>${cells
    .map(
      (cell) =>
        `<figure><img src="data:image/png;base64,${cell.png.toString('base64')}"><figcaption>${cell.caption}</figcaption></figure>`,
    )
    .join('')}</main>`

// --- run ----------------------------------------------------------------------

fs.mkdirSync(OUT, { recursive: true })
await ready()
try {
  const cookie = await signIn()
  for (const run of RUNS) {
    const frames = await record(cookie, run.readyAt, run.at[run.at.length - 1]!)
    console.log(`record: ${run.name}: ${frames.length} frames painted`)
    const cells = run.at.map((at, i) => {
      const frame = pick(frames, at)
      if (frame === undefined) throw new Error(`no frame at or after ${at}ms`)
      const file = path.join(OUT, `${run.name}-${String(i + 1).padStart(2, '0')}.png`)
      fs.writeFileSync(file, frame.png)
      return { caption: `asked ${at}ms · painted ${frame.at}ms`, png: frame.png }
    })
    const sheet = path.join(OUT, `${run.name}.html`)
    fs.writeFileSync(sheet, strip(`cold start, manifest ready at ${run.readyAt}ms`, cells))
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({
        viewport: { width: 1600, height: 900 },
        deviceScaleFactor: 2,
      })
      await page.goto(`file://${sheet}`)
      await page.screenshot({ path: path.join(OUT, `${run.name}.png`), fullPage: true })
    } finally {
      await browser.close()
    }
    console.log(`record: wrote ${path.relative(repoRoot, path.join(OUT, `${run.name}.png`))}`)
  }
} finally {
  await stop()
}
