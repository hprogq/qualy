import { Clock, Effect, Option } from 'effect'
import { transaction, type Orm } from '@qualy/plugin-database/server'
import { ScoringRuntimeCatalog, type PreparedCalculator } from '../plugin.ts'
import type { Principal } from '@qualy/rbac-contract'
import type { AccessDenied } from '@qualy/rbac-contract/effect'
import { hashCanonicalJson } from '@qualy/value-schema/hash'
import { MAX_ACCOUNT_EVALUATIONS } from '../api.ts'
import {
  BatchNotFound,
  ParticipantNotFound,
  ScoringAccountTooLarge,
  ScoringUnavailable,
} from '../errors.ts'
import { oneBatch, oneParticipant } from '../server/db.ts'
import { groupsOf, itemsOf, revisionsByIdOf } from '../item/db.ts'
import {
  calcParticipant,
  type Breakdown,
  type ScoreInput,
  type ScoreInputEntry,
  type ScoreInputItem,
} from './calc.ts'
import { evaluateEntry, type EvaluationFact } from './evaluate.ts'
import { countEvaluation, mapResultFailure, mapRuntimeFailure } from './failure-boundary.ts'
import { frozenCalculatorOf, readScoringPlan } from './plan.ts'
import type { ScoringPlan } from './plan.ts'
import { administrativeEntryIdsOf, participantEntries, participantRowByUser } from './db.ts'
import type { AccountReading } from '../entry/db.ts'

// The two halves of scoring, joined here and nowhere else: facts are
// gathered, amounts are evaluated against each item's frozen plan, and only
// then does the pure ledger open. Nothing in this file computes a number.
//
// Which plan an entry is scored by is the item's CURRENT revision - the
// arithmetic in force today, not the arithmetic in force the day the student
// filed. That is the behaviour this system has always had; Phase 5 moves
// where evaluation happens without moving which configuration answers.

export interface MyResultView extends Breakdown {
  readonly mode: 'provisional'
}

export interface ScoringMethods {
  /**
   * Carries the runtime catalog as an explicit requirement: the Assessment
   * service is built in the services phase, below the runtime bindings, so
   * a method that evaluates acquires the catalog when it RUNS - above the
   * runtime phase, where the composition root discharges it. Never through
   * a captured field, never through a late-bound global.
   */
  readonly getMyResult: (
    tenantId: string,
    batchId: string,
    as: Principal,
  ) => Effect.Effect<
    MyResultView,
    | BatchNotFound
    | ParticipantNotFound
    | ScoringUnavailable
    | ScoringAccountTooLarge
    | AccessDenied,
    ScoringRuntimeCatalog
  >
  /**
   * One named participant's account, for whoever administers the round.
   *
   * The same arithmetic as `getMyResult` and deliberately the same shape: a
   * participant reading their own standing and an administrator checking it
   * must not be looking at two explanations of one number. What differs is
   * only which door it comes through - a membership row of one's own there,
   * administrative reach over this roster here.
   */
  readonly getParticipantResult: (
    tenantId: string,
    batchId: string,
    participantId: string,
    as: Principal,
  ) => Effect.Effect<
    MyResultView,
    | BatchNotFound
    | ParticipantNotFound
    | ScoringUnavailable
    | ScoringAccountTooLarge
    | AccessDenied,
    ScoringRuntimeCatalog
  >
  /**
   * The current totals of a page of people, by the same arithmetic as their
   * accounts, within what one request may spend (PAGE_SCORING). The people
   * it does not reach come back deferred rather than slowing the page down;
   * a failure of one account is said on its row, not as the page's.
   */
  readonly listParticipantScores: (
    tenantId: string,
    batchId: string,
    participantIds: readonly string[],
    as: Principal,
  ) => Effect.Effect<
    readonly ParticipantScore[],
    BatchNotFound | ParticipantNotFound | AccessDenied,
    ScoringRuntimeCatalog
  >
}

