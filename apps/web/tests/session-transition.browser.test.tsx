import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { useEffect } from 'react'
import { Navigate } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Effect } from 'effect'
import { useManifest, useSessionTransition } from '@qualy/web-runtime'
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
