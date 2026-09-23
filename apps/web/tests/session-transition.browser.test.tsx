import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Effect } from 'effect'
import { useSessionTransition } from '@qualy/web-runtime'
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
})