export interface ScoringDeps {
  readonly withDb: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, Exclude<R, Orm>>
  /** the same visibility every batch read passes through */
  readonly requireBatchVisible: (
    tenantId: string,
    batchId: string,
    as: Principal,
  ) => Effect.Effect<void, AccessDenied>
  /**
   * The staff account's door: administrative reach over this round's
   * roster, or re-determining or recording authority over this
   * participant, and which of their claims that reader may open. The same
   * refusal whether the id names nobody or somebody out of reach.
   */
  readonly requireAccountReach: (
    as: Principal,
    tenantId: string,
    batchId: string,
    participantId: string,
  ) => Effect.Effect<AccountReading, AccessDenied>
  /**
   * The same door, asked of a page of people at once: every id has to name
   * somebody the reader may open, or the whole question is refused.
   */
  readonly requireAccountsReach: (
    as: Principal,
    tenantId: string,
    batchId: string,
    participantIds: readonly string[],
  ) => Effect.Effect<void, AccessDenied | ParticipantNotFound>
  readonly itemTypes: ReadonlyMap<string, { readonly interaction: string }>
  readonly catalogs: {
    readonly aggregators: ReadonlyMap<string, { readonly kind: string }>
  }
}

/**
 * One evaluation per distinct determination on a question: a calculator sees
 * nothing of a claim but what it was determined as, so claims determined
 * alike are one piece of arithmetic (the key the settlement proof uses too).
 */
const keyOf = (itemId: string, recognition: Record<string, unknown>) =>
  `${itemId}:${hashCanonicalJson(recognition)}`

/**
 * How many evaluations reading this account takes: one per question that
 * grants an amount on its own, and one per distinct determination among the
 * approved claims on questions in use.
 */
const evaluationsNeeded = (collected: {
  readonly items: readonly {
    readonly id: string
    readonly status: string
    readonly derived: boolean
  }[]
  readonly entries: readonly {
    readonly itemId: string
    readonly status: string
    readonly recognition: Record<string, unknown>
  }[]
}) => {
  const active = new Set(
    collected.items.filter((item) => item.status === 'active').map((item) => item.id),
  )
  const needed = new Set<string>()
  for (const item of collected.items) {
    if (item.status === 'active' && item.derived) needed.add(`derived:${item.id}`)
  }
  for (const entry of collected.entries) {
    if (entry.status === 'approved' && active.has(entry.itemId)) {
      needed.add(keyOf(entry.itemId, entry.recognition))
    }
  }
  return needed.size
}

/**
 * What one request for a page of totals may spend before it stops and hands
 * the rest back unscored: the arithmetic of a few whole accounts, and a few
 * seconds. One person asked about alone gets the ceiling of one account and a
 * longer wait, since that is the request that has to answer.
 */
export const PAGE_SCORING = { evaluations: 2 * MAX_ACCOUNT_EVALUATIONS, millis: 4_000 }
export const ONE_SCORING = { millis: 15_000 }

/** one person's current total, or why this request did not give it */
export type ParticipantScore =
  | { readonly participantId: string; readonly state: 'scored'; readonly total: string }
  | {
      readonly participantId: string
      readonly state: 'unavailable'
      readonly reason: 'scoring-unavailable' | 'account-too-large' | 'timed-out'
    }
  | { readonly participantId: string; readonly state: 'deferred' }

const unavailable = (
  participantId: string,
  reason: 'scoring-unavailable' | 'account-too-large' | 'timed-out',
): ParticipantScore => ({ participantId, state: 'unavailable', reason })

