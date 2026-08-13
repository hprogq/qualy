import { Effect } from 'effect'
import type { Orm } from '@qualy/plugin-database/server'
import type { Principal } from '@qualy/rbac-contract'
import type { AccessDenied } from '@qualy/rbac-contract/effect'
import { BatchNotFound, ParticipantNotFound } from '../server/errors.ts'
import { oneBatch } from '../server/db.ts'
import { groupsOf, itemsOf, revisionsOf } from '../item/db.ts'
import { calcParticipant, type Breakdown, type ScoreInput } from './calc.ts'
import { participantEntries, participantRowByUser } from './db.ts'

// Input collection for the one scorer. This module gathers facts and shapes
// them; every number comes out of calcParticipant, nothing is computed here.
//
// In M2 the effective facts are the approved revisions' payloads verbatim
// (§32.57): a future adjudication layer changes what this collection
// returns, and may not touch the scorer behind it.

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
  readonly catalogs: {
    readonly calculators: ReadonlyMap<string, { readonly kind: string }>
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
          const scoring = revision.scoringConfig as {
            calculator: { ref: string; config: unknown }
            aggregator: { ref: string; config: unknown }
          }
          return [
            {
              id: item.id,
              title: item.title,
              scoreGroupId: item.scoreGroupId,
              sortOrder: item.sortOrder,
              status: item.status,
              createdAt: item.createdAt,
              calculator: scoring.calculator,
              aggregator: scoring.aggregator,
            },
          ]
        }),
        entries: entries.map((entry) => ({
          id: entry.id,
          itemId: entry.itemId,
          status: entry.status,
          revisionId: entry.revisionId,
          payload: entry.payload,
          createdAt: entry.createdAt,
        })),
      } satisfies ScoreInput
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
          const input = yield* collectParticipantScoreInput(tenantId, batchId, participant.id)
          return { mode: 'provisional' as const, ...calcParticipant(deps.catalogs, input) }
        }).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error))),
      )
    },
  )

  return { getMyResult }
}
