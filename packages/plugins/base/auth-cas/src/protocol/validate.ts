import { Effect } from 'effect'
import { AuthOutbound, type OutboundRequest } from '@qualy/auth-contract/outbound'
import { MAX_RESPONSE_BYTES, readAnswer, type CasAnswer, type CasPrincipal } from './response.ts'
import type { CasIdentity, CasSettings } from './settings.ts'

// The two addresses a CAS sign-in is made of, and the one question asked of
// the server in between.
//
// The service is the address the server is told to send the person back to,
// with the flow's state on it. It is written once, when the flow starts, and
// kept in the flow; validation sends back that same string, never one rebuilt
// from its parts, because a server compares the two as it received them.

/** where the server sends the person back to: the callback, carrying the flow */
export const serviceFor = (callback: URL, state: string): string => {
  const url = new URL(callback)
  url.search = ''
  url.searchParams.set('flow', state)
  return url.toString()
}

/** the server's login page, told where to send the person back to */
export const loginRedirect = (settings: CasSettings, service: string): string => {
  const url = new URL(settings.loginUrl)
  url.searchParams.set('service', service)
  if (settings.renew) url.searchParams.set('renew', 'true')
  return url.toString()
}

/**
 * A service ticket, and only that.
 *
 * `ST-` is the prefix the protocol reserves for one: a proxy ticket (`PT-`)
 * presented at the callback is a proxy's credential, not the person's, and a
 * validation endpoint such as /proxyValidate would accept it.
 */
export const isServiceTicket = (ticket: string) => /^ST-[\x21-\x7e]{1,256}$/.test(ticket)

const ACCEPT: Record<CasSettings['responseFormat'], string> = {
  auto: 'application/xml, text/xml;q=0.9, application/json;q=0.8, text/plain;q=0.5',
  xml: 'application/xml, text/xml;q=0.9',
  json: 'application/json',
  text: 'text/plain',
}

/** the validation request, as the entrance says to make it */
export const validationRequest = (
  settings: CasSettings,
  service: string,
  ticket: string,
): OutboundRequest => {
  const url = new URL(settings.validateUrl)
  // JSON is asked for only when it is what the entrance was told to expect:
  // most servers do not implement it and answer in XML regardless
  if (settings.responseFormat === 'json') url.searchParams.set('format', 'JSON')
  const headers = { accept: ACCEPT[settings.responseFormat] }
  if (settings.validateMethod === 'POST') {
    return {
      url: url.toString(),
      method: 'POST',
      headers,
      body: new URLSearchParams({ service, ticket }),
      maxBytes: MAX_RESPONSE_BYTES,
    }
  }
  url.searchParams.set('service', service)
  url.searchParams.set('ticket', ticket)
  return { url: url.toString(), method: 'GET', headers, maxBytes: MAX_RESPONSE_BYTES }
}

/** what came of asking the server about a ticket */
export type Validation =
  | CasAnswer
  /** the server could not be asked, or did not answer as a server does */
  | { readonly kind: 'unavailable'; readonly reason: string }

export const validateTicket = Effect.fn('authCas.validateTicket')(function* (
  settings: CasSettings,
  service: string,
  ticket: string,
) {
  const outbound = yield* AuthOutbound
  const answered = yield* outbound.fetch(validationRequest(settings, service, ticket)).pipe(
    Effect.map((response) => ({ ok: true as const, response })),
    Effect.catchTags({
      OutboundRefused: (refused) =>
        Effect.succeed({ ok: false as const, reason: `refused:${refused.reason}` }),
      // an answer too large to be one is an answer, and not a readable one
      OutboundFailed: (failed) =>
        Effect.succeed(
          failed.reason === 'too-large'
            ? { ok: true as const, response: undefined }
            : { ok: false as const, reason: failed.reason },
        ),
    }),
  )
  if (!answered.ok) return { kind: 'unavailable', reason: answered.reason } satisfies Validation
  if (answered.response === undefined) return { kind: 'unreadable' } satisfies Validation
  if (answered.response.status !== 200) {
    return {
      kind: 'unavailable',
      reason: `status:${answered.response.status}`,
    } satisfies Validation
  }
  return readAnswer(answered.response.body, settings.responseFormat) satisfies Validation
})

/** the person identifier an answer names, by the entrance's rule */
export const businessNoOf = (
  principal: CasPrincipal,
  identity: CasIdentity,
): string | undefined => {
  if (identity.source === 'principal') return principal.principal
  const value = principal.attributes[identity.attribute]
    ?.map((one) => one.trim())
    .find((one) => one !== '')
  if (value !== undefined) return value
  return identity.fallbackToPrincipal ? principal.principal : undefined
}
