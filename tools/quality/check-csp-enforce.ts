import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'
import { startQualyServer } from '../lib/qualy-server.ts'

// The shell's content security policy, enforced, in a browser.
//
// Reading the bundle for `eval` says where code is made from strings; only
// a browser running the page under the policy says whether the policy can
// be enforced at all - a worker started from a blob, a style set the wrong
// way, a font from elsewhere are all the policy's business and none of them
// spell eval. So the production host is started with QUALY_CSP_MODE=enforce
// and a real Chromium opens the pages that pull the most in: the login
// page, which is the whole boot graph, and, when an administrator's
// credentials are in the environment, the batch list and the formula
// editor with its code editor. Every violation the page reports and every
// policy line the console prints fails the run.

const PORT = process.env.CSP_SMOKE_PORT ?? '3198'
const base = `http://127.0.0.1:${PORT}`

const server = startQualyServer({
  port: PORT,
  env: {
    QUALY_CSP_MODE: 'enforce',
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://qualy:qualy@localhost:5432/qualy',
  },
})

const fail = (message: string): never => {
  console.error(`check-csp-enforce: ${message}`)
  console.error(server.output().split('\n').slice(-20).join('\n'))
  server.kill()
  process.exit(1)
}

await server.waitUntilReady().catch((error: unknown) => fail(String(error)))
const policy = (await fetch(`${base}/`)).headers.get('content-security-policy')
if (policy === null) fail('the shell carries no enforced content-security-policy header')
console.log(`check-csp-enforce: enforcing ${policy}`)

const browser = await chromium.launch()
const violations: string[] = []
/** what was actually opened, so the last line can only claim that much */
const opened: string[] = []
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'zh-CN',
  })
  const page = await context.newPage()
  // written as source, not a function: this file is compiled for node,
  // and the page's globals are the page's
  await context.addInitScript(`
    window.__csp = []
    document.addEventListener('securitypolicyviolation', (event) => {
      window.__csp.push(
        event.violatedDirective + ' blocked ' + (event.blockedURI || 'inline') +
          ' at ' + (event.sourceFile || document.location.pathname) + ':' + event.lineNumber,
      )
    })
  `)
  page.on('console', (message) => {
    if (/Content Security Policy/.test(message.text()))
      violations.push(`console: ${message.text().slice(0, 240)}`)
  })
  const visit = async (route: string, settle = 1500) => {
    await page.goto(`${base}${route}`, { waitUntil: 'networkidle' })
    await delay(settle)
    const reported = (await page.evaluate('window.__csp')) as string[]
    for (const line of reported) violations.push(`${route}: ${line}`)
    opened.push(route)
    console.log(
      `check-csp-enforce: ${route} opened, ${String(reported.length)} violation(s) reported`,
    )
  }
  await visit('/login')
  const username = process.env.QUALY_ADMIN_USERNAME
  const password = process.env.QUALY_ADMIN_PASSWORD
  if (username && password) {
    const status = await page.evaluate(
      async ([identifier, secret]) =>
        (
          await fetch('/api/auth/local/local/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ identifier, password: secret }),
          })
        ).status,
      [username, password] as const,
    )
    if (status !== 200) fail(`sign-in answered ${String(status)}`)
    await visit('/assessment/batches')
    await visit('/library/formulas', 4000)
  } else if (process.env.CSP_REQUIRE_SIGNED_IN === '1') {
    // The pages worth opening under an enforced policy are the signed-in
    // ones: the only Workers in the tree are the code editor's, and
    // `worker-src` is the directive most likely to be broken. Skipping them
    // used to be a log line inside a run that then said no violations - so
    // the gate degraded to the login page and stayed green about it.
    fail('no administrator credentials; the signed-in pages were not opened')
  } else {
    console.log(
      'check-csp-enforce: no administrator credentials in the environment; the signed-in pages are not opened',
    )
  }
} finally {
  await browser.close()
}
if (violations.length > 0) {
  fail(`${String(violations.length)} policy violation(s):\n  ${violations.join('\n  ')}`)
}
await server.stop()
console.log(`check-csp-enforce: no violations on ${opened.join(', ')} under the enforced policy`)
