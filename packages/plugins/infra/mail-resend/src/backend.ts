import { Effect, Redacted } from 'effect'
import { MailBackendFailed, type MailBackend, type OutgoingMail } from '@qualy/plugin-mail/server'

// Handing a message to Resend's HTTP api.
//
// Done is Resend accepting the message. Refused for good is Resend saying the
// message itself will not do - a field it cannot take, an address it will not
// send to (400, 422). Everything else is Resend being unavailable to this
// deployment: rate limits and quotas (429), its own failures (5xx), no
// answer in time. The api key or the sending domain being wrong (401, 403)
// is unavailable too, and logged as an error: no message will go out until an
// operator fixes it, and a message is not at fault for that.

export const RESEND_EMAILS_URL = 'https://api.resend.com/emails'

const TIMEOUT_MS = 10_000

/** how a request reached Resend, as a suite can answer in its place */
export type ResendPost = (request: {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly body: string
}) => Promise<{ readonly status: number; readonly body: unknown }>

export const fetchPost: ResendPost = async (request) => {
  const response = await fetch(request.url, {
    method: 'POST',
    headers: request.headers,
    body: request.body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const body: unknown = await response.json().catch(() => undefined)
  return { status: response.status, body }
}

/** what Resend's error body names, when it names anything */
const nameOf = (body: unknown) => {
  const name = (body as { name?: unknown } | null)?.name
  return typeof name === 'string' ? name : 'no error name'
}

/** what an answer means for the message; undefined when it was accepted */
export const meaningOf = (
  status: number,
): { readonly reason: 'rejected' | 'unavailable'; readonly misconfigured: boolean } | undefined => {
  if (status >= 200 && status < 300) return undefined
  if (status === 400 || status === 422) return { reason: 'rejected', misconfigured: false }
  if (status === 429 || status === 409 || status >= 500) {
    return { reason: 'unavailable', misconfigured: false }
  }
  // 401, 403, and anything this integration did not expect to be told
  return { reason: 'unavailable', misconfigured: true }
}

export const resendBackend = (
  settings: { readonly apiKey: Redacted.Redacted<string> },
  post: ResendPost = fetchPost,
): MailBackend => ({
  code: 'resend',
  send: Effect.fn('MailResend.send')(function* (mail: OutgoingMail) {
    const answer = yield* Effect.tryPromise({
      try: () =>
        post({
          url: RESEND_EMAILS_URL,
          headers: {
            authorization: `Bearer ${Redacted.value(settings.apiKey)}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            from: mail.from,
            to: [mail.to],
            subject: mail.subject,
            text: mail.text,
            ...(mail.html === undefined ? {} : { html: mail.html }),
            ...(mail.replyTo === undefined ? {} : { reply_to: mail.replyTo }),
          }),
        }),
      catch: () => new MailBackendFailed({ reason: 'unavailable' }),
    })
    const meaning = meaningOf(answer.status)
    if (meaning === undefined) return
    if (meaning.misconfigured) {
      yield* Effect.logError(
        `resend refused this deployment's request (${String(answer.status)}, ${nameOf(answer.body)}); check QUALY_MAIL_RESEND_API_KEY and the sending domain`,
      )
    } else if (meaning.reason === 'rejected') {
      yield* Effect.logWarning(`resend refused a message (${String(answer.status)}, ${nameOf(answer.body)})`)
    }
    return yield* new MailBackendFailed({ reason: meaning.reason })
  }),
})
