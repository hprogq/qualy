/**
 * The LSP half of the authoring protocol: one language-service session per
 * open formula, spoken THROUGH the service - never a transparent tunnel.
 * The service owns the process, the workspace, the method allowlist and
 * the URI boundary; this file owns only the wire shapes.
 *
 * Sessions are anonymous here on purpose: the authoring sandbox knows no
 * users, so per-user quotas belong to the authenticated bridge (F2). What
 * this side CAN bound, it does: session count, frame size, source size,
 * outbound queue depth, idle and absolute lifetimes.
 */

import { Schema } from 'effect'
import { Rpc } from 'effect/unstable/rpc'

/** one LSP json-rpc frame's ceiling, either direction */
export const LSP_FRAME_LIMIT = 1024 * 1024

export const LSP_SESSION_LIMITS = Object.freeze({
  globalSessions: 8,
  idleMs: 5 * 60 * 1000,
  absoluteMs: 30 * 60 * 1000,
  outboundQueue: 1024,
})

export class LspBusy extends Schema.TaggedError<LspBusy>()('LspBusy', {
  limit: Schema.Number,
}) {}

export class LspSourceTooLarge extends Schema.TaggedError<LspSourceTooLarge>()(
  'LspSourceTooLarge',
  { limit: Schema.Number },
) {}

export class LspSessionNotFound extends Schema.TaggedError<LspSessionNotFound>()(
  'LspSessionNotFound',
  {},
) {}

export class LspSequenceRejected extends Schema.TaggedError<LspSequenceRejected>()(
  'LspSequenceRejected',
  { lastAccepted: Schema.Number },
) {}

export class LspFrameTooLarge extends Schema.TaggedError<LspFrameTooLarge>()('LspFrameTooLarge', {
  bytes: Schema.Number,
  limit: Schema.Number,
}) {}

export class LspMethodRefused extends Schema.TaggedError<LspMethodRefused>()('LspMethodRefused', {
  method: Schema.String,
}) {}

export class LspUriRefused extends Schema.TaggedError<LspUriRefused>()('LspUriRefused', {
  uri: Schema.String,
}) {}

export class LspMalformedFrame extends Schema.TaggedError<LspMalformedFrame>()(
  'LspMalformedFrame',
  {},
) {}

export type LspSendError =
  | LspSessionNotFound
  | LspSequenceRejected
  | LspFrameTooLarge
  | LspMethodRefused
  | LspUriRefused
  | LspMalformedFrame

export const LspEvent = Schema.Struct({
  sequence: Schema.Number,
  jsonRpc: Schema.String,
})

export const lspRpcs = [
  Rpc.make('OpenLsp', {
    payload: { initialSource: Schema.String },
    success: Schema.Struct({ sessionId: Schema.String }),
    error: Schema.Union([LspBusy, LspSourceTooLarge]),
  }),
  Rpc.make('SendLsp', {
    payload: {
      sessionId: Schema.String,
      sequence: Schema.Number,
      jsonRpc: Schema.String,
    },
    error: Schema.Union([
      LspSessionNotFound,
      LspSequenceRejected,
      LspFrameTooLarge,
      LspMethodRefused,
      LspUriRefused,
      LspMalformedFrame,
    ]),
  }),
  Rpc.make('LspEvents', {
    payload: { sessionId: Schema.String },
    success: LspEvent,
    error: Schema.Union([LspSessionNotFound]),
    stream: true,
  }),
  Rpc.make('CloseLsp', {
    payload: { sessionId: Schema.String },
  }),
] as const
