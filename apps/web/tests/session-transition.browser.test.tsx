import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { useEffect, useState } from 'react'
import { Navigate } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Effect } from 'effect'
import { useManifest, useRunApi, useSessionTransition } from '@qualy/web-runtime'
import { onSignOut } from '@qualy/web-runtime/identity'
import { apiError, emptyManifest, fakeClient, renderScreen } from './support/harness.tsx'

// A change of identity drops what the last one could read, and does not ask
// for it again on the way out.
//
// Signing out used to reset the cache while the page being left was still
// mounted - a navigation is a transition, and the old page stays until the
// new one has rendered - so its queries were watched, were fetched again
// without the session, and were answered 401. Only the manifest, which every
// page stands under, is asked for again at once.

describe('a change of identity', () => {
  it('asks the manifest again, and nothing more of the page it leaves', async () => {
    let asked = 0
    let manifests = 0
    let mounts = 0
    const Leaving = () => {
      useQuery({
        queryKey: ['probe', 'leaving'],
        queryFn: () => {
          asked += 1
          return Promise.resolve(asked)
        },
      })
      useEffect(() => {
        mounts += 1
      }, [])
      const transition = useSessionTransition()
      return (
        <button
          type="button"
          onClick={() => void transition({ destination: { kind: 'page', page: 'auth/login' } })}
        >
          out
        </button>
      )
    }
    await renderScreen({
      client: fakeClient({
        app: {
          getManifest: () =>
            Effect.sync(() => {
              manifests += 1
              return {
                ...emptyManifest(),
                pages: [{ id: 'auth/login', path: '/login', layout: 'blank' }],
              }
            }),
        },
      }),
      routes: [
        { path: '/home', element: <Leaving /> },
        { path: '/login', element: <main data-testid="landed" /> },
      ],
      route: '/home',
    })
    await expect.poll(() => asked).toBe(1)
    const before = manifests
    const mounted = mounts
    await page.getByRole('button', { name: 'out' }).click()
    await expect.poll(() => manifests).toBeGreaterThan(before)
    // long enough for any refetch a reset would have started to have run
    await new Promise((settle) => setTimeout(settle, 600))
    expect({ asked, mounts }).toEqual({ asked: 1, mounts: mounted })
  })

  it('signs in to the home the new identity sees, not the one it had', async () => {
    let signedIn = false
    const Door = () => {
      const transition = useSessionTransition()
      return (
        <button
          type="button"
          onClick={() => {
            // the session exists from here on, as after a sign-in answered
            signedIn = true
            void transition({ destination: { kind: 'home' } })
          }}
        >
          in
        </button>
      )
    }
    // the origin goes to the home page the manifest names, as the route
    // builder does: before signing in, that is the sign-in page
    const Origin = () => {
      const manifest = useManifest()
      const home = manifest.pages.some((entry) => entry.id === 'app/home') ? '/home' : '/login'
      return <Navigate to={home} replace />
    }
    await renderScreen({
      client: fakeClient({
        app: {
          // the new identity's manifest takes a moment, as over a network
          getManifest: () =>
            Effect.sync(() => ({
              ...emptyManifest(),
              pages: [
                { id: 'auth/login', path: '/login', layout: 'blank' },
                ...(signedIn ? [{ id: 'app/home', path: '/home', layout: 'blank' }] : []),
              ],
            })).pipe(Effect.delay(signedIn ? '200 millis' : '0 millis')),
        },
      }),
      routes: [
        { path: '/', element: <Origin /> },
        { path: '/login', element: <Door /> },
        { path: '/home', element: <main data-testid="home" /> },
      ],
      route: '/login',
    })
    await page.getByRole('button', { name: 'in' }).click()
    await expect.element(page.getByTestId('home')).toBeInTheDocument()
  })
})

