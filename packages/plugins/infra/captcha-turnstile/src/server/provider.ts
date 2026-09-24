import { Effect, Layer, Redacted } from 'effect'
import { ShellPolicy } from '@qualy/api-kit/shell-policy'
import {
  CaptchaProviders,
  CaptchaUnavailable,
  type CaptchaProvider,
  type CaptchaProviderContext,
} from '@qualy/plugin-captcha/server'
import { TurnstileConfig } from './config.ts'
import { meaningOfRefusal, readAnswer, SiteverifyTransport } from './siteverify.ts'
import { actionOfPurpose, hostnameOfPublicHost } from './words.ts'

// Cloudflare Turnstile as the deployment's challenge provider.
//
// For a deployment outside mainland China, where Cloudflare serves: the
// widget is Cloudflare's, loaded from its host, and usually passes without
// the person doing anything. The token it hands over is checked here with
// Siteverify, and trusted only if it names this deployment's host, the
// action this purpose maps to and, as custom data, the very binding the
// challenge was issued for - `success` alone says only that the token is
// Cloudflare's, not that it was earned for this request.

export const TURNSTILE_PROVIDER = 'turnstile'
export const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com'

/** Cloudflare's own ceiling on a token; anything longer is not one, and is not sent */
const TOKEN_MAX_LENGTH = 2048

export const registrationLayer: Layer.Layer<
  never,
  never,
  CaptchaProviders | TurnstileConfig | SiteverifyTransport | ShellPolicy
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const settings = yield* TurnstileConfig
    const transport = yield* SiteverifyTransport
    const registry = yield* CaptchaProviders

    const issue = (context: CaptchaProviderContext) =>
      Effect.succeed({
        siteKey: settings.siteKey,
        action: actionOfPurpose(context.purpose),
        // 64 hex, well inside the 255 characters of A-Z a-z 0-9 _ - allowed
        cData: context.bindingHash,
      })

    const verify = Effect.fn('CaptchaTurnstile.verify')(function* (
      context: CaptchaProviderContext,
      response: string,
    ) {
      if (response.length > TOKEN_MAX_LENGTH) return 'rejected' as const
      // a request that cannot say which host it was addressed to cannot be
      // matched against the token's: rejected, never waved through
      const hostname = hostnameOfPublicHost(context.publicHost)
      if (hostname === undefined) return 'rejected' as const
      const form = new URLSearchParams({
        secret: Redacted.value(settings.secretKey),
        response,
      })
      if (context.clientIp !== undefined) form.set('remoteip', context.clientIp)
      const reply = yield* transport
        .post(form)
        .pipe(
          Effect.mapError(
            (error) =>
              new CaptchaUnavailable({ reason: `siteverify unreachable: ${error.reason}` }),
          ),
        )
      if (reply.status >= 500) {
        return yield* new CaptchaUnavailable({
          reason: `siteverify answered ${String(reply.status)}`,
        })
      }
      const answer = readAnswer(reply.body)
      if (answer === undefined) {
        yield* Effect.logError(
          `siteverify answered ${String(reply.status)} with a body it could not read`,
        )
        return yield* new CaptchaUnavailable({ reason: 'siteverify answer unreadable' })
      }
      if (!answer.success) {
        const meaning = meaningOfRefusal(answer.errorCodes)
        if (meaning.kind === 'rejected') return 'rejected' as const
        if (meaning.defect !== undefined) yield* Effect.logError(meaning.defect)
        return yield* new CaptchaUnavailable({
          reason: `siteverify refused: ${answer.errorCodes.join(', ') || 'no reason given'}`,
        })
      }
      const earnedHere =
        answer.hostname?.toLowerCase().replace(/\.$/, '') === hostname &&
        answer.action === actionOfPurpose(context.purpose) &&
        answer.cdata === context.bindingHash
      return earnedHere ? ('verified' as const) : ('rejected' as const)
    })

    yield* registry.register({ code: TURNSTILE_PROVIDER, issue, verify } satisfies CaptchaProvider)
    // the widget's code runs from Cloudflare's host and its challenge is a
    // frame from it: the shell trusts that origin for both, and only while
    // this plugin is selected
    const policy = yield* ShellPolicy
    yield* policy.register({
      owner: '@qualy/plugin-captcha-turnstile',
      'script-src': [TURNSTILE_ORIGIN],
      'frame-src': [TURNSTILE_ORIGIN],
    })
  }),
)
