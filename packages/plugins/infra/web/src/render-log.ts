import { Effect, Queue } from 'effect'
import {
  subscribeRenderDiagnostics,
  type RenderDiagnostic,
} from '@qualy/release-contract/render-diagnostics'

const logRenderDiagnostic = (event: RenderDiagnostic) =>
  (event.level === 'warn'
    ? Effect.logWarning('Render did not forward API cookies').pipe(
        Effect.annotateLogs({ dropped_cookies: event.droppedCookies }),
      )
    : Effect.logError('Web render failed').pipe(
        Effect.annotateLogs({ phase: event.phase, fault: event.fault }),
      )
  ).pipe(
    Effect.annotateLogs({
      source: 'web:rsc',
      ...(event.requestId === undefined ? {} : { request_id: event.requestId }),
      ...(event.traceId === undefined ? {} : { trace_id: event.traceId }),
    }),
  )

/** React callbacks can report even after the host has started streaming. */
export const renderLogging = Effect.gen(function* () {
  const events = yield* Queue.make<RenderDiagnostic>()
  yield* Effect.forkScoped(Effect.forever(Effect.flatMap(Queue.take(events), logRenderDiagnostic)))
  yield* Effect.acquireRelease(
    Effect.sync(() => subscribeRenderDiagnostics((event) => Queue.offerUnsafe(events, event))),
    (unsubscribe) => Effect.sync(unsubscribe),
  )
})