// What a plugin keeps in this browser for the person signed in - an unsent
// review, say - has to go when they leave, not when the next person happens
// to open the screen that sweeps it. Signing in from nobody leaves nobody.
describe('leaving a signed-in identity', () => {
  const Leave = ({ label }: { label: string }) => {
    const transition = useSessionTransition()
    return (
      <button
        type="button"
        onClick={() => void transition({ destination: { kind: 'page', page: 'auth/login' } })}
      >
        {label}
      </button>
    )
  }
  const screen = (viewer: 'anonymous' | 'authenticated') =>
    renderScreen({
      client: fakeClient({
        app: {
          getManifest: () =>
            Effect.succeed({
              ...emptyManifest(),
              viewer,
              pages: [{ id: 'auth/login', path: '/login', layout: 'blank' }],
            }),
        },
      }),
      routes: [
        { path: '/home', element: <Leave label="leave" /> },
        { path: '/login', element: <main data-testid="landed" /> },
      ],
      route: '/home',
    })

  it('tells whoever kept something for the person who is leaving', async () => {
    let told = 0
    const stop = onSignOut(() => {
      told += 1
    })
    try {
      await screen('authenticated')
      await page.getByRole('button', { name: 'leave' }).click()
      await expect.element(page.getByTestId('landed')).toBeInTheDocument()
      expect(told).toBe(1)
    } finally {
      stop()
    }
  })

  it('tells nobody when nobody was signed in', async () => {
    let told = 0
    const stop = onSignOut(() => {
      told += 1
    })
    try {
      await screen('anonymous')
      await page.getByRole('button', { name: 'leave' }).click()
      await expect.element(page.getByTestId('landed')).toBeInTheDocument()
      expect(told).toBe(0)
    } finally {
      stop()
    }
  })
})

describe('a session that stops working while a page is open', () => {
  it('drops what the last identity was shown and asks the manifest again, once', async () => {
    let expired = false
    let manifests = 0
    const Secret = () => {
      const records = useQuery({
        queryKey: ['probe', 'records'],
        queryFn: () =>
          expired
            ? Promise.reject(apiError('SESSION_EXPIRED', undefined))
            : Promise.resolve('secret records'),
        retry: false,
      })
      const notes = useQuery({
        queryKey: ['probe', 'notes'],
        queryFn: () =>
          expired
            ? Promise.reject(apiError('SESSION_EXPIRED', undefined))
            : Promise.resolve('notes'),
        retry: false,
      })
      const manifest = useManifest()
      return (
        <main data-testid="secret" data-viewer={manifest.viewer}>
          <span data-testid="records">{records.data ?? ''}</span>
          <button
            type="button"
            onClick={() => {
              expired = true
              // two requests find out at once
              void records.refetch()
              void notes.refetch()
            }}
          >
            later
          </button>
        </main>
      )
    }
    await renderScreen({
      client: fakeClient({
        app: {
          getManifest: () =>
            Effect.sync(() => {
              manifests += 1
              return { ...emptyManifest(), viewer: expired ? 'anonymous' : 'authenticated' }
            }),
        },
      }),
      routes: [{ path: '/secret', element: <Secret /> }],
      route: '/secret',
    })
    await expect.element(page.getByTestId('records')).toHaveTextContent('secret records')
    const before = manifests
    await page.getByRole('button', { name: 'later' }).click()
    await expect.element(page.getByTestId('secret')).toHaveAttribute('data-viewer', 'anonymous')
    // nothing the last identity was shown is still on the screen
    expect(page.getByTestId('records').element().textContent).toBe('')
    // however many requests found out, the manifest was asked once
    await new Promise((settle) => setTimeout(settle, 300))
    expect(manifests - before).toBe(1)
  })

  it('leaves an anonymous visitor alone when a request says nobody is signed in', async () => {
    let manifests = 0
    let asked = 0
    const Visitor = () => {
      const session = useQuery({
        queryKey: ['probe', 'session'],
        queryFn: () => {
          asked += 1
          return Promise.reject(apiError('AUTH_REQUIRED', undefined))
        },
        retry: false,
        enabled: false,
      })
      return (
        <button type="button" onClick={() => void session.refetch()}>
          ask
        </button>
      )
    }
    await renderScreen({
      client: fakeClient({
        app: {
          getManifest: () =>
            Effect.sync(() => {
              manifests += 1
              return emptyManifest()
            }),
        },
      }),
      routes: [{ path: '/login', element: <Visitor /> }],
      route: '/login',
    })
    await expect.element(page.getByRole('button', { name: 'ask' })).toBeInTheDocument()
    const before = manifests
    await page.getByRole('button', { name: 'ask' }).click()
    await expect.poll(() => asked).toBe(1)
    await new Promise((settle) => setTimeout(settle, 300))
    // the answer is what an anonymous visitor is told: nothing to settle
    expect({ manifests: manifests - before, asked }).toEqual({ manifests: 0, asked: 1 })
  })
})

