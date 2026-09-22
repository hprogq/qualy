import { Effect, Redacted } from 'effect'
import nodemailer from 'nodemailer'
import { MailBackendFailed, type MailBackend } from '@qualy/plugin-mail/server'
import type { SmtpConfig } from './config.ts'

// Handing a message to an SMTP relay.
//
// What counts as done is the relay accepting it; what counts as refused is
// the relay saying no for good - a 5xx, a recipient it will not take, a
// sender it will not relay for. Anything else - no connection, a timeout, a
// TLS failure, a temporary 4xx - is the relay being unavailable, which the
// sender may try again later.

type Settings = Parameters<typeof SmtpConfig.of>[0]

/** how nodemailer's failure reads, as the capability's two answers */
export const reasonOf = (error: unknown): 'rejected' | 'unavailable' => {
  const failure = error as { code?: unknown; responseCode?: unknown } | null
  if (typeof failure?.responseCode === 'number') {
    return failure.responseCode >= 500 ? 'rejected' : 'unavailable'
  }
  return failure?.code === 'EENVELOPE' || failure?.code === 'EMESSAGE' ? 'rejected' : 'unavailable'
}

export const smtpBackend = (settings: Settings) => {
  const transport = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    // TLS from the first byte, or an upgrade that must happen, or neither
    secure: settings.tls === 'implicit',
    requireTLS: settings.tls === 'starttls',
    ignoreTLS: settings.tls === 'none',
    ...(settings.auth === undefined
      ? {}
      : { auth: { user: settings.auth.user, pass: Redacted.value(settings.auth.password) } }),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  })
  const backend: MailBackend = {
    code: 'smtp',
    send: (mail) =>
      Effect.tryPromise({
        try: () =>
          transport.sendMail({
            from: mail.from,
            to: mail.to,
            subject: mail.subject,
            text: mail.text,
            ...(mail.html === undefined ? {} : { html: mail.html }),
            ...(mail.replyTo === undefined ? {} : { replyTo: mail.replyTo }),
          }),
        catch: (error) => new MailBackendFailed({ reason: reasonOf(error) }),
      }).pipe(Effect.asVoid),
  }
  return { backend, close: () => transport.close() }
}
