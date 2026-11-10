import { useState } from 'react'
import { expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { useLocalDraft } from '../src/client/review/use-draft.ts'
import { DraftNote } from '../src/client/review/DraftNote.tsx'
import { readDraft } from '../src/client/local-store.ts'

vi.mock('../src/client/signed-in.ts', () => ({ useSignedInUserId: () => 'conflict-reader' }))

it('preserves both open editors and lets a reviewer resolve a conflicting copy explicitly', async () => {
  const id = `${crypto.randomUUID()}:reject:normal:class`
  function Editor({ name }: { name: string }) {
    const [comment, setComment] = useState('')
    const draft = useLocalDraft({
      id,
      value: { comment },
      empty: (words) => words.comment === '',
      onRestore: (words) => setComment(words.comment),
    })
    return (
      <section data-testid={name}>
        <textarea
          aria-label={name}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
        />
        <DraftNote draft={draft} onDiscard={() => setComment('')} />
      </section>
    )
  }
  document.documentElement.dataset.locale = 'zh-CN'
  const view = await render(
    <>
      <Editor name="editor-a" />
      <Editor name="editor-b" />
    </>,
  )
  await page.getByRole('textbox', { name: 'editor-a' }).fill('First editor’s unsent words')
  await page.getByRole('textbox', { name: 'editor-b' }).fill('Second editor’s unsent words')
  await expect.poll(async () => (await readDraft(`conflict-reader:${id}`))?.conflicted).toBe(true)
  await expect.element(page.getByTestId('editor-a').getByTestId('draft-conflict')).toBeVisible()
  await expect.element(page.getByTestId('editor-b').getByTestId('draft-conflict')).toBeVisible()
  await expect
    .element(page.getByRole('textbox', { name: 'editor-a' }))
    .toHaveValue('First editor’s unsent words')
  await expect
    .element(page.getByRole('textbox', { name: 'editor-b' }))
    .toHaveValue('Second editor’s unsent words')
  await page.getByTestId('editor-a').getByTestId('draft-conflict-keep').click()
  await expect.poll(async () => (await readDraft(`conflict-reader:${id}`))?.conflicted).toBe(false)
  await expect
    .element(page.getByRole('textbox', { name: 'editor-a' }))
    .toHaveValue('First editor’s unsent words')
  const row = (await readDraft(`conflict-reader:${id}`))!
  expect([row.value, ...(row.alternatives ?? []).map((copy) => copy.value)]).toContainEqual({
    comment: 'Second editor’s unsent words',
  })
  await view.unmount()
})
