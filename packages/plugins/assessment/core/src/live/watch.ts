import { Effect, Metric, Option, Stream } from 'effect'
import { HttpServerRequest, HttpServerResponse } from 'effect/http'
import type { Principal } from '@qualy/rbac-contract'
import { CurrentViewer, SessionPresence } from '@qualy/auth-contract/session'
import { ClientAssembly, clientRefusal } from '@qualy/api-kit/client-assembly'
import { originMatches, publicOriginOf, trustedProxies } from '@qualy/api-kit/origin'
import { currentRequestContext, webSocketSession } from '@qualy/api-kit/request'
import { LIVE_CLOSE } from '@qualy/api-kit/live-socket'
import {
  liveClientOf,
  offersLiveSubprotocol,
  refuseLiveSocket,
  serveLiveSocket,
  spread,
  type LiveEnding,
  type LiveRefusal,
} from '@qualy/api-kit/live-socket-server'
import { boundedCounter, boundedDurationHistogram } from '@qualy/telemetry/metrics'
import { AssessmentLive } from './service.ts'
import type { AssessmentLiveEvent } from './events.ts'

// One batch's live channel, as a connection is served: who may listen, to
// what, for how long, and what is recorded of it.
//
// Everything a page must act on is judged after the upgrade, so it can be
// said with a close code (@qualy/api-kit/live-socket) - all but a foreign
// origin, which is someone else's page and is owed nothing it can read. The
// order is the cheapest refusal first, and a seat is taken last: a
// connection refused for any other reason holds none and gives none back.

/** who the listener is in the round, as the audience rule reads it */
export interface WatchStanding {
  readonly personal: boolean
  readonly review: boolean
  readonly record: boolean
  readonly manage: boolean
  readonly redetermine: boolean
  readonly readAll: boolean
}

/**
 * Which wake-ups a listener hears. Nothing is disclosed by hearing - what
 * goes down the wire is the kind and nothing else - but a screen woken by
 * every claim in the round would read its whole page for nothing.
 */
export const hears = (
  standing: WatchStanding,
  principal: Principal,
  batchId: string,
  event: AssessmentLiveEvent,
): boolean => {
  if (event.tenantId !== principal.tenantId || event.batchId !== batchId) return false
  // who reads everybody's totals on the results roster: its administrators,
  // whoever re-determines (ruling #33) and whoever views all claims (ruling
  // of 2026-09-29)
  const readsAccounts = standing.manage || standing.redetermine || standing.readAll
  switch (event.kind) {
    case 'review-inbox-changed':
      return standing.review
    case 'review-instance-changed':
      // a round moving is a claim waiting on something else, and on the
      // results roster a total that may have moved
      return standing.review || readsAccounts
    case 'entries-changed':
    case 'result-changed':
      // A participant hears about their own. The people who work the round
      // hear about all of it: a recorder's list, a reviewer's queue and the
      // results roster's totals are drawn from exactly the facts these
      // announce, and gated on membership alone the staff screens never
      // woke at all.
      return (
        standing.review ||
        standing.record ||
        readsAccounts ||
        (standing.personal &&
          (event.subjectUserId === null || event.subjectUserId === principal.userId))
      )
    case 'item-changed':
      return true
    // which phase the batch is in - and what the timetable says - is not a
    // secret from anybody who may watch the batch at all
    case 'phase-changed':
    case 'plan-changed':
      return true
  }
}

// What is recorded: one count per dial by how it was answered, one per end
// by how it ended, the seats held now, and how long a connection lived. No
// line per heartbeat, and no connection counted as a slow request - the
// access log's line for the upgrade is written when it is established.
const admissions = boundedCounter('qualy.assessment.live.admission', {
  outcome: [
    'admitted',
    'quota-session',
    'quota-capacity',
    'unauthenticated',
    'forbidden',
    'unsupported',
  ],
})
const endings = boundedCounter('qualy.assessment.live.close', {
  ending: [
    'renew',
    'client-normal',
    'client-abnormal',
    'unresponsive',
    'refused',
    'revoked',
    'ended',
  ],
})
const lifetimes = boundedDurationHistogram(
  'qualy.assessment.live.lifetime',
  { ending: ['renew', 'client', 'server'] },
  [1, 15, 60, 120, 300, 600, 900, 1800],
)
const seatsHeld = Metric.gauge('qualy.assessment.live.open')

const endingOf = (ending: LiveEnding): string => {
  if (ending.by === 'client')
    return ending.code === 1000 || ending.code === 1001 ? 'client-normal' : 'client-abnormal'
  switch (ending.code) {
    case LIVE_CLOSE.renew:
      return 'renew'
    case LIVE_CLOSE.unresponsive:
      return 'unresponsive'
    case LIVE_CLOSE.unauthenticated:
    case LIVE_CLOSE.forbidden:
      return 'revoked'
    case LIVE_CLOSE.normal:
      return 'ended'
    default:
      return 'refused'
  }
}

