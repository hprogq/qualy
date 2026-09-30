import fs from 'node:fs'
import path from 'node:path'
import type { Page } from 'playwright'

// The deployment e2e-stack.ts started and the way into it, with nothing of
// the test runner in it: the journeys use it through support.ts, and the
// Lighthouse runner (tools/quality/lighthouse.ts) signs in with it too.

const repoRoot = path.resolve(import.meta.dirname, '../..')

interface Stack {
  readonly base: string
  readonly release: string
  readonly accounts: Record<string, { readonly email: string; readonly password: string }>
}

export const stack: Stack = (() => {
  const file = path.join(repoRoot, '.qualy/e2e/stack.json')
  if (!fs.existsSync(file)) {
    throw new Error(
      'no .qualy/e2e/stack.json: start the deployment with node tools/quality/e2e-stack.ts up',
    )
  }
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Stack
})()

export type Account = 'admin' | 'student' | 'classLead' | 'counsellor' | 'lead'

/**
 * Fills in and sends the sign-in form on the sign-in page the browser is on,
 * and leaves what happens next to the caller.
 */
export const submitSignIn = async (page: Page, who: Account) => {
  const account = stack.accounts[who]
  if (account === undefined) throw new Error(`the stack has no ${who} account`)
  // a narrow screen lists the ways in first; a wide one opens on the form
  // (whichever shows first: a narrow screen keeps the form in the page, hidden)
  const byPassword = page.getByRole('button', { name: '邮箱密码' })
  const email = page.getByLabel('邮箱', { exact: true })
  await Promise.race([email.waitFor().catch(() => {}), byPassword.waitFor().catch(() => {})])
  if (await byPassword.isVisible()) await byPassword.click()
  await page.getByLabel('邮箱', { exact: true }).fill(account.email)
  await page.getByLabel('密码', { exact: true }).fill(account.password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
}

/**
 * Signs in with an email and password, as a person does on the sign-in page -
 * from the front door, or (`here`) on the sign-in page the browser was
 * already sent to.
 */
export const signIn = async (page: Page, who: Account, options: { here?: boolean } = {}) => {
  if (options.here !== true) await page.goto('/')
  await submitSignIn(page, who)
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })
}
