import { slotReferenceHref } from '@qualy/ui-contract'
import type { LoadSlotReference, SlotReference } from '@qualy/web-runtime/slot-reference'
import { renderedFetch } from '@qualy/web-runtime/rendered-fetch'
import { releases, webRelease } from '../release.ts'

export const browserSlotLoader = (locale: string): LoadSlotReference => {
  const send = renderedFetch({
    identity: webRelease,
    locale,
    holdRefusals: false,
    onClientUnsupported: (reason) => releases.notifyClientUnsupported(reason),
  })
  return async (surface, signal) => {
    const href = new URL(slotReferenceHref(surface), window.location.origin)
    const response = await send(new Request(href, { signal }))
    if (response.status === 404) return { kind: 'denied' }
    if (response.status === 409) return { kind: 'missing' }
    if (!response.ok || response.body === null) throw new Error('Could not load a slot reference')
    const { createFromReadableStream } = await import('@vitejs/plugin-rsc/browser')
    const { component } = await createFromReadableStream<
      Pick<Extract<SlotReference, { kind: 'found' }>, 'component'>
    >(response.body)
    return { kind: 'found', component }
  }
}
