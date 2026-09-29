import fs from 'node:fs'
import path from 'node:path'
import { chromium, type Page } from 'playwright'

// What a person's screen asks the server for, recorded from a real browser
// so the load test replays the product's own requests rather than a guess
// at them. Signs in as each account the load test plays, opens each screen,
// and keeps the api GETs it made (with the headers the browser sent) and the
// session the account signed in with.
//
//   node tools/benchmarks/capacity/record.ts
//
// Needs the deployment tools/quality/e2e-stack.ts started; writes
// .qualy/e2e/capacity/plan.json for load.js.

const repoRoot = path.resolve(import.meta.dirname, '../../..')
const stack = JSON.parse(fs.readFileSync(path.join(repoRoot, '.qualy/e2e/stack.json'), 'utf8')) as {
  base: string
  accounts: Record<string, { email: string; password: string }>
}
const BATCH = '01a0eecf-3203-7965-bb14-2ac8fcace35f'

/** the screens each workload opens, in the order a person would */
const SCREENS: Record<string, { who: string; routes: string[] }> = {
  student: {
    who: 'student',
    routes: [
      '/assessment/batches',
      `/assessment/batches/${BATCH}/my-entries`,
      `/assessment/batches/${BATCH}/my-result`,
    ],
  },
  reviewer: {
    who: 'counsellor',
    routes: [
      `/assessment/batches/${BATCH}/reviews`,
      `/assessment/batches/${BATCH}/reviews?view=person`,
    ],
  },
}

const signIn = async (page: Page, who: string) => {
  const account = stack.accounts[who]!
  await page.goto('/')
  const byPassword = page.getByRole('button', { name: '邮箱密码' })
  const email = page.getByLabel('邮箱', { exact: true })
  await Promise.race([email.waitFor().catch(() => {}), byPassword.waitFor().catch(() => {})])
  if (await byPassword.isVisible()) await byPassword.click()
  await email.fill(account.email)
  await page.getByLabel('密码', { exact: true }).fill(account.password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'))
}

const browser = await chromium.launch()
const plan: {
  workloads: Record<
    string,
    {
      cookie: string
      screens: { route: string; requests: { path: string; headers: Record<string, string> }[] }[]
    }
  >
} = { workloads: {} }
for (const [name, workload] of Object.entries(SCREENS)) {
  const context = await browser.newContext({
    baseURL: stack.base,
    ignoreHTTPSErrors: true,
    locale: 'zh-CN',
  })
  const page = await context.newPage()
  await signIn(page, workload.who)
  const screens = []
  for (const route of workload.routes) {
    const requests: { path: string; headers: Record<string, string> }[] = []
    const listen = (request: import('playwright').Request) => {
      const url = new URL(request.url())
      // the page's own api reads; the event stream stays open and is not a read
      if (
        request.method() === 'GET' &&
        url.pathname.startsWith('/api/') &&
        !url.pathname.endsWith('/events')
      ) {
        const headers = Object.fromEntries(
          Object.entries(request.headers()).filter(([key]) => key.startsWith('x-qualy-')),
        )
        requests.push({ path: `${url.pathname}${url.search}`, headers })
      }
    }
    page.on('request', listen)
    await page.goto(route)
    await page.getByRole('heading').first().waitFor()
    await page.waitForTimeout(2500)
    page.off('request', listen)
    screens.push({ route, requests })
  }
  const cookies = await context.cookies()
  plan.workloads[name] = {
    cookie: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; '),
    screens,
  }
  await context.close()
}
await browser.close()
const out = path.join(repoRoot, '.qualy/e2e/capacity')
fs.mkdirSync(out, { recursive: true })
fs.writeFileSync(path.join(out, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`)
for (const [name, workload] of Object.entries(plan.workloads)) {
  console.log(
    `${name}: ${workload.screens.map((screen) => `${screen.route} (${String(screen.requests.length)} requests)`).join(', ')}`,
  )
}
