import { createHash } from 'node:crypto'
import { ANONYMOUS_IDENTITY } from '@qualy/api-kit'

// Who a principal is, as a page may compare it (docs/adr/0013-document-identity.md).
//
// A digest of the tenant and the user: the same for one person in every
// session they hold, different for two people, and naming neither id. The
// manifest hands it to the page as the identity the page belongs to; the
// page sends it back with what it asks, and the server compares the two.
// It is a consistency check and nothing more - it authorizes nothing, and a
// request is still judged by its own session.
//
// Server only: a page never computes one, it only echoes the one it was given.

/** a principal's identity key */
export const identityKeyOf = (principal: {
  readonly tenantId: string
  readonly userId: string
}): string =>
  createHash('sha256')
    .update(`${principal.tenantId}\u0000${principal.userId}`)
    .digest('base64url')
    .slice(0, 22)

/** what a request found behind its cookie, as the session middlewares resolve it */
export type PresentedSession =
  | {
      readonly state: 'valid'
      readonly principal: { readonly tenantId: string; readonly userId: string }
    }
  | { readonly state: 'absent' | 'expired' }

/**
 * What to do with a request, given the identity its page says it belongs to.
 *
 * - `pass`: the page and the session agree, or this is not a page of ours.
 * - `changed`: somebody else holds the session now; the page is not theirs.
 * - `unasserted`: a page of ours that did not say whose it is - a broken
 *   client, never taken as anybody.
 * - `absent` / `expired`: the page's person has no session now; the caller
 *   answers with its own session refusal, which the page recovers from when
 *   the same person signs back in.
 */
export type IdentityVerdict = 'pass' | 'changed' | 'unasserted' | 'absent' | 'expired'

export const judgeDocumentIdentity = (input: {
  /** the identity the request declares, or nothing when it declares none */
  readonly declared: string | undefined
  /** whether the request comes from the application's own page */
  readonly fromPage: boolean
  readonly session: PresentedSession
}): IdentityVerdict => {
  // a client that is not a page of ours keeps the policy it always had
  if (!input.fromPage) return 'pass'
  if (input.declared === undefined || input.declared === '') return 'unasserted'
  if (input.session.state === 'valid') {
    return input.declared === identityKeyOf(input.session.principal) ? 'pass' : 'changed'
  }
  // nobody is signed in: a page that belonged to nobody may go on as nobody
  if (input.declared === ANONYMOUS_IDENTITY) return 'pass'
  return input.session.state
}
