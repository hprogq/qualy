import { describe, expect, it } from 'vitest'
import { renderedFetch } from '../src/routing/rendered-fetch.ts'
import { RenderNetworkError } from '../src/routing/render-network-error.ts'

const transport = (fetch: typeof globalThis.fetch) =>
  renderedFetch({
    identity: { releaseId: 'test', clientProtocol: 5 },
    locale: 'en-US',
    onClientUnsupported: () => {},
    fetch,
  })

describe('render transport failures', () => {
  it('marks only failures from the network boundary', async () => {
    const error = new TypeError('connection lost')
    const send = transport(() => Promise.reject(error))
    await expect(send(new Request('http://localhost/page.rsc'))).rejects.toMatchObject({
      name: 'RenderNetworkError',
      cause: error,
    })
    const response = new Response('unavailable', { status: 503 })
    expect(
      await transport(() => Promise.resolve(response))(new Request('http://localhost/page.rsc')),
    ).toBe(response)
  })

  it('keeps an aborted navigation cancelled instead of presenting it as a network failure', async () => {
    const abort = new AbortController()
    const error = new DOMException('cancelled', 'AbortError')
    abort.abort(error)
    const promise = transport(() => Promise.reject(error))(
      new Request('http://localhost/page.rsc', { signal: abort.signal }),
    )
    await expect(promise).rejects.toBe(error)
    expect(error).not.toBeInstanceOf(RenderNetworkError)
  })
})
