import { useState } from 'react'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { useLiveChannel, useSessionTransition } from '@qualy/web-runtime'
import { fakeLiveServer, type FakeLiveSocket } from '@qualy/testkit/browser'
import { emptyManifest, fakeClient, renderScreen } from './support/harness.tsx'

// A tab's live channels as screens hold them, in a real browser under the
// strictness the app runs with: how many sockets a page opens for how many
// screens, what a remount does, and what becomes of a connection when the
// person signed in changes or the server says their session is gone.

const PATH = '/api/assessment/batches/b1/events'
const timing = { grace: 150 } as const

const welcoming = (socket: FakeLiveSocket) => {
  socket.accept()
  socket.send('sync')
}

/** who the manifest says is signed in, changeable mid-test */
const signedIn = () => {
  const who = { current: 'u1' as string | null, asked: 0 }
  const client = fakeClient({
    app: {
      getManifest: () =>
        Effect.sync(() => {
          who.asked += 1
          return who.current === null
            ? emptyManifest()
            : { ...emptyManifest(), viewer: 'authenticated' as const, identity: who.current }
        }),
    },
  })
  return { who, client }
}

function Screen({ name }: { name: string }) {
  const line = useLiveChannel(PATH, () => undefined)
  return <p data-testid={name} data-live={String(line.live)} />
}

function Page() {
  const [second, setSecond] = useState(true)
  const [first, setFirst] = useState(true)
  const transition = useSessionTransition()
  return (
    <>
      {first && <Screen name="first" />}
      {second && <Screen name="second" />}
      <button onClick={() => setFirst(false)}>close first</button>
      <button onClick={() => setSecond(false)}>close second</button>
      <button onClick={() => void transition({ destination: { kind: 'home' } })}>sign out</button>
    </>
  )
}

describe('the live channels of a tab', () => {
  it('opens one connection for two screens of a batch, a strict-mode remount included', async () => {
    const live = fakeLiveServer(welcoming)
    const { client } = signedIn()
    await renderScreen({ client, live, liveTiming: timing, children: <Page /> })
    await expect.element(page.getByTestId('first')).toHaveAttribute('data-live', 'true')
    await expect.element(page.getByTestId('second')).toHaveAttribute('data-live', 'true')
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(live.sockets).toHaveLength(1)
    expect(live.open()).toHaveLength(1)

    // the last screen to let go takes the connection with it, after the grace
    await page.getByRole('button', { name: 'close first' }).click()
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(live.open()).toHaveLength(1)
    await page.getByRole('button', { name: 'close second' }).click()
    await expect.poll(() => live.open().length).toBe(0)
    expect(live.sockets[0]!.closedWith).toBe(1000)
  })

  it('lets the last person’s connection go the moment somebody else is signed in', async () => {
    const live = fakeLiveServer(welcoming)
    const { who, client } = signedIn()
    // a grace far longer than the test: what closes it is the change of person
    await renderScreen({ client, live, liveTiming: { grace: 60_000 }, children: <Page /> })
    await expect.element(page.getByTestId('first')).toHaveAttribute('data-live', 'true')
    const theirs = live.sockets.length
    who.current = null
    await page.getByRole('button', { name: 'sign out' }).click()
    await expect.poll(() => live.sockets[0]!.closedWith, { timeout: 2_000 }).toBe(1000)
    // every connection the last person held is gone; the screens are still
    // mounted here, so a visitor's connection may open after them, which is
    // the visitor's own and not the one that had to go
    expect(live.open().filter((socket) => live.sockets.indexOf(socket) < theirs)).toHaveLength(0)
  })

  it('takes a connection closed for want of a session as a session lost, and asks who is signed in', async () => {
    // the session ends a while after the page is up, so what the page asked
    // before it is counted first
    const live = fakeLiveServer((socket) => {
      socket.accept()
      setTimeout(() => socket.close(4401, 'unauthenticated'), 500)
    })
    const { who, client } = signedIn()
    await renderScreen({ client, live, liveTiming: timing, children: <Page /> })
    await expect.poll(() => live.sockets.length).toBe(1)
    const before = who.asked
    expect(live.sockets[0]!.closedWith).toBeUndefined()
    who.current = null
    await expect.poll(() => who.asked, { timeout: 3_000 }).toBeGreaterThan(before)
    await new Promise((resolve) => setTimeout(resolve, 300))
    // and it does not dial into the same refusal again
    expect(live.sockets).toHaveLength(1)
  })
})
