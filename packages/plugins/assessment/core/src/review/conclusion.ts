import { Effect } from 'effect'
import { db } from '../server/db.ts'

// What a decided claim currently stands on, and whether its participant may
// still contest it (rulings of 2026-09-25).
//
// A claim's conclusion is one of three facts. Usually the round it stands
// on: a completed round that judged the claim's current filing. For a fact
// the office recorded, or a determination staff re-made outside any round,
// the determination itself. And for an approval staff re-determined as not
// recognised, the entry event that records the revocation - it wrote no
// determination to name.
//
// Every conclusion may be contested by its participant once. A conclusion a
// participant appeal itself produced may not be contested again: the appeal
// was the one. A conclusion reached any other way - a first look, a staff
// reopening, a re-determination - is new, and has its own. The database
// holds the "once" (a conclusion is the root target of at most one appeal);
// this module is how the screen and the write ask the same question.

/** the redetermination event kinds, one per way the standing can move */
export const REDETERMINATION_KINDS = [
  'recognition-corrected',
  'approval-revoked',
  'rejection-overturned',
] as const

export type RedeterminationKind = (typeof REDETERMINATION_KINDS)[number]

/** the conclusion an appeal or a reopening contests */
export type ConclusionTarget =
  | { readonly kind: 'round'; readonly instanceId: string }
  | { readonly kind: 'recognition'; readonly recognitionId: string }
  | { readonly kind: 'revocation'; readonly eventId: string }

export interface Conclusion {
  readonly target: ConclusionTarget
  /** the participant may no longer contest it: the one appeal is spent */
  readonly exhausted: boolean
}

interface ConclusionRow {
  entryId: string
  status: string
  currentRevisionId: string | null
  roundId: string | null
  roundOrigin: string | null
  roundState: string | null
  roundOutcome: string | null
  roundRevisionId: string | null
  recognitionId: string | null
  recognitionSource: string | null
  eventId: string | null
  eventKind: string | null
  roundAppealed: boolean
  recognitionAppealed: boolean
  eventAppealed: boolean
}

/**
 * Read off one row: the conclusion, or null where the claim stands on
 * nothing a person decided - not decided yet, under a round still running,
 * approved by the rule alone, or on a round that judged older material.
 */
const conclusionOf = (row: ConclusionRow): Conclusion | null => {
  if (row.status !== 'approved' && row.status !== 'rejected') return null
  if (row.roundId !== null) {
    if (
      row.roundState !== 'completed' ||
      (row.roundOutcome !== 'approved' && row.roundOutcome !== 'rejected') ||
      row.roundRevisionId !== row.currentRevisionId
    ) {
      return null
    }
    return {
      target: { kind: 'round', instanceId: row.roundId },
      // a re-routed appeal is still the appeal: it keeps its origin
      exhausted: row.roundOrigin === 'appeal' || row.roundAppealed,
    }
  }
  if (
    row.status === 'approved' &&
    row.recognitionId !== null &&
    (row.recognitionSource === 'record' ||
      row.recognitionSource === 'import' ||
      row.recognitionSource === 'redetermination')
  ) {
    return {
      target: { kind: 'recognition', recognitionId: row.recognitionId },
      exhausted: row.recognitionAppealed,
    }
  }
  if (row.status === 'rejected' && row.eventId !== null && row.eventKind === 'approval-revoked') {
    return {
      target: { kind: 'revocation', eventId: row.eventId },
      exhausted: row.eventAppealed,
    }
  }
  return null
}

