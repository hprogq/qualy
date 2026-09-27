import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { StrictMode, useState } from 'react'
import { Link, Route, Routes, useNavigate } from 'react-router'
import { Effect } from 'effect'
import { I18nProvider } from '@qualy/web-i18n'
import { UiProvider } from '@qualy/ui/provider'
import { GuardedBrowserRouter, useLeaveGuard, useSessionTransition } from '@qualy/web-runtime'
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

  it('lets a change of identity through without asking: the changes were the last identity’s', async () => {
    function SignOut() {
      const transition = useSessionTransition()
      return (
        <button
          type="button"
          onClick={() => void transition({ destination: { kind: 'page', page: 'auth/login' } })}
        >
          sign out
        </button>
      )
    }
    await renderScreen({
      client: fakeClient({
        app: {
          getManifest: () =>
            Effect.succeed({
              ...emptyManifest(),
              pages: [{ id: 'auth/login', path: '/login', layout: 'blank' }],
            }),
        },
      }),
      route: '/editor',
      routes: [
        {
          path: '/editor',
          element: (
            <>
              <Editor saves={false} />
              <SignOut />
            </>
          ),
        },
        { path: '/login', element: <main data-testid="signed-out" /> },
      ],
    })
    await edit()
    await page.getByRole('button', { name: 'sign out' }).click()
    await expect.element(page.getByTestId('signed-out')).toBeInTheDocument()
    expect(question().elements()).toHaveLength(0)
    expect(addressNow()).toBe('/login')
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

describe('a page with unsaved changes, under the browser’s own history', () => {
  // The router the application runs under, over this frame's real history:
  // the browser's back arrives later, as a pop of its own, and is undone and
  // taken again the same way - not the history in memory, which answers a
  // step on the spot.
  let origin = ''
  beforeEach(() => {
    origin = `${location.pathname}${location.search}${location.hash}`
    localStorage.setItem('qualy.locale', 'zh-CN')
    document.documentElement.dataset['locale'] = 'zh-CN'
    window.history.replaceState(null, '', '/start')
  })
  afterEach(() => {
    window.history.replaceState(null, '', origin)
  })

  const mountInBrowser = (editor: React.ReactNode = <Editor saves={false} />) =>
    render(
      <StrictMode>
        <I18nProvider catalogs={[]} errorMessages={{}} fallback={null}>
          <UiProvider scheme="light">
            <GuardedBrowserRouter>
              <Routes>
                <Route path="/start" element={<Link to="/editor">open the editor</Link>} />
                <Route path="/editor" element={editor} />
              </Routes>
            </GuardedBrowserRouter>
          </UiProvider>
        </I18nProvider>
      </StrictMode>,
    )

  it('undoes the browser’s back while it asks, and takes it again once the reader goes', async () => {
    const screen = await mountInBrowser()
    await page.getByRole('link', { name: 'open the editor' }).click()
    await vi.waitFor(() => expect(location.pathname).toBe('/editor'))
    await edit()
    window.history.back()
    await expect.element(question()).toBeVisible()
    // the step has been taken back: the address is the page's own again
    await vi.waitFor(() => expect(location.pathname).toBe('/editor'))
    // and the page under the question never moved
    await expect.element(page.getByTestId('editor')).toHaveAttribute('data-dirty', 'true')
    await page.getByRole('button', { name: '放弃修改' }).click()
    await expect.element(page.getByRole('link', { name: 'open the editor' })).toBeVisible()
    expect(location.pathname).toBe('/start')
    await screen.unmount()
  })

  it('keeps the reader, the address and the changes when they stay', async () => {
    const screen = await mountInBrowser()
    await page.getByRole('link', { name: 'open the editor' }).click()
    await edit()
    window.history.back()
    await expect.element(question()).toBeVisible()
    await page.getByRole('button', { name: '继续编辑' }).click()
    await expect.element(question()).not.toBeInTheDocument()
    await vi.waitFor(() => expect(location.pathname).toBe('/editor'))
    await expect.element(page.getByRole('textbox', { name: 'name' })).toHaveValue('草稿')
    // and the next back is asked about again
    window.history.back()
    await expect.element(question()).toBeVisible()
    await screen.unmount()
  })

  // A page that leaves its changes on purpose steps back itself, and that
  // step arrives as a pop like the reader's own. The browser says which
  // entry the step lands on, so the pop is known for the page's however
  // long it is in coming - here, behind a task that holds the thread for
  // longer than any wait for it would have lasted.
  it('lets the page’s own step back through however late the browser answers it', async () => {
    function Leaving() {
      const [draft, setDraft] = useState('')
      const navigate = useNavigate()
      const { bypass } = useLeaveGuard({ when: draft !== '' })
      return (
        <div data-testid="editor" data-dirty={draft !== ''}>
          <input
            aria-label="name"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button
            type="button"
            onClick={() => {
              bypass(() => void navigate(-1))
              const until = performance.now() + 1_200
              let spins = 0
              while (performance.now() < until) spins += 1
              expect(spins).toBeGreaterThan(0)
            }}
          >
            discard and go back
          </button>
        </div>
      )
    }
    const screen = await mountInBrowser(<Leaving />)
    await page.getByRole('link', { name: 'open the editor' }).click()
    await edit()
    await page.getByRole('button', { name: 'discard and go back' }).click()
    await expect.element(page.getByRole('link', { name: 'open the editor' })).toBeVisible()
    expect(location.pathname).toBe('/start')
    expect(question().elements()).toHaveLength(0)
    await screen.unmount()
  })
})
