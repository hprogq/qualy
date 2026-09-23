import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { useEffect } from 'react'
import { Navigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Effect } from 'effect'
import { useManifest, useSessionTransition } from '@qualy/web-runtime'
import { emptyManifest, fakeClient, renderScreen } from './support/harness.tsx'

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
    renderScreen({
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
    renderScreen({
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

