import { afterEach, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { UiProvider } from '@qualy/ui/provider'
import {
  emptyComponentRegistry,
  PluginSurface,
  RuntimeProvider,
  type Manifest,
} from '@qualy/web-runtime'
import type { SlotSurface } from '@qualy/ui-contract'
import type { LoadSlotReference } from '@qualy/web-runtime/slot-reference'

afterEach(() => {
  delete document.documentElement.dataset['locale']
})

it('keeps a delivered chrome reference while the next route hands over its own references', async () => {
  document.documentElement.dataset['locale'] = 'en-US'
  const surface: SlotSurface = { kind: 'slot', slot: 'probe/context', id: 'probe/context' }
  const manifest: Manifest = {
    viewer: 'authenticated',
    identity: 'probe-reader',
    layouts: [],
    pages: [],
    slots: { [surface.slot]: [{ id: surface.id, order: 0 }] },
    collections: {},
    context: {},
  }
  const ContextBar = () => <a href="/batches">All assessments</a>
  const loadSlotReference = vi.fn<LoadSlotReference>(() => new Promise(() => {}))
  const draw = (delivered: boolean) => (
    <UiProvider scheme="light">
      <RuntimeProvider
        manifest={manifest}
        loadSlotReference={loadSlotReference}
        registry={{
          ...emptyComponentRegistry(),
          slots: delivered ? { [surface.slot]: { [surface.id]: ContextBar } } : {},
        }}
      >
        <PluginSurface
          surface={surface}
          loading={<p>Loading context</p>}
          missing={null}
          fallback={() => null}
        />
      </RuntimeProvider>
    </UiProvider>
  )
  const screen = await render(draw(true))
  const link = page.getByRole('link', { name: 'All assessments' })
  const original = link.element()
  await screen.rerender(draw(false))
  expect(link.element()).toBe(original)
  expect(page.getByText('Loading context').elements()).toHaveLength(0)
  expect(loadSlotReference).not.toHaveBeenCalled()
})

it('drops a fetched reference when the document adopts a projection that withdraws it', async () => {
  document.documentElement.dataset['locale'] = 'en-US'
  const surface: SlotSurface = { kind: 'slot', slot: 'probe/picker', id: 'probe/picker' }
  const registry = emptyComponentRegistry()
  const revoked: Manifest = {
    viewer: 'authenticated',
    identity: 'probe-reader',
    layouts: [],
    pages: [],
    slots: {},
    collections: {},
    context: {},
  }
  const allowed: Manifest = {
    ...revoked,
    slots: { [surface.slot]: [{ id: surface.id, order: 0 }] },
  }
  const load: LoadSlotReference = async () => ({
    kind: 'found',
    component: () => <button type="button">Open picker</button>,
  })
  const loadSlotReference = vi.fn(load)
  const rendered = (manifest: Manifest) => (
    <UiProvider scheme="light">
      <RuntimeProvider
        registry={registry}
        manifest={manifest}
        loadSlotReference={loadSlotReference}
      >
        <PluginSurface
          surface={surface}
          loading={<p>Loading picker</p>}
          missing={<p>Picker unavailable</p>}
          fallback={() => <p>Picker failed</p>}
        />
      </RuntimeProvider>
    </UiProvider>
  )
  const screen = await render(rendered(allowed))
  const picker = page.getByRole('button', { name: 'Open picker' })
  await expect.element(picker).toBeVisible()
  expect(loadSlotReference).toHaveBeenCalledTimes(1)

  await screen.rerender(rendered(revoked))
  await expect.element(page.getByText('Picker unavailable')).toBeVisible()
  await expect.element(picker).not.toBeInTheDocument()
  expect(loadSlotReference).toHaveBeenCalledTimes(1)

  await screen.rerender(rendered(allowed))
  await expect.element(picker).toBeVisible()
  expect(loadSlotReference).toHaveBeenCalledTimes(2)
})
