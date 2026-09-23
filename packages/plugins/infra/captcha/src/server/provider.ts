import type { Effect } from 'effect'
import { Data } from 'effect'
import type { CaptchaPurpose } from '../contract.ts'

// What a provider implements, and nothing it is told beyond what it needs.
//
// A provider never sees the caller's own words - an email, a user, a
// password. It sees a binding hash the capability derived from them, under
// the deployment's key, together with the tenant and the purpose; a proof
// it issued for one of those cannot be spent on another.

export interface CaptchaProviderContext {
  readonly tenantId: string
  readonly purpose: CaptchaPurpose
  /** a keyed digest of the tenant, the purpose and the caller's binding key; 64 hex */
  readonly bindingHash: string
  /** as the request pipeline resolved it through the trusted-proxy policy */
  readonly clientIp: string | undefined
  readonly publicHost: string | undefined
}

/**
 * The provider could not be asked - its service timed out, answered with a
 * server error, or declared itself out of service. The capability lets the
 * request through when this happens, and says so loudly.
 *
 * Only that. A proof that is wrong, expired, replayed or bound elsewhere is
 * `rejected`, never this; and a bug is a defect, never this either: turning
 * every failure into "unavailable" would turn every failure into a way past.
 */
export class CaptchaUnavailable extends Data.TaggedError('CaptchaUnavailable')<{
  /** for the operator's log; never shown to anybody */
  readonly reason: string
}> {}

export interface CaptchaProvider {
  readonly code: string
  /** a fresh challenge for this context, as the browser half will receive it */
  readonly issue: (
    context: CaptchaProviderContext,
  ) => Effect.Effect<Record<string, unknown>, CaptchaUnavailable>
  /** whether this response proves this context's challenge, spending it */
  readonly verify: (
    context: CaptchaProviderContext,
    response: string,
  ) => Effect.Effect<'verified' | 'rejected', CaptchaUnavailable>
}
