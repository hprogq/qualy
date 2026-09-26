import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Effect } from 'effect'
import { useLeaveGuard } from '@qualy/web-runtime'
import { addressNow, emptyManifest, fakeClient, renderScreen } from './support/harness.tsx'

// A page with changes on it asks before it is left - however the reader
// leaves it: a link, a button that navigates, the browser's back - and a
// move that stays on the page (another tab of it in the address) is not
// leaving. The question has three answers: keep editing, save and go, or
// go without the changes.

const saved = vi.fn()

function Editor({ saves, saveWorks = true }: { saves: boolean; saveWorks?: boolean }) {
  const [draft, setDraft] = useState('')
  const [kept, setKept] = useState('')
  const dirty = draft !== kept
  const navigate = useNavigate()
  const { bypass } = useLeaveGuard({
    when: dirty,
    ...(saves
      ? {
          onSave: async () => {
            saved(draft)
            if (!saveWorks) return false
            setKept(draft)
            return true
          },
        }
      : {}),
  })
  return (
    <div data-testid="editor" data-dirty={dirty}>
      <input aria-label="name" value={draft} onChange={(event) => setDraft(event.target.value)} />
      <Link to="/elsewhere">elsewhere</Link>
      <button type="button" onClick={() => void navigate('/editor?tab=2')}>
        another tab
      </button>
      <button type="button" onClick={() => void navigate(-1)}>
        back
      </button>
      <button
        type="button"
        onClick={() => {
          saved(draft)
          setKept(draft)
          // decided by the page itself, straight after its own save
          bypass(() => void navigate('/elsewhere'))
        }}
      >
        save and go on
      </button>
    </div>
  )
}

const mount = (options: { saves?: boolean; saveWorks?: boolean; route?: string } = {}) =>
  renderScreen({
    client: fakeClient({ app: { getManifest: () => Effect.succeed(emptyManifest()) } }),
    route: options.route ?? '/editor',
    routes: [
      { path: '/start', element: <Link to="/editor">open the editor</Link> },
      {
        path: '/editor',
        element: <Editor saves={options.saves ?? false} saveWorks={options.saveWorks ?? true} />,
      },
      { path: '/elsewhere', element: <p data-testid="elsewhere">elsewhere page</p> },
    ],
  })

const question = () => page.getByRole('alertdialog')
const edit = async () => {
  await page.getByRole('textbox', { name: 'name' }).fill('草稿')
  await expect.element(page.getByTestId('editor')).toHaveAttribute('data-dirty', 'true')
}

describe('a page with unsaved changes', () => {
  it('lets the reader go without asking while nothing is changed', async () => {
    await mount()
    await page.getByRole('link', { name: 'elsewhere' }).click()
    await expect.element(page.getByTestId('elsewhere')).toBeVisible()
    expect(question().elements()).toHaveLength(0)
  })

  it('asks before a link leaves it, and keeps the reader and the changes on staying', async () => {
    await mount()
    await edit()
    await page.getByRole('link', { name: 'elsewhere' }).click()
    await expect.element(question()).toBeVisible()
    // nothing has moved while the question is open
    expect(addressNow()).toBe('/editor')
    await page.getByRole('button', { name: '继续编辑' }).click()
    await expect.element(question()).not.toBeInTheDocument()
    expect(addressNow()).toBe('/editor')
    await expect.element(page.getByRole('textbox', { name: 'name' })).toHaveValue('草稿')
  })

  it('goes without the changes when the reader lets them drop', async () => {
    await mount()
    await edit()
    await page.getByRole('link', { name: 'elsewhere' }).click()
    await page.getByRole('button', { name: '放弃修改' }).click()
    await expect.element(page.getByTestId('elsewhere')).toBeVisible()
    expect(addressNow()).toBe('/elsewhere')
  })

  it('saves and then goes, when the page can save', async () => {
    saved.mockClear()
    await mount({ saves: true })
    await edit()
    await page.getByRole('link', { name: 'elsewhere' }).click()
    // the same question, with a way to keep the changes as well as to go
    await expect.element(page.getByRole('button', { name: '放弃修改' })).toBeVisible()
    await page.getByRole('button', { name: '保存后离开' }).click()
    await expect.element(page.getByTestId('elsewhere')).toBeVisible()
    expect(saved).toHaveBeenCalledWith('草稿')
  })

  it('stays put when the save does not go through, so the page can say why', async () => {
    saved.mockClear()
    await mount({ saves: true, saveWorks: false })
    await edit()
    await page.getByRole('link', { name: 'elsewhere' }).click()
    await page.getByRole('button', { name: '保存后离开' }).click()
    await vi.waitFor(() => expect(saved).toHaveBeenCalledTimes(1))
    await expect.element(question()).not.toBeInTheDocument()
    expect(addressNow()).toBe('/editor')
    await expect.element(page.getByTestId('editor')).toHaveAttribute('data-dirty', 'true')
  })

  it('does not count another state of the same page as leaving it', async () => {
    await mount()
    await edit()
    await page.getByRole('button', { name: 'another tab' }).click()
    await vi.waitFor(() => expect(addressNow()).toBe('/editor?tab=2'))
    expect(question().elements()).toHaveLength(0)
  })

  it('asks before the browser’s own back takes the reader away', async () => {
    await mount({ route: '/start' })
    await page.getByRole('link', { name: 'open the editor' }).click()
    await edit()
    await page.getByRole('button', { name: 'back' }).click()
    await expect.element(question()).toBeVisible()
    expect(addressNow()).toBe('/editor')
    await page.getByRole('button', { name: '放弃修改' }).click()
    await expect.element(page.getByRole('link', { name: 'open the editor' })).toBeVisible()
    expect(addressNow()).toBe('/start')
  })

  it('does not ask about a move the page decides on itself after saving', async () => {
    saved.mockClear()
    await mount()
    await edit()
    await page.getByRole('button', { name: 'save and go on' }).click()
    await expect.element(page.getByTestId('elsewhere')).toBeVisible()
    expect(question().elements()).toHaveLength(0)
  })

  it('has the browser ask before a reload or a closed tab takes the changes', async () => {
    await mount()
    const leaving = () => {
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    }
    expect(leaving()).toBe(false)
    await edit()
    expect(leaving()).toBe(true)
  })
})
