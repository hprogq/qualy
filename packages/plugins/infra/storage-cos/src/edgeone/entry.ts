import { createDelivery, type DeliveryEnvironment } from './delivery.ts'

// The edge function's own entry: the platform's globals wired to the
// delivery. Bundled with everything it imports into one classic script
// (./bundle.ts); nothing here runs in this repository's processes.

/** the function's settings, as the platform exposes them: a global, not a parameter */
declare const env: DeliveryEnvironment | undefined

interface FetchEvent {
  readonly request: Request
  respondWith(response: Promise<Response>): void
}
declare function addEventListener(type: 'fetch', listener: (event: FetchEvent) => void): void

const delivery = createDelivery({
  env: () => (typeof env === 'object' && env !== null ? env : {}),
  fetch: (input, init) => fetch(input, init),
  now: () => Math.floor(Date.now() / 1000),
})

addEventListener('fetch', (event) => {
  // only what happens before a response exists is caught here; a body that
  // fails while it streams ends the download
  event.respondWith(
    delivery(event.request).catch(
      () =>
        new Response(null, {
          status: 502,
          headers: { 'cache-control': 'no-store', 'x-qualy-reason': 'unexpected' },
        }),
    ),
  )
})