// A session that ends while its reader is at work - gone unused past the idle
// limit, ended from elsewhere - no longer takes the page with it. The call
// that found out waits; the reader signs in again in another tab and comes
// back; the same person signed in, the call is made again and the page
// carries on with what was typed still in it. Somebody else signed in, and
// the page can only start over.
describe('a session lost from under a signed-in reader', () => {
  const screen = async (whoComesBack: () => string | undefined) => {
    let attempts = 0
    const Draft = () => {
      const run = useRunApi()
      const [saved, setSaved] = useState('')
      return (
        <main>
          <input aria-label="draft" data-testid="draft" defaultValue="" />
          <button
            type="button"
            onClick={() =>
              void run(
                Effect.suspend(() => {
                  attempts += 1
                  return attempts === 1
                    ? Effect.fail(apiError('SESSION_EXPIRED'))
                    : Effect.succeed('saved')
                }),
              ).then(setSaved, () => setSaved('failed'))
            }
          >
            save
          </button>
          <output data-testid="saved">{saved}</output>
        </main>
      )
    }
    let signedIn = true
    await renderScreen({
      client: fakeClient({
        app: {
          getManifest: () =>
            Effect.sync(() => {
              const who = signedIn ? 'reader' : whoComesBack()
              return who === undefined
                ? emptyManifest()
                : { ...emptyManifest(), viewer: 'authenticated', identity: who }
            }),
        },
      }),
      routes: [{ path: '/draft', element: <Draft /> }],
      route: '/draft',
    })
    await page.getByRole('textbox', { name: 'draft' }).fill('half a sentence')
    signedIn = false
    await page.getByRole('button', { name: 'save' }).click()
    return { attempts: () => attempts }
  }

  it('holds the call, and makes it again once the same person is back', async () => {
    let back = false
    const { attempts } = await screen(() => (back ? 'reader' : undefined))
    await expect.element(page.getByRole('dialog')).toBeVisible()
    expect(attempts()).toBe(1)
    back = true
    // coming back to the tab is when the page asks
    window.dispatchEvent(new Event('focus'))
    await expect.element(page.getByTestId('saved')).toHaveTextContent('saved')
    expect(attempts()).toBe(2)
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
    await expect
      .element(page.getByRole('textbox', { name: 'draft' }))
      .toHaveValue('half a sentence')
  })

  it('never makes the call as somebody else, and offers only a reload', async () => {
    let back = false
    const { attempts } = await screen(() => (back ? 'someone-else' : undefined))
    await expect.element(page.getByRole('dialog')).toBeVisible()
    back = true
    window.dispatchEvent(new Event('focus'))
    await expect
      .element(page.getByTestId('session-recovery'))
      .toHaveAttribute('data-state', 'switched')
    // nothing there carries on as the other account
    expect(page.getByTestId('session-sign-in').elements()).toHaveLength(0)
    await expect.element(page.getByTestId('session-reload')).toBeVisible()
    await new Promise((settle) => setTimeout(settle, 300))
    expect(attempts()).toBe(1)
    expect(page.getByTestId('saved').element().textContent).toBe('')
  })

  it('offers a link to follow when the browser blocks the tab, and then waits', async () => {
    const blocked = vi.spyOn(window, 'open').mockReturnValue(null)
    try {
      await screen(() => undefined)
      const lock = page.getByTestId('session-recovery')
      await expect.element(lock).toHaveAttribute('data-state', 'expired')
      await page.getByTestId('session-sign-in').click()
      expect(blocked).toHaveBeenCalledOnce()
      await expect.element(lock).toHaveAttribute('data-state', 'blocked')
      const link = page.getByTestId('session-sign-in')
      await expect.element(link).toHaveAttribute('target', '_blank')
      await expect.element(link).toHaveAttribute('href')
      // followed, but kept in this test's own tab
      link.element().addEventListener('click', (event) => event.preventDefault())
      await link.click()
      await expect.element(lock).toHaveAttribute('data-state', 'waiting')
    } finally {
      blocked.mockRestore()
    }
  })

  it('fails the call as refused when the reader signs out instead', async () => {
    const { attempts } = await screen(() => undefined)
    await expect.element(page.getByRole('dialog')).toBeVisible()
    await page.getByTestId('session-sign-out').click()
    await expect.element(page.getByTestId('saved')).toHaveTextContent('failed')
    expect(attempts()).toBe(1)
  })
})