export const makeScoringMethods = (deps: ScoringDeps): ScoringMethods => {
  const { withDb } = deps

  /**
   * Every fact one participant's account is built from, as of one moment.
   *
   * Four statements, one snapshot. The default isolation would let each of
   * them see its own instant, so an administrator saving a question between
   * the second and the third produces a page assembled out of the old
   * grouping and the new arithmetic - a state the database never held. A
   * provisional total is allowed to be different a second later; it is not
   * allowed to be internally torn.
   *
   * The transaction ends before anything is evaluated: a calculator may run
   * for a while, and holding a connection open across it would put arbitrary
   * arithmetic inside a database transaction's lifetime.
   */
  const collectParticipantScoreInput = (tenantId: string, batchId: string, participantId: string) =>
    transaction(
      Effect.gen(function* () {
        const groups = yield* groupsOf(tenantId, batchId)
        const items = yield* itemsOf(tenantId, batchId)
        // by the exact revisions those items name, not by chasing the
        // pointer again: re-reading it is what let the plan come from a
        // later moment than the question it belongs to
        const revisions = yield* revisionsByIdOf(
          tenantId,
          items.flatMap((item) =>
            item.currentRevisionId === null ? [] : [item.currentRevisionId],
          ),
        )
        const entries = yield* participantEntries(tenantId, batchId, participantId)
        return { groups, items, revisions, entries }
      }),
      { isolation: 'repeatable read', readOnly: true },
    ).pipe(
      Effect.flatMap(({ groups, items, revisions, entries }) =>
        Effect.gen(function* () {
          const configured: {
            id: string
            title: string
            scoreGroupId: string
            sortOrder: number
            status: string
            createdAt: number
            plan: ScoringPlan
            derived: boolean
          }[] = []
          for (const item of items) {
            // an item that was never configured has no arithmetic and can
            // have no entries; it simply is not part of the account
            const revision =
              item.currentRevisionId === null ? undefined : revisions.get(item.currentRevisionId)
            if (revision === undefined) continue
            configured.push({
              id: item.id,
              title: item.title,
              scoreGroupId: item.scoreGroupId,
              sortOrder: item.sortOrder,
              status: item.status,
              createdAt: item.createdAt,
              plan: yield* Effect.orDie(readScoringPlan(revision)),
              derived: deps.itemTypes.get(item.itemType)?.interaction === 'derived',
            })
          }
          return {
            groups: groups.map((group) => ({
              id: group.id,
              parentGroupId: group.parentGroupId,
              name: group.name,
              cap: group.cap,
              floor: group.floor,
              sortOrder: group.sortOrder,
            })),
            items: configured,
            entries,
          }
        }),
      ),
    )

  /**
   * The plan an item revision was saved with.
   *
   * A revision saved before plans existed has none until the boot sweep
   * compiles it. Reaching one here is an operational fault, not a data
   * state, so it dies pointing at the work that fixes it rather than
   * quietly scoring the round at zero.
   */

  /**
   * Every approved entry's amount, then the ledger's own input.
   *
   * Derived questions are evaluated the same way as filed ones - an empty
   * input against the item's own plan - so there is one evaluation path, not
   * a special case that drifts.
   */
  const evaluateInput = (
    tenantId: string,
    batchId: string,
    preparedFor: (item: {
      readonly id: string
      readonly plan: ScoringPlan
    }) => Effect.Effect<PreparedCalculator, ScoringUnavailable>,
    collected: {
      readonly groups: ScoreInput['groups']
      readonly items: readonly {
        readonly id: string
        readonly title: string
        readonly scoreGroupId: string
        readonly sortOrder: number
        readonly status: string
        readonly createdAt: number
        readonly plan: ScoringPlan
        readonly derived: boolean
      }[]
      readonly entries: readonly {
        readonly id: string
        readonly itemId: string
        readonly status: string
        readonly revisionId: string | null
        readonly recognitionId: string | null
        readonly recognition: Record<string, unknown>
        /** whether it was ever put to anybody, which is what gives it a line */
        readonly wasSubmitted: boolean
        /** whether it went with its question, which takes that line away again */
        readonly voidedWithItem: boolean
        /** who wrote it: the participant, or the office (record / import) */
        readonly source: string
        readonly createdAt: number
      }[]
    },
  ) =>
    Effect.gen(function* () {
      const plans = new Map(collected.items.map((item) => [item.id, item]))
      // Counted before anything runs, so an account past the ceiling is
      // refused whole rather than scored in part.
      const needed = evaluationsNeeded(collected)
      if (needed > MAX_ACCOUNT_EVALUATIONS) {
        return yield* new ScoringAccountTooLarge({
          evaluations: needed,
          limit: MAX_ACCOUNT_EVALUATIONS,
        })
      }
      const evaluatedAmounts = new Map<string, bigint>()
      const items: ScoreInputItem[] = []
      for (const item of collected.items) {
        const common = {
          id: item.id,
          title: item.title,
          scoreGroupId: item.scoreGroupId,
          sortOrder: item.sortOrder,
          createdAt: item.createdAt,
          calculatorRef: item.plan.calculator.ref,
          aggregator: item.plan.aggregator,
        }
        // a question nobody can score by is not evaluated: a draft or voided
        // question never reaches the arithmetic, and its own plan is never
        // read (the ledger prints what it must from the item alone)
        if (item.status !== 'active') {
          items.push({ ...common, standing: item.status === 'draft' ? 'unpublished' : 'withdrawn' })
          continue
        }
        // Whatever a calculator says here that is not an amount is sorted
        // at the boundary of reading an account: an outage is one to
        // retry, and everything else - a refusal included - is a state this
        // process should never have allowed to stand, and dies naming the
        // question rather than scoring it at nothing.
        const at = { tenantId, batchId, itemId: item.id, plan: item.plan }
        if (item.derived) {
          const granted = yield* evaluateEntry(yield* preparedFor(item), {
            entryId: `derived:${item.id}`,
            entryRevisionId: null,
            itemId: item.id,
            plan: item.plan,
            recognition: {},
          }).pipe(
            countEvaluation('result'),
            Effect.catch((error) => mapResultFailure(at, error)),
          )
          items.push({ ...common, standing: 'granted', derivedAmount: granted.amount })
          continue
        }
        items.push({ ...common, standing: 'scored' })
      }
      const entries: ScoreInputEntry[] = []
      for (const entry of collected.entries) {
        const item = plans.get(entry.itemId)
        const common = {
          id: entry.id,
          itemId: entry.itemId,
          revisionId: entry.revisionId,
          createdAt: entry.createdAt,
        }
        if (entry.status !== 'approved' || item === undefined || item.status !== 'active') {
          // A claim that was put to somebody and is no longer counted stays
          // in the account at zero (§32.30): a refusal, and equally a claim
          // the office withdrew afterwards - both need a line to appeal
          // from, and an absence is nothing to anchor on. Everything else -
          // never submitted, still undecided, or under a question that is
          // no longer scored at all - has no line and no amount; a question
          // that was withdrawn carries its own line instead of one per
          // claim. Said as one of the ledger's own three standings rather
          // than by narrowing a lifecycle column, so "approved with no
          // amount" is not a shape this loop can produce at all. A claim
          // cancelled because its question was withdrawn has no line either,
          // even once the question is restored: nobody refused it, and the
          // question's own withdrawal is what there was to answer for.
          //
          // A fact the office recorded and then revoked keeps a line too
          // (ruling of 2026-09-25 #25): it was never submitted, but it was
          // in force - counted, and appealable - so taking it back is part
          // of the account, said as revoked rather than as a score of zero.
          const recorded = entry.source === 'record' || entry.source === 'import'
          const revoked = entry.status === 'voided' && !entry.voidedWithItem && recorded
          const excluded =
            item !== undefined &&
            item.status === 'active' &&
            (entry.status === 'rejected' ||
              revoked ||
              (entry.status === 'voided' && entry.wasSubmitted && !entry.voidedWithItem))
          entries.push(
            excluded
              ? { ...common, standing: 'excluded', revoked }
              : { ...common, standing: 'unscored' },
          )
          continue
        }
        // the table refuses an approved claim without a determination, so
        // one here is a broken invariant rather than a value to fall back
        // from - scoring it as if it had been recognised as nothing would
        // hide exactly the row somebody needs to find
        if (entry.recognitionId === null) {
          throw new Error(
            `entry ${entry.id} is approved with no recognition; the claim and what it was recognised as have come apart`,
          )
        }
        const fact: EvaluationFact = {
          entryId: entry.id,
          entryRevisionId: entry.revisionId,
          itemId: entry.itemId,
          plan: item.plan,
          // what the institution determined, which is the only thing a
          // calculator ever sees of this claim
          recognition: entry.recognition,
        }
        const key = keyOf(entry.itemId, entry.recognition)
        let amount = evaluatedAmounts.get(key)
        if (amount === undefined) {
          const evaluated = yield* evaluateEntry(yield* preparedFor(item), fact).pipe(
            countEvaluation('result'),
            Effect.catch((error) =>
              mapResultFailure({ tenantId, batchId, itemId: item.id, plan: item.plan }, error),
            ),
          )
          amount = evaluated.amount
          evaluatedAmounts.set(key, amount)
        }
        entries.push({
          ...common,
          standing: 'counted',
          recognitionId: entry.recognitionId,
          amount,
        })
      }
      return { groups: collected.groups, items, entries } satisfies ScoreInput
    })

  /**
   * One participant's account, once the reader has been let in.
   *
   * Both doors end here, and that is the point: the number a participant
   * reads and the number an administrator checks are produced by one piece
   * of arithmetic, so there is no second explanation of the same total to
   * drift from the first. The doors differ and nothing after them does.
   */
  const accountOf = (
    tenantId: string,
    batchId: string,
    participantId: string,
    runtime: typeof ScoringRuntimeCatalog.Service,
  ) =>
    Effect.flatMap(collectParticipantScoreInput(tenantId, batchId, participantId), (collected) =>
      accountFrom(tenantId, batchId, runtime, collected),
    )

  /** the arithmetic half of `accountOf`, once the facts are in hand */
  const accountFrom = (
    tenantId: string,
    batchId: string,
    runtime: typeof ScoringRuntimeCatalog.Service,
    collected: Effect.Success<ReturnType<typeof collectParticipantScoreInput>>,
  ) =>
    Effect.gen(function* () {
      // One prepared calculator per item, resolved lazily and only on the
      // paths that actually run arithmetic: an inactive question, or an
      // active one with nothing approved, prepares nothing - a question
      // whose runtime fact cannot be prepared must not be able to take down
      // a page it never contributes to. The cache is request-local; the loop
      // below is sequential, so a plain map is the whole synchronization
      // story.
      const prepared = new Map<string, PreparedCalculator>()
      const preparedFor = (item: { readonly id: string; readonly plan: ScoringPlan }) =>
        Effect.gen(function* () {
          const hit = prepared.get(item.id)
          if (hit !== undefined) return hit
          const built = yield* runtime
            .prepare(item.plan.calculator.ref, frozenCalculatorOf(item.plan), {
              tenantId,
              batchId,
            })
            .pipe(
              Effect.catch((error) =>
                mapRuntimeFailure(
                  'result',
                  { tenantId, batchId, itemId: item.id, plan: item.plan },
                  error,
                ),
              ),
            )
          prepared.set(item.id, built)
          return built
        })
      // An evaluation that fails is not a state a reader can be in: every
      // determination in force was proven against the rule before it stood,
      // and the rule was tried against them before it took effect. So only
      // an outage is anybody's to retry - it is said as one, and the whole
      // account waits for it rather than printing part of one - and anything
      // else dies naming the question rather than quietly scoring it at zero.
      const input = yield* evaluateInput(tenantId, batchId, preparedFor, collected)
      return { mode: 'provisional' as const, ...calcParticipant(deps.catalogs, input) }
    })

  const getMyResult: ScoringMethods['getMyResult'] = Effect.fn('Assessment.getMyResult')(
    function* (tenantId, batchId, as) {
      const runtime = yield* ScoringRuntimeCatalog
      return yield* withDb(
        Effect.gen(function* () {
          const batch = yield* oneBatch(tenantId, batchId)
          if (!batch) return yield* new BatchNotFound()
          // the same visibility as every other read of the round: a member
          // is told about it when it begins, and keeps it once archived. The
          // membership row then keeps its historical standing - excluded
          // members still read the round they took part in - but a row alone
          // never opens a round that has not begun.
          yield* deps.requireBatchVisible(tenantId, batchId, as)
          const participant = yield* participantRowByUser(tenantId, batchId, as.userId)
          if (participant === null) return yield* new ParticipantNotFound()
          return yield* accountOf(tenantId, batchId, participant.id, runtime)
        }).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error))),
      )
    },
  )

  /**
   * An account as read by somebody who may open only some of its claims.
   *
   * Every line and amount stays - the total is the account's, not the
   * reader's - but a line no longer points at a claim this reader could not
   * open, so the ledger offers no way through that answers with a refusal.
   */
  const linkingOnly = (account: MyResultView, openable: ReadonlySet<string>): MyResultView => ({
    ...account,
    lines: account.lines.map((line) => {
      const { provenance, ...rest } = line
      if (provenance?.entryId === undefined || openable.has(provenance.entryId)) return line
      return provenance.calculatorRef === undefined
        ? rest
        : { ...rest, provenance: { calculatorRef: provenance.calculatorRef } }
    }),
  })

  const getParticipantResult: ScoringMethods['getParticipantResult'] = Effect.fn(
    'Assessment.getParticipantResult',
  )(function* (tenantId, batchId, participantId, as) {
    const runtime = yield* ScoringRuntimeCatalog
    return yield* withDb(
      Effect.gen(function* () {
        const batch = yield* oneBatch(tenantId, batchId)
        if (!batch) return yield* new BatchNotFound()
        // Administering this roster, or re-determining or recording over
        // this person, is the whole authorization: a reader without any of
        // them learns nothing about who is on somebody else's roster, not
        // even whether the id they guessed is one.
        const reading = yield* deps.requireAccountReach(as, tenantId, batchId, participantId)
        // scoped to this batch by the query itself, so an id from another
        // round reads as no such participant rather than as somebody else's
        const participant = yield* oneParticipant(tenantId, batchId, participantId)
        if (participant === null) return yield* new ParticipantNotFound()
        const account = yield* accountOf(tenantId, batchId, participant.id, runtime)
        if (reading === 'whole') return account
        return linkingOnly(account, yield* administrativeEntryIdsOf(tenantId, participant.id))
      }).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error))),
    )
  })

  const listParticipantScores: ScoringMethods['listParticipantScores'] = Effect.fn(
    'Assessment.listParticipantScores',
  )(function* (tenantId, batchId, participantIds, as) {
    const runtime = yield* ScoringRuntimeCatalog
    return yield* withDb(
      Effect.gen(function* () {
        const batch = yield* oneBatch(tenantId, batchId)
        if (!batch) return yield* new BatchNotFound()
        const wanted = [...new Set(participantIds)]
        yield* deps.requireAccountsReach(as, tenantId, batchId, wanted)
        const alone = wanted.length === 1
        const deadline =
          (yield* Clock.currentTimeMillis) + (alone ? ONE_SCORING.millis : PAGE_SCORING.millis)
        let spent = 0
        let stopped = false
        const scores: ParticipantScore[] = []
        // One account at a time, in the page's own order, so the people
        // somebody sees first are the ones scored first when the page runs
        // out of room.
        for (const participantId of wanted) {
          const now = yield* Clock.currentTimeMillis
          if (stopped || now >= deadline) {
            stopped = true
            scores.push({ participantId, state: 'deferred' })
            continue
          }
          // null: this person does not fit in what the page has left
          const measure = Effect.gen(function* () {
            const collected = yield* collectParticipantScoreInput(tenantId, batchId, participantId)
            const needed = evaluationsNeeded(collected)
            if (needed > MAX_ACCOUNT_EVALUATIONS) {
              return unavailable(participantId, 'account-too-large')
            }
            // the first account always fits: the page may spend more than
            // one account's ceiling
            if (!alone && spent + needed > PAGE_SCORING.evaluations) return null
            spent += needed
            const account = yield* accountFrom(tenantId, batchId, runtime, collected)
            const scored: ParticipantScore = {
              participantId,
              state: 'scored',
              total: account.total,
            }
            return scored
          })
          const outcome = yield* measure.pipe(
            // An outage is every account's, so the page stops asking rather
            // than waiting on the same refusal once per person. What is past
            // the ceiling is this account's alone and said on its row; the
            // arithmetic cannot be allowed to decide the account is smaller
            // than it is.
            Effect.catchTags({
              ASSESSMENT_SCORING_UNAVAILABLE: () =>
                Effect.succeed(unavailable(participantId, 'scoring-unavailable')),
              ASSESSMENT_SCORING_ACCOUNT_TOO_LARGE: () =>
                Effect.succeed(unavailable(participantId, 'account-too-large')),
            }),
            Effect.timeoutOption(deadline - now),
          )
          if (Option.isNone(outcome)) {
            // Out of time part-way through this one. Asked about alone, the
            // time was all this person's, and that is the answer; on a page,
            // the rest of the page is simply not reached.
            stopped = true
            scores.push(
              alone
                ? unavailable(participantId, 'timed-out')
                : { participantId, state: 'deferred' },
            )
            continue
          }
          if (outcome.value === null) {
            stopped = true
            scores.push({ participantId, state: 'deferred' })
            continue
          }
          if (
            outcome.value.state === 'unavailable' &&
            outcome.value.reason === 'scoring-unavailable'
          ) {
            stopped = true
          }
          scores.push(outcome.value)
        }
        return scores
      }).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error))),
    )
  })

  return { getMyResult, getParticipantResult, listParticipantScores }
}
