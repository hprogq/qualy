import { Context, Effect, Layer, Option } from 'effect'
import { currentRequestContext } from '@qualy/api-kit/request'
import { boundedCounter } from '@qualy/telemetry/metrics'
import { Secrets } from '@qualy/plugin-secrets/plugin'
import type { CaptchaProof, CaptchaPrompt, CaptchaPurpose } from '../contract.ts'
import type { CaptchaProviderContext } from './provider.ts'
import { CaptchaProviders } from './registry.ts'

// The one policy every caller shares.
//
// A caller decides WHETHER a request must be challenged - that is its own
// risk, measured its own way - and hands the rest here: issue a challenge,
// check a proof, and what to do when there is no provider or the provider
// cannot be asked. Written once, so no caller can get the failure cases
// subtly different from the next.
//
// A challenge is additional friction, not a factor: when there is no
// provider, or the provider's own service is down, the request goes on and
// the operator is told. A proof that fails is never let through that way -
// only the provider being unreachable is.

/** why a request went on */
export type CaptchaPassage = 'verified' | 'bypassed'

export type CaptchaGuardResult =
  | { readonly kind: 'passed'; readonly via: CaptchaPassage }
  | { readonly kind: 'required'; readonly prompt: CaptchaPrompt }

export interface CaptchaGuardInput {
  readonly tenantId: string
  readonly purpose: CaptchaPurpose
  /**
   * What the proof is bound to, in the caller's own terms: for a sign-in, the
   * entrance and the address typed. Never seen by a provider - only a keyed
   * digest of it, together with the tenant and the purpose, is.
   */
  readonly bindingKey: string
  readonly proof?: CaptchaProof
}

const OUTCOMES = [
  'required',
  'verified',
  'rejected',
  'bypass_no_provider',
  'bypass_unavailable',
] as const

/** what came of a guarded request; not labelled by purpose, which callers may coin freely */
const guarded = boundedCounter('qualy.captcha.guard', { outcome: OUTCOMES })

export class Captcha extends Context.Service<
  Captcha,
  {
    /**
     * Whether a request a caller has judged risky may go on.
     *
     * Without a proof: a challenge to answer, or passage when there is
     * nobody to ask. With one: passage if it proves this very tenant, purpose
     * and binding - otherwise a fresh challenge, never passage.
     */
    readonly guard: (input: CaptchaGuardInput) => Effect.Effect<CaptchaGuardResult>
  }
>()('@qualy/plugin-captcha/Captcha') {}

export const serviceLayer: Layer.Layer<Captcha, never, Secrets | CaptchaProviders> = Layer.effect(
  Captcha,
  Effect.gen(function* () {
    const secrets = yield* Secrets
    const registry = yield* CaptchaProviders

    const contextOf = Effect.fnUntraced(function* (input: CaptchaGuardInput) {
      // one digest over all three, so a proof for one tenant, one purpose or
      // one address is worth nothing for another
      const bindingHash = yield* secrets.fingerprint(
        `captcha/binding/v1/${input.tenantId}/${input.purpose}`,
        input.bindingKey,
      )
      // read here, from the pipeline that already applied the trusted-proxy
      // policy - never taken from a caller
      const request = Option.getOrUndefined(yield* currentRequestContext)
      return {
        tenantId: input.tenantId,
        purpose: input.purpose,
        bindingHash,
        clientIp: request?.clientIp,
        publicHost: request?.publicHost,
      } satisfies CaptchaProviderContext
    })

    const bypassed = (outcome: 'bypass_no_provider' | 'bypass_unavailable') =>
      guarded({ outcome }).pipe(
        Effect.as({ kind: 'passed', via: 'bypassed' } satisfies CaptchaGuardResult as CaptchaGuardResult),
      )

    const guard = Effect.fn('Captcha.guard')(function* (input: CaptchaGuardInput) {
      const provider = yield* registry.selected
      if (provider === null) return yield* bypassed('bypass_no_provider')
      const context = yield* contextOf(input)

      const unreachable = (stage: 'issue' | 'verify', reason: string) =>
        Effect.logError(
          `captcha provider "${provider.code}" could not be asked to ${stage}; the request went on unchallenged: ${reason}`,
        ).pipe(Effect.andThen(bypassed('bypass_unavailable')))

      const challenge = provider.issue(context).pipe(
        Effect.flatMap((issued) =>
          guarded({ outcome: 'required' }).pipe(
            Effect.as({
              kind: 'required',
              prompt: { provider: provider.code, challenge: issued },
            } satisfies CaptchaGuardResult as CaptchaGuardResult),
          ),
        ),
        Effect.catchTag('CaptchaUnavailable', (error) => unreachable('issue', error.reason)),
      )

      // a proof from another provider - one that was replaced since the
      // challenge went out - proves nothing here: ask again, with this one
      if (input.proof === undefined || input.proof.provider !== provider.code) {
        return yield* challenge
      }
      const verdict = yield* provider.verify(context, input.proof.response).pipe(
        Effect.map((answer) => ({ answer }) as const),
        Effect.catchTag('CaptchaUnavailable', (error) =>
          Effect.succeed({ answer: 'unavailable', reason: error.reason } as const),
        ),
      )
      if (verdict.answer === 'unavailable') return yield* unreachable('verify', verdict.reason)
      if (verdict.answer === 'verified') {
        yield* guarded({ outcome: 'verified' })
        return { kind: 'passed', via: 'verified' } satisfies CaptchaGuardResult as CaptchaGuardResult
      }
      yield* guarded({ outcome: 'rejected' })
      return yield* challenge
    })

    return Captcha.of({ guard })
  }),
)
