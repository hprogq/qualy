import { Data } from 'effect'
import type { Effect } from 'effect'

// What a mail backend is asked to do: deliver one message it is handed whole,
// sender included. How - a relay, an api, a file on a developer's disk - is
// the backend's; what counts as done is that the server it hands to has
// accepted the message.

export interface OutgoingMail {
  readonly from: string
  readonly to: string
  readonly subject: string
  readonly text: string
  readonly html?: string
  readonly replyTo?: string
}

export class MailBackendFailed extends Data.TaggedError('MailBackendFailed')<{
  readonly reason: 'rejected' | 'unavailable'
}> {}

export interface MailBackend {
  readonly code: string
  readonly send: (mail: OutgoingMail) => Effect.Effect<void, MailBackendFailed>
}
