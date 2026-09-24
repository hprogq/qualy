import { Context, Data, Effect, Layer } from 'effect'

// Asking Cloudflare whether a token is one, and reading what it said.
//
// The transport is its own service so a suite can answer in Cloudflare's
// place: no test of this repository may reach the public network.

export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

const TIMEOUT_MS = 5_000

/** the request never got an answer: a timeout, a refused connection, a dns failure */
export class SiteverifyUnreachable extends Data.TaggedError('SiteverifyUnreachable')<{
  readonly reason: string
}> {}

export class SiteverifyTransport extends Context.Service<
  SiteverifyTransport,
  {
    /** posts the form, and hands back the status and whatever body came with it */
    readonly post: (
      form: URLSearchParams,
    ) => Effect.Effect<{ readonly status: number; readonly body: unknown }, SiteverifyUnreachable>
  }
>()('@qualy/plugin-captcha-turnstile/SiteverifyTransport') {}

export const fetchTransportLayer: Layer.Layer<SiteverifyTransport> = Layer.succeed(
  SiteverifyTransport,
  SiteverifyTransport.of({
    post: (form) =>
      Effect.tryPromise({
        try: async () => {
          const response = await fetch(SITEVERIFY_URL, {
            method: 'POST',
            body: form,
            signal: AbortSignal.timeout(TIMEOUT_MS),
          })
          const body: unknown = await response.json().catch(() => undefined)
          return { status: response.status, body }
        },
        catch: (cause) =>
          new SiteverifyUnreachable({
            reason: cause instanceof Error ? cause.message : String(cause),
          }),
      }),
  }),
)

/** what Siteverify says about a token, as far as this provider reads it */
export interface SiteverifyAnswer {
  readonly success: boolean
  readonly errorCodes: readonly string[]
  readonly hostname: string | undefined
  readonly action: string | undefined
  readonly cdata: string | undefined
}

export const readAnswer = (body: unknown): SiteverifyAnswer | undefined => {
  if (typeof body !== 'object' || body === null) return undefined
  const fields = body as Record<string, unknown>
  if (typeof fields['success'] !== 'boolean') return undefined
  const codes = fields['error-codes']
  const text = (value: unknown) => (typeof value === 'string' ? value : undefined)
  return {
    success: fields['success'],
    errorCodes: Array.isArray(codes)
      ? codes.filter((code): code is string => typeof code === 'string')
      : [],
    hostname: text(fields['hostname']),
    action: text(fields['action']),
    cdata: text(fields['cdata']),
  }
}

/**
 * What a refusal from Siteverify means for the request, code by code.
 *
 * - The token is no proof: `invalid-input-response`, `timeout-or-duplicate`
 *   (expired or already spent), `missing-input-response`. Rejected - the
 *   person gets a fresh challenge.
 * - Cloudflare could not answer properly: `internal-error`. Unavailable -
 *   the request goes on, the way a timeout does.
 * - This deployment is misconfigured: `missing-input-secret`,
 *   `invalid-input-secret`. Unavailable, and logged as an error: failing
 *   every sign-in because an operator mistyped a key would lock everybody
 *   out, and a loud log is how it gets noticed.
 * - This integration sent something Cloudflare did not understand:
 *   `bad-request`, or any code not listed here. Unavailable and logged as an
 *   error too: it is our defect, not the person's proof, and telling them
 *   their check failed would be telling them something untrue.
 *
 * One code of the second or third kind decides it; only when every code is
 * of the first kind is the token rejected.
 */
export type RefusalMeaning =
  | { readonly kind: 'rejected' }
  | { readonly kind: 'unavailable'; readonly defect: string | undefined }

const NO_PROOF: ReadonlySet<string> = new Set([
  'invalid-input-response',
  'timeout-or-duplicate',
  'missing-input-response',
])
const CLOUDFLARE_DOWN: ReadonlySet<string> = new Set(['internal-error'])
const MISCONFIGURED: ReadonlySet<string> = new Set(['missing-input-secret', 'invalid-input-secret'])

export const meaningOfRefusal = (codes: readonly string[]): RefusalMeaning => {
  const misconfigured = codes.filter((code) => MISCONFIGURED.has(code))
  if (misconfigured.length > 0) {
    return {
      kind: 'unavailable',
      defect: `turnstile is misconfigured: ${misconfigured.join(', ')}`,
    }
  }
  const unknown = codes.filter((code) => !NO_PROOF.has(code) && !CLOUDFLARE_DOWN.has(code))
  if (unknown.length > 0 || codes.length === 0) {
    return {
      kind: 'unavailable',
      defect: `siteverify refused this integration's request: ${unknown.join(', ') || 'no reason given'}`,
    }
  }
  if (codes.some((code) => CLOUDFLARE_DOWN.has(code)))
    return { kind: 'unavailable', defect: undefined }
  return { kind: 'rejected' }
}