// The way it went wrong: the reader comes back to a tab left open, and the
// page asks everything again at once. The manifest never refuses - it answered
// as nobody - and the page's own read was refused. The anonymous manifest used
// to reach the routes first, so the page gave way to the sign-in page while
// the recovery, holding the refused read, asked the reader to sign in over it.
describe('a signed-in page asked again after its session went', () => {
  afterEach(() => vi.restoreAllMocks())

  it('stays the reader\u2019s, locked, and carries on once they are back', async () => {
    let signedIn = true
    let reads = 0
    // a tab opened: the page cuts it loose, and asks nothing more of it
    const tab = { opener: window } as unknown as Window
    const opened = vi.spyOn(window, 'open').mockReturnValue(tab)
    const Work = () => {
      const run = useRunApi()
      const client = useQueryClient()
      const manifest = useManifest()
      const read = useQuery({
        queryKey: ['probe', 'work'],
        queryFn: () =>
          run(
            Effect.suspend(() => {
              reads += 1
              return signedIn || reads > 2
                ? Effect.succeed(`answer ${String(reads)}`)
                : Effect.fail(apiError('SESSION_EXPIRED'))
            }),
          ),
      })
      return (
        <main>
          <input aria-label="draft" data-testid="draft" defaultValue="" />
          <output data-testid="viewer">{manifest.viewer}</output>
          <output data-testid="read">{read.data ?? ''}</output>
          {/* what coming back to the tab does: everything asked again at once */}
          <button type="button" onClick={() => void client.refetchQueries()}>
            back
          </button>
        </main>
      )
    }
    await renderScreen({
      client: fakeClient({
        app: {
          getManifest: () =>
            Effect.sync(() =>
              signedIn
                ? { ...emptyManifest(), viewer: 'authenticated' as const, identity: 'reader' }
                : emptyManifest(),
            ),
        },
      }),
      routes: [{ path: '/work', element: <Work /> }],
      route: '/work',
    })
    await expect.element(page.getByTestId('read')).toHaveTextContent('answer 1')
    await page.getByRole('textbox', { name: 'draft' }).fill('half a sentence')

    // the session goes while the reader is away, and they come back
    signedIn = false
    await page.getByRole('button', { name: 'back' }).click()
    const lost = page.getByTestId('session-recovery')
    await expect.element(lost).toHaveAttribute('data-state', 'expired')
    // the page is still the reader's, where it was, with what they typed -
    // locked under the dialog, so found by its hook rather than its role
    await expect.element(page.getByTestId('address')).toHaveTextContent('/work')
    await expect.element(page.getByTestId('viewer')).toHaveTextContent('authenticated')
    await expect.element(page.getByTestId('draft')).toHaveValue('half a sentence')

    // signing in is opened elsewhere; coming back before it is done shows the
    // same wait, not the first question again
    await page.getByTestId('session-sign-in').click()
    expect(opened).toHaveBeenCalledOnce()
    expect(tab.opener).toBeNull()
    await expect.element(lost).toHaveAttribute('data-state', 'waiting')
    window.dispatchEvent(new Event('focus'))
    await new Promise((settle) => setTimeout(settle, 200))
    expect(page.getByTestId('session-recovery').elements()).toHaveLength(1)
    await expect.element(lost).toHaveAttribute('data-state', 'waiting')

    // the reader is back: the page carries on where it was
    signedIn = true
    window.dispatchEvent(new Event('focus'))
    await expect.element(page.getByTestId('session-recovery')).not.toBeInTheDocument()
    // the refused read, made once more and only once
    await expect.element(page.getByTestId('read')).toHaveTextContent('answer 3')
    expect(reads).toBe(3)
    await expect.element(page.getByTestId('viewer')).toHaveTextContent('authenticated')
    await expect.element(page.getByTestId('address')).toHaveTextContent('/work')
    await expect
      .element(page.getByRole('textbox', { name: 'draft' }))
      .toHaveValue('half a sentence')
  })
})

