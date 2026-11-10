import { lazy, useState } from 'react'
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { defineUiSlot } from '@qualy/ui-contract'
import { UiSlot } from '@qualy/web-runtime'
import { emptyManifest, fakeClient, renderScreen } from './support/harness.tsx'

// Slots are the extension seam: a plugin drops a component into somebody
// else's layout. Whether that component keeps its identity across a re-render
// is not cosmetic - React reconciles by TYPE, so a slot host that builds a
// fresh wrapper component on every render unmounts every contribution and
// mounts a new one. Everything the user had typed disappears and every query
// the component owns refetches, for a locale switch or a manifest refresh.

declare module '@qualy/ui-contract' {
  interface UiSlotContextTypes {
    'test/slot': string
  }
}
const TOKEN = defineUiSlot({ key: 'test/slot', cardinality: 'one' })

const invalidSlots = () => {
  // @ts-expect-error This token's context is required.
  const missing = <UiSlot token={TOKEN} />
  // @ts-expect-error A differently shaped context does not widen the token.
  const wrong = <UiSlot token={TOKEN} context={{ navigationId: 'other' }} />
  return [missing, wrong]
}
void invalidSlots

function Counter({ context }: { context: string }) {
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
    await renderScreen({
      client: fakeClient({
        app: { getManifest: { ...emptyManifest(), slots: { 'test/slot': [contribution] } } },
      }),
      // the registry holds what the aggregate puts there, under the slot
      // and the item's id: lazy components
      registry: {
        slots: { 'test/slot': { 'test/counter': lazy(async () => ({ default: Counter })) } },
      },
      children: <Host />,
    })

    await page.getByRole('button', { name: 'first clicked 0' }).click()
    await expect.element(page.getByRole('button', { name: 'first clicked 1' })).toBeVisible()

    // the props change, the component type does not
    await page.getByRole('button', { name: 'change the context' }).click()
    await expect.element(page.getByRole('button', { name: 'second clicked 1' })).toBeVisible()
  })
})

const contribution = { id: 'test/counter', order: 0 }
