import { describe, expect, it } from 'vitest'
import { browsing, signIn } from './support.ts'

// A reviewer asks for more, the person answers with a file, and the reviewer
// reads the answer - the loop a claim goes round when it is not yet enough.
//
// In the baseline the counsellor has asked the demonstration student for the
// registrar's stamped page of the transcript. The student uploads it through
// the browser (the release's own storage backend takes the bytes), and the
// counsellor then finds the answer with the claim, file and all.

const BATCH = '01a0eecf-3203-7965-bb14-2ac8fcace35f'
const STUDENT_NUMBER = '230990426'

/** a small PNG - a real image, so the upload is checked the way a photo is */
const stampedPage = () =>
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAQ0lEQVR42u3OMQ0AAAjAMPybhnsfJKRyLG0A' +
      'FAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4FQDfxkBjUgcn1MAAAAASUVORK5CYII=',
    'base64',
  )

describe('a claim sent back for more', () => {
  const session = browsing()

  it('is answered with a file by its owner and read by the reviewer', async () => {
    const page = session.page()
    await signIn(page, 'student')
    await page.goto(`/assessment/batches/${BATCH}/my-entries`)

    // the transcript, waiting on the student
    await page
      .getByRole('button', { name: /^成绩单/ })
      .first()
      .click()
    await page.getByTestId('claim-row').first().click()
    await page.getByRole('button', { name: '补充材料', exact: true }).click()

    const form = page.getByRole('dialog').last()
    await form.locator('input[type=file]').first().setInputFiles({
      name: '教务处盖章页.png',
      mimeType: 'image/png',
      buffer: stampedPage(),
    })
    await form.getByRole('textbox').last().fill('已补教务处盖章页')
    const answered = page.waitForResponse(
      (response) => response.request().method() === 'POST' && /supplement/.test(response.url()),
      { timeout: 30_000 },
    )
    await form.getByRole('button', { name: /^提交/ }).click()
    expect((await answered).status()).toBeLessThan(300)

    // the counsellor sees the answer with the claim
    await page.context().clearCookies()
    await signIn(page, 'counsellor')
    await page.goto(`/assessment/batches/${BATCH}/reviews?view=person`)
    await page.getByTestId('queue-master-row').filter({ hasText: STUDENT_NUMBER }).click()
    await page.getByTestId('inbox-row').filter({ hasText: '成绩单' }).first().click()
    await expect
      .poll(() => page.getByText('已补教务处盖章页').isVisible(), { timeout: 20_000 })
      .toBe(true)
    await expect
      .poll(() =>
        page
          .getByRole('link', { name: /教务处盖章页/ })
          .first()
          .isVisible(),
      )
      .toBe(true)
  })
})
