import type { Brand } from 'effect'
import { Schema } from 'effect'

// What crosses between a caller, the capability and a browser: the words a
// challenge is named by, the proof a browser sends back, and the one refusal
// that asks for it. No imports beyond Schema, because a browser reads it too.
//
// The capability knows no caller. A purpose is a namespaced word the calling
// plugin declares for itself - `auth/login`, `assessment/entry-submit` -
// and nothing here lists them: a new caller needs no change to this package.

const segment = '[a-z0-9]+(?:-[a-z0-9]+)*'

/** `<owner>/<purpose>`, lowercase words joined by hyphens, at least two segments */
export const CAPTCHA_PURPOSE_PATTERN = new RegExp(`^${segment}(?:/${segment})+$`)
export const CAPTCHA_PURPOSE_MAX_LENGTH = 127

/** a provider's code: one lowercase word or several joined by hyphens */
export const CAPTCHA_PROVIDER_CODE_PATTERN = new RegExp(`^${segment}$`)
export const CAPTCHA_PROVIDER_CODE_MAX_LENGTH = 63

/**
 * The most a proof may weigh on the way in. Generous for any provider's
 * payload; a provider holds its own to a tighter bound.
 */
export const CAPTCHA_RESPONSE_MAX_LENGTH = 16 * 1024

/** what a challenge protects; part of what a proof is bound to */
export type CaptchaPurpose = string & Brand.Brand<'CaptchaPurpose'>

/** which provider issued a challenge and must verify its proof */
export type CaptchaProviderCode = string & Brand.Brand<'CaptchaProviderCode'>

const validPurpose = (value: string) =>
  value.length <= CAPTCHA_PURPOSE_MAX_LENGTH && CAPTCHA_PURPOSE_PATTERN.test(value)

const validProviderCode = (value: string) =>
  value.length <= CAPTCHA_PROVIDER_CODE_MAX_LENGTH && CAPTCHA_PROVIDER_CODE_PATTERN.test(value)

/**
 * A purpose, declared once as a constant by the plugin it belongs to.
 * A malformed one is a programming mistake and throws where it is written.
 */
export const captchaPurpose = (value: string): CaptchaPurpose => {
  if (!validPurpose(value)) {
    throw new Error(
      `"${value}" is not a captcha purpose: <owner>/<purpose>, lowercase words and hyphens, at most ${String(CAPTCHA_PURPOSE_MAX_LENGTH)} characters`,
    )
  }
  return value as CaptchaPurpose
}

export const captchaProviderCode = (value: string): CaptchaProviderCode => {
  if (!validProviderCode(value)) {
    throw new Error(
      `"${value}" is not a captcha provider code: lowercase words joined by hyphens, at most ${String(CAPTCHA_PROVIDER_CODE_MAX_LENGTH)} characters`,
    )
  }
  return value as CaptchaProviderCode
}

export const isCaptchaProviderCode = (value: string): value is CaptchaProviderCode =>
  validProviderCode(value)

const ProviderCodeSchema = Schema.String.check(
  Schema.isMaxLength(CAPTCHA_PROVIDER_CODE_MAX_LENGTH),
  Schema.isPattern(CAPTCHA_PROVIDER_CODE_PATTERN),
)

/**
 * What a browser sends back beside the request a challenge interrupted.
 *
 * The response is the provider's own opaque payload, handed over as the
 * provider's browser half produced it and never read by anything but the
 * provider's server half.
 */
export const CaptchaProof = Schema.Struct({
  provider: ProviderCodeSchema,
  response: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(CAPTCHA_RESPONSE_MAX_LENGTH),
  ),
})
export type CaptchaProof = typeof CaptchaProof.Type

/** what a browser is given to solve: which provider, and that provider's own challenge */
export interface CaptchaPrompt {
  readonly provider: string
  readonly challenge: Readonly<Record<string, unknown>>
}

/**
 * The request may go on once a challenge is met.
 *
 * 428, not 429: nothing has to be waited out, and the same request, sent
 * again with a proof, is answered normally. A caller answers with it in place
 * of whatever the request would have done, and records nothing - no attempt
 * was judged.
 */
export class CaptchaRequired extends Schema.TaggedError<CaptchaRequired>()(
  'CAPTCHA_REQUIRED',
  {
    provider: Schema.String,
    challenge: Schema.Record(Schema.String, Schema.Unknown),
  },
  { httpApiStatus: 428, identifier: 'CaptchaRequired' },
) {}