/** the conclusions of these claims, by entry id; claims standing on none are absent */
export const conclusionsOf = (tenantId: string, entryIds: readonly string[]) =>
  entryIds.length === 0
    ? Effect.succeed(new Map<string, Conclusion>())
    : db
        .query((k) =>
          k
            .selectFrom('Entry as e')
            .leftJoin('ReviewInstance as cr', (join) =>
              join
                .onRef('cr.tenantId', '=', 'e.tenantId')
                .onRef('cr.id', '=', 'e.currentReviewInstanceId'),
            )
            .leftJoin('EntryRecognition as rec', (join) =>
              join
                .onRef('rec.tenantId', '=', 'e.tenantId')
                .onRef('rec.id', '=', 'e.currentRecognitionId'),
            )
            // the latest re-determination, the only entry event that is a
            // conclusion; any round opened after it moved the pointer on
            .leftJoinLateral(
              (eb) =>
                eb
                  .selectFrom('EntryEvent as ee')
                  .select(['ee.id', 'ee.kind'])
                  .whereRef('ee.tenantId', '=', 'e.tenantId')
                  .whereRef('ee.entryId', '=', 'e.id')
                  .where('ee.kind', 'in', [...REDETERMINATION_KINDS])
                  .orderBy('ee.createdAt', 'desc')
                  .orderBy('ee.id', 'desc')
                  .limit(1)
                  .as('last'),
              (join) => join.onTrue(),
            )
            .select([
              'e.id as entryId',
              'e.status',
              'e.currentRevisionId',
              'cr.id as roundId',
              'cr.origin as roundOrigin',
              'cr.state as roundState',
              'cr.outcome as roundOutcome',
              'cr.revisionId as roundRevisionId',
              'rec.id as recognitionId',
              'rec.source as recognitionSource',
              'last.id as eventId',
              'last.kind as eventKind',
            ])
            .select((eb) => {
              // the root of an appeal: a round that replaced nothing
              const appealOf = () =>
                eb
                  .selectFrom('ReviewInstance as a')
                  .select('a.id')
                  .whereRef('a.tenantId', '=', 'e.tenantId')
                  .where('a.origin', '=', 'appeal')
                  .where('a.supersedesInstanceId', 'is', null)
              return [
                eb
                  .exists(appealOf().whereRef('a.appealedInstanceId', '=', 'cr.id'))
                  .as('roundAppealed'),
                eb
                  .exists(appealOf().whereRef('a.appealedRecognitionId', '=', 'rec.id'))
                  .as('recognitionAppealed'),
                eb
                  .exists(appealOf().whereRef('a.appealedEventId', '=', 'last.id'))
                  .as('eventAppealed'),
              ]
            })
            .where('e.tenantId', '=', tenantId)
            .where('e.id', 'in', [...entryIds])
            .execute(),
        )
        .pipe(
          Effect.map((rows) => {
            const found = new Map<string, Conclusion>()
            for (const row of rows) {
              const one = conclusionOf({
                entryId: String(row.entryId),
                status: String(row.status),
                currentRevisionId: row.currentRevisionId ?? null,
                roundId: row.roundId ?? null,
                roundOrigin: row.roundOrigin ?? null,
                roundState: row.roundState ?? null,
                roundOutcome: row.roundOutcome ?? null,
                roundRevisionId: row.roundRevisionId ?? null,
                recognitionId: row.recognitionId ?? null,
                recognitionSource: row.recognitionSource ?? null,
                eventId: row.eventId ?? null,
                eventKind: row.eventKind ?? null,
                roundAppealed: Boolean(row.roundAppealed),
                recognitionAppealed: Boolean(row.recognitionAppealed),
                eventAppealed: Boolean(row.eventAppealed),
              })
              if (one !== null) found.set(String(row.entryId), one)
            }
            return found
          }),
        )

/** one claim's conclusion, or null */
export const conclusionOfEntry = (tenantId: string, entryId: string) =>
  Effect.map(conclusionsOf(tenantId, [entryId]), (found) => found.get(entryId) ?? null)

/** the appeal-target columns a round contesting this conclusion carries */
export const targetColumns = (target: ConclusionTarget) =>
  target.kind === 'round'
    ? { appealedInstanceId: target.instanceId }
    : target.kind === 'recognition'
      ? { appealedRecognitionId: target.recognitionId }
      : { appealedEventId: target.eventId }

/**
 * What a round that revisited a conclusion did to it, in the words the
 * rulings of 2026-09-25 give the system rather than the reviewer: upheld,
 * corrected, revoked, overturned. Derived by comparing where the claim
 * stood before the round with where the round left it; a reviewer only ever
 * said yes or no, and what it was recognised as.
 */
export type RoundEffect = 'upheld' | 'corrected' | 'revoked' | 'overturned'

export interface EffectRound {
  readonly id: string
  readonly origin: string
  readonly state: string
  readonly outcome: string | null
  readonly appealedInstanceId: string | null
  readonly appealedRecognitionId: string | null
  readonly appealedEventId: string | null
}

export interface EffectRecognition {
  readonly id: string
  readonly reviewInstanceId: string | null
  /** the canonical hash of what it determined */
  readonly hash: string
}

/** the effect of one round, or null where it revisited nothing or concluded nothing */
export const roundEffectOf = (
  round: EffectRound,
  rounds: readonly EffectRound[],
  recognitions: readonly EffectRecognition[],
): RoundEffect | null => {
  if (round.origin !== 'appeal' && round.origin !== 'reopen') return null
  if (round.state !== 'completed') return null
  if (round.outcome !== 'approved' && round.outcome !== 'rejected') return null
  const settledBy = (instanceId: string) =>
    recognitions.find((one) => one.reviewInstanceId === instanceId) ?? null
  let before: { status: 'approved' | 'rejected'; hash: string | null } | null = null
  if (round.appealedInstanceId !== null) {
    const contested = rounds.find((one) => one.id === round.appealedInstanceId)
    if (contested?.outcome === 'approved') {
      before = { status: 'approved', hash: settledBy(contested.id)?.hash ?? null }
    } else if (contested?.outcome === 'rejected') {
      before = { status: 'rejected', hash: null }
    }
  } else if (round.appealedRecognitionId !== null) {
    const contested = recognitions.find((one) => one.id === round.appealedRecognitionId)
    before = { status: 'approved', hash: contested?.hash ?? null }
  } else if (round.appealedEventId !== null) {
    before = { status: 'rejected', hash: null }
  }
  if (before === null) return null
  if (round.outcome === 'rejected') return before.status === 'approved' ? 'revoked' : 'upheld'
  if (before.status === 'rejected') return 'overturned'
  const after = settledBy(round.id)
  return after !== null && before.hash !== null && after.hash === before.hash
    ? 'upheld'
    : 'corrected'
}
