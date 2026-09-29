import { describe, expect, it } from 'vitest'
import { browsing, signIn } from './support.ts'

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
