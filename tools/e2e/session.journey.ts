import { describe, expect, it } from 'vitest'
import { browsing, signIn, submitSignIn } from './support.ts'

// A session that ends while somebody is reading: the next load sends them to
// sign in, and signing in brings them back to the page they were on - not to
// the front page, where they would have to find their way back.

const BATCH = '01a0eecf-3203-7965-bb14-2ac8fcace35f'

describe('a session that has ended', () => {
  const session = browsing()

  it('asks the reader to sign in again and returns them to where they were', async () => {
    const page = session.page()
    await signIn(page, 'student')
    const where = `/assessment/batches/${BATCH}/my-result`
    await page.goto(where)
    await page.getByRole('heading', { level: 1 }).first().waitFor()

    // the session is gone - signed out elsewhere, expired, a cleared browser
    await page.context().clearCookies()
    await page.reload()
    await page.waitForURL((url) => url.pathname.startsWith('/login'), { timeout: 30_000 })

    await signIn(page, 'student', { here: true })
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 30_000 }).toBe(where)
  })
})

// A session that ends while the page is open and something is typed on it:
// the page stays where it is, locked under a question, and signing in again
// happens in a tab of its own. Coming back before signing in shows the same
// wait, not the sign-in page and not a second question; signing in there
// carries the page on - the typing still in it, the refused call made again.
describe('a session that ends under an open page', () => {
  const session = browsing()

  it('keeps the page and what was typed while the reader signs in again elsewhere', async () => {
    const page = session.page()
    await signIn(page, 'student')
    const where = `/assessment/batches/${BATCH}/my-entries`
    await page.goto(where)
    await page
      .getByRole('button', { name: /^成绩单/ })
      .first()
      .click()
    await page.getByTestId('claim-row').first().waitFor()
    // a narrow pane keeps the search behind a button
    const search = page.getByRole('searchbox', { name: '搜索' })
    if (!(await search.isVisible())) await page.getByRole('button', { name: '搜索' }).click()
    await search.fill('成绩')

    const answers: { url: string; status: number }[] = []
    page.on('response', (response) => {
      if (new URL(response.url()).pathname.startsWith('/api/')) {
        answers.push({ url: response.url(), status: response.status() })
      }
    })

    // the session is gone while the reader is away, and they come back to
    // the tab: everything on it is asked again, the manifest answering as
    // nobody and the page's own reads refused
    await page.context().clearCookies()
    await page.evaluate(() =>
      document.dispatchEvent(new Event('visibilitychange', { bubbles: true })),
    )
    const lost = page.getByTestId('session-recovery')
    await expect.poll(() => lost.getAttribute('data-state'), { timeout: 20_000 }).toBe('expired')
    expect(new URL(page.url()).pathname).toBe(where)
    const refused = answers.filter((answer) => answer.status === 401).map((answer) => answer.url)
    expect(refused.length).toBeGreaterThan(0)

    const opening = page.context().waitForEvent('page')
    await page.getByTestId('session-sign-in').click()
    const signInTab = await opening
    await signInTab.waitForLoadState()
    expect(new URL(signInTab.url()).searchParams.get('resume')).toBe('1')

    // back on the page before signing in: the same wait, nothing else
    await page.bringToFront()
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.waitForTimeout(1_500)
    expect(new URL(page.url()).pathname).toBe(where)
    expect(await page.getByTestId('session-recovery').count()).toBe(1)
    expect(await lost.getAttribute('data-state')).toBe('waiting')

    // signing in there closes that tab, or says the page carries on
    await signInTab.bringToFront()
    await submitSignIn(signInTab, 'student')
    await Promise.race([
      signInTab.waitForEvent('close', { timeout: 30_000 }),
      signInTab.getByTestId('sign-in-resumed').waitFor({ timeout: 30_000 }),
    ])

    await page.bringToFront()
    await expect.poll(() => lost.count(), { timeout: 20_000 }).toBe(0)
    expect(new URL(page.url()).pathname).toBe(where)
    expect(await search.inputValue()).toBe('成绩')
    // every refused call was made again, and answered
    await expect
      .poll(
        () =>
          refused.every((url) =>
            answers.some((answer) => answer.url === url && answer.status < 300),
          ),
        { timeout: 20_000 },
      )
      .toBe(true)
  })
})
