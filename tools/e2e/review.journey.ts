import { describe, expect, it } from 'vitest'
import { browsing, signIn } from './support.ts'

// A reviewer passes a claim, and the person who filed it sees it passed.
//
// The baseline's running round is in its review stage, and the demonstration
// student's computer design contest claim waits with the counsellor, the one
// review it needs. Everything below goes through the browser and the real
// server: the queue, the material, the decision, and the student's own view
// of it afterwards.

const BATCH = '01a0eecf-3203-7965-bb14-2ac8fcace35f'
const STUDENT_NUMBER = '230990426'
const CONTEST = '中国大学生计算机设计大赛'

describe('a claim passed in review', () => {
  const session = browsing()

  it('is opened with its material, passed, and seen passed by its owner', async () => {
    const page = session.page()
    await signIn(page, 'counsellor')
    await page.goto(`/assessment/batches/${BATCH}/reviews?view=person`)

    // the student in the reviewer's queue, and their claim on the workbench
    await page.getByTestId('queue-master-row').filter({ hasText: STUDENT_NUMBER }).click()
    await page.getByTestId('inbox-row').filter({ hasText: CONTEST }).first().click()
    await page.getByTestId('act-approve').waitFor()

    // the material is the file the student uploaded, served to the reviewer
    const material = page.getByRole('link', { name: /\.(jpe?g|png|pdf)$/i }).first()
    const href = await material.getAttribute('href')
    expect(href).toBeTruthy()
    const served = await page.request.get(href!)
    expect(served.status()).toBe(200)
    expect(served.headers()['content-type']).toMatch(/^(image\/|application\/pdf)/)
    expect((await served.body()).length).toBeGreaterThan(1000)

    // the decision, with a word for the student - sent once the moment to
    // take it back has passed, which is the request waited for here
    await page.getByTestId('act-approve').click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('审核意见').fill('材料齐全，同意')
    const decided = page.waitForResponse(
      (response) =>
        response.request().method() !== 'GET' &&
        response.url().includes('/review/instances/') &&
        !response.url().includes('determination-previews'),
      { timeout: 30_000 },
    )
    await dialog.getByRole('button', { name: /^通过/ }).click()
    expect((await decided).status()).toBeLessThan(300)

    // the student, signing in afresh, finds the claim passed
    await page.context().clearCookies()
    await signIn(page, 'student')
    await page.goto(`/assessment/batches/${BATCH}/my-entries`)
    await page
      .getByRole('button', { name: /^学科竞赛/ })
      .first()
      .click()
    const claim = page.getByTestId('claim-row').filter({ hasText: CONTEST })
    await expect.poll(() => claim.textContent(), { timeout: 20_000 }).toContain('已通过')
  })
})
