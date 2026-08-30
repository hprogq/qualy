import { Effect } from 'effect'
import type { Orm } from '@qualy/plugin-database/server'
import type { ScoringDriver } from '../plugin.ts'
import type { Principal } from '@qualy/rbac-contract'
import type { AccessDenied } from '@qualy/rbac-contract/effect'
import { BatchNotFound, ParticipantNotFound } from '../server/errors.ts'
import { oneBatch } from '../server/db.ts'
import { groupsOf, itemsOf, revisionsOf } from '../item/db.ts'
import { calcParticipant, type Breakdown, type ScoreInput, type ScoreInputEntry } from './calc.ts'
import { evaluateEntry, type EvaluationFact } from './evaluate.ts'
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
  readonly getMyResult: (
    tenantId: string,
    batchId: string,
    as: Principal,
  ) => Effect.Effect<MyResultView, BatchNotFound | ParticipantNotFound | AccessDenied>
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
    readonly calculators: ReadonlyMap<string, ScoringDriver>
    readonly aggregators: ReadonlyMap<string, { readonly kind: string }>
  }
}

export const makeScoringMethods = (deps: ScoringDeps): ScoringMethods => {
  const { withDb } = deps

  const collectParticipantScoreInput = (tenantId: string, batchId: string, participantId: string) =>
    Effect.gen(function* () {
      const groups = yield* groupsOf(tenantId, batchId)
      const items = yield* itemsOf(tenantId, batchId)
      const revisions = yield* revisionsOf(
        tenantId,
        items.map((item) => item.id),
      )
      const entries = yield* participantEntries(tenantId, batchId, participantId)
      return {
        groups: groups.map((group) => ({
          id: group.id,
          parentGroupId: group.parentGroupId,
          name: group.name,
          cap: group.cap,
          floor: group.floor,
          sortOrder: group.sortOrder,
        })),
        items: items.flatMap((item) => {
          const revision = revisions.get(item.id)
          // an item that was never configured has no arithmetic and can have
          // no entries; it simply is not part of the account
          if (revision === undefined) return []
          return [
            {
              id: item.id,
              title: item.title,
              scoreGroupId: item.scoreGroupId,
              sortOrder: item.sortOrder,
              status: item.status,
              createdAt: item.createdAt,
              plan: planOf(revision),
              derived: deps.itemTypes.get(item.itemType)?.interaction === 'derived',
            },
          ]
        }),
        entries,
      }
    })

  /**
   * The plan an item revision was saved with.
   *
   * A revision saved before plans existed has none until the boot sweep
   * compiles it. Reaching one here is an operational fault, not a data
   * state, so it dies pointing at the work that fixes it rather than
   * quietly scoring the round at zero.
   */
  const planOf = (revision: { readonly id: string; readonly scoringPlan: unknown }): ScoringPlan => {
    if (revision.scoringPlan === null || typeof revision.scoringPlan !== 'object') {
      throw new Error(
        `item revision ${revision.id} has no compiled scoring plan; the assembly's boot backfill has not run`,
      )
    }
    return revision.scoringPlan as ScoringPlan
  }

  /**
   * Every approved entry's amount, then the ledger's own input.
   *
   * Derived questions are evaluated the same way as filed ones - an empty
   * input against the item's own plan - so there is one evaluation path, not
   * a special case that drifts.
   */
  const evaluateInput = (collected: {
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
      readonly createdAt: number
    }[]
  }) =>
    Effect.gen(function* () {
      const plans = new Map(collected.items.map((item) => [item.id, item]))
      const items: ScoreInput['items'][number][] = []
      for (const item of collected.items) {
        // a question nobody can score by is not evaluated: a draft or voided
        // question never reaches the arithmetic, and its own plan is never
        // read (the ledger prints what it must from the item alone)
        const scorable = item.status === 'active'
        const derivedAmount =
          scorable && item.derived
            ? (yield* evaluateEntry(deps.catalogs.calculators, {
                entryId: `derived:${item.id}`,
                entryRevisionId: null,
                itemId: item.id,
                plan: item.plan,
                recognition: {},
              })).amount
            : undefined
        items.push({
          id: item.id,
          title: item.title,
          scoreGroupId: item.scoreGroupId,
          sortOrder: item.sortOrder,
          status: item.status,
          createdAt: item.createdAt,
          calculatorRef: item.plan.calculator.ref,
          aggregator: item.plan.aggregator,
          ...(item.derived ? { derived: true } : {}),
          ...(derivedAmount === undefined ? {} : { derivedAmount }),
        })
      }
      const entries: ScoreInputEntry[] = []
      for (const entry of collected.entries) {
        const item = plans.get(entry.itemId)
        if (entry.status !== 'approved' || item === undefined || item.status !== 'active') {
          entries.push({
            id: entry.id,
            itemId: entry.itemId,
            status: entry.status as Exclude<ScoreInputEntry['status'], 'approved'>,
            revisionId: entry.revisionId,
            createdAt: entry.createdAt,
          })
          continue
        }
        const fact: EvaluationFact = {
          entryId: entry.id,
          entryRevisionId: entry.revisionId,
          itemId: entry.itemId,
          plan: item.plan,
          recognition: {},
        }
        const evaluated = yield* evaluateEntry(deps.catalogs.calculators, fact)
        entries.push({
          id: entry.id,
          itemId: entry.itemId,
          status: 'approved',
          revisionId: entry.revisionId,
          createdAt: entry.createdAt,
          amount: evaluated.amount,
        })
      }
      return { groups: collected.groups, items, entries } satisfies ScoreInput
    })

  const getMyResult: ScoringMethods['getMyResult'] = Effect.fn('Assessment.getMyResult')(
    function* (tenantId, batchId, as) {
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
          // An evaluation that fails is not a state a reader can be in: the
          // configuration was proven against its calculator's contract when
          // it was saved, and the input was assembled from that same frozen
          // plan. Reaching here means the plan and the installed arithmetic
          // disagree, which is an assembly fault - it dies naming the item
          // rather than quietly scoring that question at zero.
          const input = yield* evaluateInput(collected).pipe(Effect.orDie)
          return { mode: 'provisional' as const, ...calcParticipant(deps.catalogs, input) }
        }).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error))),
      )
    },
  )

  return { getMyResult }
}