export const watchBatch = (input: {
  readonly batchId: string
  /** the listener's standing in the round, or nothing where the batch is not theirs to watch */
  readonly standing: (principal: Principal) => Effect.Effect<WatchStanding | undefined>
}) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest

    // a page from before the channel was a socket asks for an event stream
    // with a plain GET - no origin on it, as a same-origin GET has none; it is
    // told to upgrade, and goes on polling
    if ((request.headers['upgrade'] ?? '').toLowerCase() !== 'websocket') {
      return HttpServerResponse.empty({ status: 426, headers: { upgrade: 'websocket' } })
    }
    // a browser-initiated WebSocket carries the ambient session cookie
    // whatever page started it, so the ORIGIN header is the whole cross-site
    // defense: absent, non-http(s) or naming another origin is someone
    // else's page. It is held against the origin the request context
    // resolved through the deployment's proxy policy.
    const context = Option.getOrUndefined(yield* currentRequestContext)
    const publicOrigin =
      context === undefined ? publicOriginOf(request, trustedProxies([])) : context.publicOrigin
    if (!originMatches(request.headers['origin'], publicOrigin)) {
      return HttpServerResponse.empty({ status: 403 })
    }

    const viewer = yield* CurrentViewer
    const presence = yield* SessionPresence
    const live = yield* AssessmentLive
    const assembly = yield* Effect.serviceOption(ClientAssembly)
    const batchId = input.batchId

    return yield* webSocketSession(
      Effect.fnUntraced(function* (upgrade) {
        const socket = yield* upgrade.pipe(Effect.orElseSucceed(() => null))
        if (socket === null) return HttpServerResponse.empty({ status: 400 })
        const refuse = (outcome: string, refusal: LiveRefusal) =>
          Effect.andThen(
            Effect.all([
              admissions({ outcome }),
              Effect.logInfo('assessment live connection refused').pipe(
                Effect.annotateLogs({ batchId, outcome }),
              ),
            ]),
            Effect.as(refuseLiveSocket(socket, refusal), HttpServerResponse.empty()),
          )

        // the page's own generation and release, the same judgement the
        // http transport's headers get
        const unsupported = offersLiveSubprotocol(request)
          ? clientRefusal(liveClientOf(request), (id) =>
              Option.isSome(assembly) ? assembly.value.standingOf(id) : 'compatible',
            )
          : 'protocol'
        if (unsupported !== undefined) {
          return yield* refuse('unsupported', { code: LIVE_CLOSE.unsupported, reason: unsupported })
        }
        const principal = viewer.principal
        if (principal === undefined) {
          return yield* refuse('unauthenticated', {
            code: LIVE_CLOSE.unauthenticated,
            reason: 'unauthenticated',
          })
        }
        // Standing is read at connect and again at every recheck, never per
        // event: `capabilitiesFor` is coarse on purpose - "a reviewer here"
        // does not flicker with the phases - and every read a wake-up
        // triggers is authorized on its own. Someone stripped of a role, or
        // of the batch, stops hearing within one recheck.
        let standing = yield* input.standing(principal)
        if (standing === undefined) {
          return yield* refuse('forbidden', { code: LIVE_CLOSE.forbidden, reason: 'forbidden' })
        }
        // Counted against the session and the process. A refusal is a
        // completed upgrade closed with 4429: the page waits for a seat and
        // polls meanwhile.
        const admission = yield* live.connections.admit(principal.sessionId)
        if (!admission.admitted) {
          return yield* refuse(`quota-${admission.reason}`, {
            code: LIVE_CLOSE.quota,
            reason: admission.reason,
          })
        }
        yield* admissions({ outcome: 'admitted' })
        yield* Metric.update(seatsHeld, live.connections.open())
        const openedAt = performance.now()

        // subscribed before the first word, so nothing announced between
        // `sync` and the subscription falls through
        const events = yield* live.subscribe
        const messages = events.pipe(
          Stream.filter(
            (event) => standing !== undefined && hears(standing, principal, batchId, event),
          ),
          Stream.map((event) => ({ kind: event.kind })),
        )
        const recheck: Effect.Effect<LiveRefusal | undefined> = Effect.gen(function* () {
          if (!(yield* presence.isLive(principal.sessionId))) {
            return { code: LIVE_CLOSE.unauthenticated, reason: 'session ended' }
          }
          const next = yield* input.standing(principal)
          if (next === undefined) return { code: LIVE_CLOSE.forbidden, reason: 'forbidden' }
          standing = next
          return undefined
        })
        // spread, so a process restarted under a thousand pages does not
        // have them all renew, or all ask again, in the same second
        const ending = yield* serveLiveSocket(socket, {
          messages,
          sync: { kind: 'sync' },
          lifetime: yield* spread(live.connections.limits.lifetime, 0.1),
          recheck: { every: yield* spread(live.connections.limits.recheck, 0.2), check: recheck },
        }).pipe(
          // the conversation runs untraced: a span per frame, or one lasting
          // the whole connection, made each open page one trace as long as it
          // stayed open
          Effect.withTracerEnabled(false),
        )
        const seconds = (performance.now() - openedAt) / 1000
        const kind = endingOf(ending)
        yield* endings({ ending: kind })
        yield* lifetimes(
          { ending: kind === 'renew' ? 'renew' : ending.by === 'client' ? 'client' : 'server' },
          seconds,
        )
        yield* (
          kind === 'client-normal' || kind === 'renew' || kind === 'ended'
            ? Effect.logDebug('assessment live connection ended')
            : Effect.logInfo('assessment live connection ended')
        ).pipe(
          Effect.annotateLogs({
            batchId,
            by: ending.by,
            code: ending.code,
            seconds: Math.round(seconds),
          }),
        )
        return HttpServerResponse.empty()
      }),
    ).pipe(
      // the seat is given back when the session scope closes; the gauge
      // follows it there
      Effect.ensuring(Effect.suspend(() => Metric.update(seatsHeld, live.connections.open()))),
    )
  })
