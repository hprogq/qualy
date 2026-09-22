import { Duration, Effect, Layer } from 'effect'
import { boundedCounter } from '@qualy/telemetry/metrics'
import { Mailer, MailUnavailable } from '../plugin.ts'
import { MailConfig } from './config.ts'
import { MailBackends } from './registry.ts'

// Sending one message: the deployment's backend, the deployment's sender, a
// time limit, and one kind of failure whatever the backend was.
//
// Nothing about a message is logged or put on a span beyond which backend
// took it and how it went: a subject can carry a name, a body can carry a
// link that signs somebody in.

const sent = boundedCounter('qualy.mail.sent', {
  outcome: ['sent', 'rejected', 'unavailable'],
})

export const serviceLayer: Layer.Layer<Mailer, never, MailBackends | MailConfig> = Layer.effect(
  Mailer,
  Effect.gen(function* () {
    const registry = yield* MailBackends
    const config = yield* MailConfig
    return Mailer.of({
      send: Effect.fn('Mail.send')(function* (message) {
        const backend = yield* registry.forSend
        if (backend === undefined) {
          yield* sent({ outcome: 'unavailable' })
          return yield* new MailUnavailable({ reason: 'unavailable' })
        }
        yield* Effect.annotateCurrentSpan('mail.backend', backend.code)
        const outcome = yield* backend
          .send({
            from: config.from,
            to: message.to,
            subject: message.subject,
            text: message.text,
            ...(message.html === undefined ? {} : { html: message.html }),
            ...(message.replyTo === undefined ? {} : { replyTo: message.replyTo }),
          })
          .pipe(
            Effect.timeoutOption(Duration.millis(config.timeoutMs)),
            Effect.map((done) => (done._tag === 'Some' ? ('sent' as const) : ('unavailable' as const))),
            Effect.catchTag('MailBackendFailed', (failed) => Effect.succeed(failed.reason)),
          )
        yield* sent({ outcome })
        if (outcome !== 'sent') {
          yield* Effect.logWarning('mail was not sent').pipe(
            Effect.annotateLogs({ backend: backend.code, outcome }),
          )
          return yield* new MailUnavailable({ reason: outcome })
        }
      }),
    })
  }),
)
