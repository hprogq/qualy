import { Effect } from 'effect'
import { transaction, type Orm } from '@qualy/plugin-database/server'
import {
  ScoringRuntimeCatalog,
  type CalculatorRuntimeError,
  type PreparedCalculator,
} from '../plugin.ts'
import type { Principal } from '@qualy/rbac-contract'
import type { AccessDenied } from '@qualy/rbac-contract/effect'
import { BatchNotFound, ParticipantNotFound } from '../server/errors.ts'
import { oneBatch } from '../server/db.ts'
import { groupsOf, itemsOf, revisionsByIdOf } from '../item/db.ts'
import {
  calcParticipant,
  type Breakdown,
  type ScoreInput,
  type ScoreInputEntry,
  type ScoreInputItem,
} from './calc.ts'
import { evaluateEntry, type EvaluationFact } from './evaluate.ts'
import { frozenCalculatorOf, readScoringPlan } from './plan.ts'
import type { ScoringPlan } from './plan.ts'
import { participantEntries, participantRowByUser } from './db.ts'

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
  readonly itemTypes: ReadonlyMap<string, { readonly interaction: string }>
  readonly catalogs: {
    readonly aggregators: ReadonlyMap<string, { readonly kind: string }>
  }
}

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
    preparedFor: (item: {
      readonly id: string
      readonly plan: ScoringPlan
    }) => Effect.Effect<PreparedCalculator, CalculatorRuntimeError>,
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
        readonly createdAt: number
      }[]
    },
  ) =>
    Effect.gen(function* () {
      const plans = new Map(collected.items.map((item) => [item.id, item]))
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
        if (item.derived) {
          const granted = yield* evaluateEntry(yield* preparedFor(item), {
            entryId: `derived:${item.id}`,
            entryRevisionId: null,
            itemId: item.id,
            plan: item.plan,
            recognition: {},
          })
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
          // A refusal is in the account at zero; everything else - filed and
          // undecided, walked away from, or approved under a question that
          // is no longer scored - has no line and no amount. Said as one of
          // the ledger's own three standings rather than by narrowing a
          // lifecycle column, so "approved with no amount" is not a shape
          // this loop can produce at all.
          entries.push({
            ...common,
            standing: entry.status === 'rejected' ? 'refused' : 'unscored',
          })
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
        const evaluated = yield* evaluateEntry(yield* preparedFor(item), fact)
        entries.push({
          ...common,
          standing: 'counted',
          recognitionId: entry.recognitionId,
          amount: evaluated.amount,
        })
      }
      return { groups: collected.groups, items, entries } satisfies ScoreInput
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
          const collected = yield* collectParticipantScoreInput(tenantId, batchId, participant.id)
          // One prepared calculator per item, resolved lazily and only on
          // the paths that actually run arithmetic: an inactive question, or
          // an active one with nothing approved, prepares nothing - a
          // question whose runtime fact cannot be prepared must not be able
          // to take down a page it never contributes to. The cache is
          // request-local; the loop below is sequential, so a plain map is
          // the whole synchronization story.
          const prepared = new Map<string, PreparedCalculator>()
          const preparedFor = (item: { readonly id: string; readonly plan: ScoringPlan }) =>
            Effect.gen(function* () {
              const hit = prepared.get(item.id)
              if (hit !== undefined) return hit
              const built = yield* runtime.prepare(
                item.plan.calculator.ref,
                frozenCalculatorOf(item.plan),
                { tenantId, batchId },
              )
              prepared.set(item.id, built)
              return built
            })
          // An evaluation that fails is not a state a reader can be in: the
          // configuration was proven against its calculator's contract when
          // it was saved, and the input was assembled from that same frozen
          // plan. Reaching here means the plan and the installed arithmetic
          // disagree, which is an assembly fault - it dies naming the item
          // rather than quietly scoring that question at zero.
          const input = yield* evaluateInput(preparedFor, collected).pipe(Effect.orDie)
          return { mode: 'provisional' as const, ...calcParticipant(deps.catalogs, input) }
        }).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error))),
      )
    },
  )

  return { getMyResult }
}
