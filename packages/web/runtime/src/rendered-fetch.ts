import { QUALY_IDENTITY_HEADER, QUALY_LOCALE_HEADER } from '@qualy/api-kit'
import {
  QUALY_CLIENT_PROTOCOL_HEADER,
  QUALY_CLIENT_RELEASE_HEADER,
  QUALY_RENDER_REFUSED_HEADER,
  isRenderRefusal,
  type ClientUnsupportedReason,
} from '@qualy/release-contract'
import type { ClientIdentity } from './api.ts'
import { documentIdentity } from './document-identity.ts'
import { recovering } from './session-recovery.ts'

// How an open page asks the server to render a navigation
// (docs/adr/0012-rsc-data-mode.md, docs/adr/0013-document-identity.md).
//
// The same things every api request of the page says - its build, its
// protocol, its language, whose it is - so the server can refuse before it
// renders anything this page could not use or should not see. A refusal is
// read here, before the router: handed a 409, the router would take it for a
// failed route and put an error boundary where the page was, and with it
// whatever the reader had typed. So the page stays exactly as it is, and the
// navigation waits:
//
// - for a session that went, the session's recovery asks the reader to sign
//   in again and, once the same person is back, the navigation is asked again;
// - for somebody else's session, the page locks, as for any other sign-in;
// - for a build or a protocol the server will not render for, the release
//   protocol asks the reader to reload.
//
// A navigation that waits is not left waiting forever: the router cancels it
// when the reader goes somewhere else, and the wait ends with it.

/**
 * The refusals the session's recovery already answered as it saw them: the
 * page locked, or asked to reload, or the reader declined to sign back in.
 */
const HELD = new Set<unknown>(['IDENTITY_CHANGED', 'IDENTITY_UNASSERTED', 'SESSION_EXPIRED'])

/** the refusal, in the shape a lost session takes everywhere else in the page */
const refusalAs = (tag: string) => Object.assign(new Error(tag), { _tag: tag })

/** waits for the router to give up on the navigation, then ends as cancelled */
const heldUntilCancelled = (signal: AbortSignal): Promise<never> =>
  new Promise<never>((_resolve, reject) => {
    const cancelled = () =>
      reject(signal.reason ?? new DOMException('navigation cancelled', 'AbortError'))
    if (signal.aborted) return cancelled()
    signal.addEventListener('abort', cancelled, { once: true })
  })

export const renderedFetch =
  (options: {
    /** who the page is, as its api requests say */
    readonly identity: ClientIdentity
    /** the page's fixed language */
    readonly locale: string
    /** the release protocol's: this page has to reload */
    readonly onClientUnsupported: (reason: ClientUnsupportedReason) => void
    /** the network; the page's own unless a harness brings one */
    readonly fetch?: typeof globalThis.fetch
  }) =>
  async (request: Request): Promise<Response> => {
    const send = options.fetch ?? globalThis.fetch
    const ask = async (): Promise<Response> => {
      const headers = new Headers(request.headers)
      headers.set(QUALY_CLIENT_RELEASE_HEADER, options.identity.releaseId)
      headers.set(QUALY_CLIENT_PROTOCOL_HEADER, String(options.identity.clientProtocol))
      headers.set(QUALY_LOCALE_HEADER, options.locale)
      const identity = documentIdentity()
      if (identity !== undefined) headers.set(QUALY_IDENTITY_HEADER, identity)
      const response = await send(new Request(request, { headers }))
      const refusal = response.headers.get(QUALY_RENDER_REFUSED_HEADER)
      if (!isRenderRefusal(refusal)) return response
      // the body says nothing the marker did not; it is let go unread
      void response.body?.cancel()
      if (refusal === 'session') throw refusalAs('SESSION_EXPIRED')
      if (refusal === 'identity-changed') throw refusalAs('IDENTITY_CHANGED')
      if (refusal === 'unasserted') throw refusalAs('IDENTITY_UNASSERTED')
      throw Object.assign(refusalAs('RENDER_REFUSED'), { reason: refusal })
    }
    try {
      // a session that went is waited out and the navigation asked again;
      // somebody else's session locks the page (session-recovery.ts)
      return await recovering(ask, request.signal)
    } catch (error) {
      if (request.signal.aborted) throw error
      const tag = (error as { _tag?: unknown })._tag
      if (tag === 'RENDER_REFUSED') {
        const reason = (error as { reason?: string }).reason
        options.onClientUnsupported(reason === 'protocol' ? 'protocol' : 'release')
      } else if (!HELD.has(tag)) throw error
      // the page stays as it is; the navigation ends when the router lets it go
      return heldUntilCancelled(request.signal)
    }
  }
