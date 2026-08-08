import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { UiSlot } from '@qualy/web-runtime'
import { emptyManifest, fakeClient, renderScreen } from './support/harness.tsx'

// Slots are the extension seam: a plugin drops a component into somebody
// else's layout. Whether that component keeps its identity across a re-render
// is not cosmetic - React reconciles by TYPE, so a slot host that builds a
// fresh wrapper component on every render unmounts every contribution and
// mounts a new one. Everything the user had typed disappears and every query
// the component owns refetches, for a locale switch or a manifest refresh.

const TOKEN = { key: 'test/slot' } as unknown as Parameters<typeof UiSlot>[0]['token']

function Counter({ context }: { context?: unknown }) {
  const [clicks, setClicks] = useState(0)
  return (
    <button type="button" onClick={() => setClicks((count) => count + 1)}>
      {`${String(context)} clicked ${clicks}`}
    </button>
  )
}

function Host() {
  const [context, setContext] = useState('first')
  return (
    <>
      <button type="button" onClick={() => setContext('second')}>
        change the context
      </button>
      <UiSlot token={TOKEN} context={context} />
    </>
  )
}

describe('a slot contribution', () => {
  it('keeps its state when the slot re-renders with a new context', async () => {
    renderScreen({
      client: fakeClient({
        app: { getManifest: { ...emptyManifest(), slots: { 'test/slot': [contribution] } } },
      }),
      registry: { 'test/Counter': Counter },
      children: <Host />,
    })

    await page.getByRole('button', { name: 'first clicked 0' }).click()
    await expect.element(page.getByRole('button', { name: 'first clicked 1' })).toBeVisible()

    // the props change, the component type does not
    await page.getByRole('button', { name: 'change the context' }).click()
    await expect.element(page.getByRole('button', { name: 'second clicked 1' })).toBeVisible()
  })
})

const contribution = { id: 'test/counter', component: 'test/Counter', order: 0 }