// Somebody else signed in, with nothing waiting: signed out and in again in
// another tab, and this page never saw the session go. The server authorizes
// each call as whoever is signed in now; it cannot know that this page was
// loaded and filled in for the reader before. So the page is theirs no longer
// and cannot become the new account's: locked, it keeps what it had, sends
// nothing more, and offers only a reload.
describe('a signed-in page that finds somebody else signed in', () => {
  const screen = async () => {
    let who = 'reader'
    const counted = { reads: 0, saves: 0 }
    const moves: { refetch?: () => void; save?: () => void } = {}
    const Work = () => {
      const run = useRunApi()
      const client = useQueryClient()
      const manifest = useManifest()
      const read = useQuery({
        queryKey: ['probe', 'work'],
        queryFn: () =>
          run(
            Effect.sync(() => {
              counted.reads += 1
              return `answer ${String(counted.reads)}`
            }),
          ),
      })
      moves.refetch = () => void client.refetchQueries()
      moves.save = () =>
        void run(
          Effect.sync(() => {
            counted.saves += 1
          }),
        )
      return (
        <main>
          <input aria-label="draft" data-testid="draft" defaultValue="" />
          <output data-testid="identity">
            {manifest.viewer === 'authenticated' ? manifest.identity : ''}
          </output>
          <output data-testid="read">{read.data ?? ''}</output>
        </main>
      )
    }
    await renderScreen({
      client: fakeClient({
        app: {
          getManifest: () =>
            Effect.sync(() => ({
              ...emptyManifest(),
              viewer: 'authenticated' as const,
              identity: who,
            })),
        },
      }),
      routes: [{ path: '/work', element: <Work /> }],
      route: '/work',
    })
    await expect.element(page.getByTestId('read')).toHaveTextContent('answer 1')
    await page.getByRole('textbox', { name: 'draft' }).fill('half a sentence')
    return {
      signInElsewhere: () => {
        who = 'someone-else'
      },
      counted,
      moves,
    }
  }

  const locked = async () => {
    const lock = page.getByTestId('session-recovery')
    await expect.element(lock).toHaveAttribute('data-state', 'switched')
    expect(page.getByTestId('session-sign-in').elements()).toHaveLength(0)
    await expect.element(page.getByTestId('session-reload')).toBeVisible()
    // still the reader's page, under its own manifest
    await expect.element(page.getByTestId('identity')).toHaveTextContent('reader')
    await expect.element(page.getByTestId('address')).toHaveTextContent('/work')
  }

  it('locks when coming back to it, and sends nothing more', async () => {
    const { signInElsewhere, counted, moves } = await screen()
    signInElsewhere()
    // coming back to the tab: everything asked again at once
    moves.refetch?.()
    await locked()
    const before = { ...counted }
    moves.refetch?.()
    moves.save?.()
    await new Promise((settle) => setTimeout(settle, 300))
    expect(counted).toEqual(before)
  })

  it('asks who is signed in as soon as another tab says it signed in or out', async () => {
    const { signInElsewhere } = await screen()
    signInElsewhere()
    const elsewhere = new BroadcastChannel('qualy:session')
    try {
      elsewhere.postMessage({ type: 'changed' })
      await locked()
    } finally {
      elsewhere.close()
    }
  })
})

describe('the manifest, asked again in the background', () => {
  it('keeps the page standing when the ask fails', async () => {
    let failing = false
    let refused = 0
    const Standing = () => {
      const client = useQueryClient()
      return (
        <main data-testid="standing">
          <button
            type="button"
            onClick={() => {
              // the connection drops while the reader is away; coming back asks again
              failing = true
              void client.refetchQueries()
            }}
          >
            back
          </button>
        </main>
      )
    }
    await renderScreen({
      client: fakeClient({
        app: {
          getManifest: () =>
            failing
              ? Effect.suspend(() => {
                  refused += 1
                  return Effect.fail(apiError('INTERNAL_SERVER_ERROR', undefined))
                })
              : Effect.succeed({ ...emptyManifest(), viewer: 'authenticated' as const }),
        },
      }),
      routes: [{ path: '/standing', element: <Standing /> }],
      route: '/standing',
    })
    await page.getByRole('button', { name: 'back' }).click()
    // the ask was made, and refused
    await expect.poll(() => refused).toBeGreaterThan(0)
    await new Promise((settle) => setTimeout(settle, 300))
    await expect.element(page.getByTestId('standing')).toBeInTheDocument()
    expect(page.getByRole('alert').elements()).toHaveLength(0)
  })
})
