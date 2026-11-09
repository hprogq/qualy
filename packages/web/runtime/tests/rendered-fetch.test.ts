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
    const response = new Response('Flight error', {
      status: 503,
      headers: { 'content-type': 'text/x-component' },
    })
    expect(
      await transport(() => Promise.resolve(response))(new Request('http://localhost/page.rsc')),
    ).toBe(response)
  })

  it('carries an HTTP render failure reference without decoding the proxy body', async () => {
    const request = new Request('http://localhost/page.rsc')
    const requestId = '2493330c-c85b-488c-a533-a95008204f42'
    const response = new Response('private proxy body', {
      status: 503,
      headers: { 'x-qualy-request-id': requestId, 'content-type': 'text/html' },
    })
    await expect(transport(() => Promise.resolve(response))(request)).rejects.toMatchObject({
      name: 'RenderResponseError',
      status: 503,
      requestId,
    })
    expect(response.bodyUsed).toBe(true)
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

describe('navigation after rollback to a host without Flight', () => {
  const identity = { releaseId: 'rendered', clientProtocol: 5 }
  const old = { schema: 2 as const, releaseId: 'page-rendered' }
  const request = 'http://localhost/settings.rsc'

  it('requests a manual reload and keeps the current screen until navigation is cancelled', async () => {
    const controller = new AbortController()
    const response = new Response('Not found', { status: 404 })
    let notify!: (notice: unknown) => void
    const held = new Promise((resolve) => {
      notify = resolve
    })
    const send = renderedFetch({
      identity,
      locale: 'en-US',
      fetch: async () => response,
      onClientUnsupported: () => {
        throw new Error('The old server did not send an explicit refusal')
      },
      release: {
        async check(options) {
          expect(options?.force).toBe(true)
          return old
        },
        requireReload(reason, latest) {
          notify({ reason, latest })
        },
      },
    })
    const navigation = send(new Request(request, { signal: controller.signal }))
    await expect(Promise.race([held, navigation])).resolves.toEqual({
      reason: 'release-skew',
      latest: old,
    })
    expect(response.bodyUsed).toBe(true)
    controller.abort()
    await expect(navigation).rejects.toMatchObject({ name: 'AbortError' })
  })

  it.each([undefined, { schema: 2 as const, releaseId: identity.releaseId }])(
    'leaves a normal 404 alone without proof of a release change (%j)',
    async (probe) => {
      const response = new Response(null, { status: 404 })
      const send = renderedFetch({
        identity,
        locale: 'en-US',
        fetch: async () => response,
        onClientUnsupported: () => {},
        release: {
          check: async () => probe,
          requireReload: () => {
            throw new Error('No release change was verified')
          },
        },
      })
      await expect(send(new Request(request))).resolves.toBe(response)
    },
  )

  it('does not probe a structured router error', async () => {
    const response = new Response('Flight not found', {
      status: 404,
      headers: { 'content-type': 'text/x-component; charset=utf-8' },
    })
    const send = renderedFetch({
      identity,
      locale: 'en-US',
      fetch: async () => response,
      onClientUnsupported: () => {},
      release: {
        check: () => {
          throw new Error('A real Flight response must go straight to the router')
        },
        requireReload: () => {},
      },
    })
    await expect(send(new Request(request))).resolves.toBe(response)
  })
})
