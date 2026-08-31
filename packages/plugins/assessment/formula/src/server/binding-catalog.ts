import { Context, Data, Effect, Layer } from 'effect'
import { sql } from 'kysely'
import type { NormalizedAtomicSchema, NormalizedInputSchema } from '@qualy/value-schema'
import { withDatabase } from '@qualy/plugin-database/server'
import { AssessmentConfigurationAccess } from '@qualy/plugin-assessment/plugin'
import { db } from './db.ts'

// Which published versions may anchor NEW configuration in one batch - a
// read model of facts, and only facts.
//
// Deliberately no principal: whether the CALLER may modify the batch is the
// application boundary's question (the item update already authorizes its
// administrator; a picker endpoint will ask requireManage first), while
// whether this VERSION may be newly bound here is a property of the round's
// frozen boundary and the formula's owner - the calculator compiling a
// configuration holds no principal at all, by 7.0's frozen contract. And
// deliberately not the runtime store: eligibility here is about the
// function's and its owner's CURRENT state, which historical replay must
// never consult. The two answers part ways on the same row - an archived
// function still resolves, and stops being newly bindable - and that
// divergence is the point.
//
// The rule (assessment-formula design §6.8): the owner node must be an
// ancestor-or-self of EVERY management anchor. An anchor that no longer
// resolves, an owner that was deleted, an archived function, an absent
// version, a boundary with no anchors at all - each fails closed, named.

export interface BindableFormulaVersion {
  readonly versionId: string
  readonly functionId: string
  readonly functionName: string
  readonly versionNo: number
  readonly contractSha256: string
  readonly inputSchema: NormalizedInputSchema
  readonly outputSchema: NormalizedAtomicSchema
}

export type NotBindableReason =
  | 'batch-not-found'
  | 'version-not-found'
  | 'function-archived'
  | 'owner-node-missing'
  | 'outside-management-boundary'
  | 'no-management-boundary'

export class FormulaNotBindable extends Data.TaggedError('ASSESSMENT_FORMULA_NOT_BINDABLE')<{
  readonly batchId: string
  readonly versionId?: string
  readonly reason: NotBindableReason
}> {}

export class BindableFormulaCatalog extends Context.Service<
  BindableFormulaCatalog,
  {
    readonly listForBatch: (
      tenantId: string,
      batchId: string,
    ) => Effect.Effect<readonly BindableFormulaVersion[], FormulaNotBindable>
    readonly requireBindable: (
      tenantId: string,
      batchId: string,
      versionId: string,
    ) => Effect.Effect<BindableFormulaVersion, FormulaNotBindable>
  }
>()('@qualy/plugin-assessment-formula/BindableFormulaCatalog') {}

/** every anchor resolves against the live tree AND sits under the owner */
const coversEveryAnchor = (tenantId: string, anchors: readonly string[]) =>
  sql<boolean>`not exists (
    select 1 from unnest(${anchors}::uuid[]) as anchor(id)
    left join org_nodes an on an.tenant_id = ${tenantId} and an.id = anchor.id
    where an.id is null or not (owner.path @> an.path)
  )`

interface CandidateRow {
  readonly versionId: string
  readonly functionId: string
  readonly functionName: string
  readonly versionNo: number
  readonly contractSha256: string
  readonly inputSchema: unknown
  readonly outputSchema: unknown
}

const toBindable = (row: CandidateRow): BindableFormulaVersion => ({
  versionId: row.versionId,
  functionId: row.functionId,
  functionName: row.functionName,
  versionNo: Number(row.versionNo),
  contractSha256: row.contractSha256,
  inputSchema: row.inputSchema as NormalizedInputSchema,
  outputSchema: row.outputSchema as NormalizedAtomicSchema,
})

export const make = Effect.fn('BindableFormulaCatalog.make')(function* () {
  const database = yield* withDatabase
  const access = yield* AssessmentConfigurationAccess

  const anchorsOf = (tenantId: string, batchId: string) =>
    access.boundary(tenantId, batchId).pipe(
      Effect.mapError(() => new FormulaNotBindable({ batchId, reason: 'batch-not-found' })),
      Effect.flatMap(({ managementAnchors }) =>
        managementAnchors.length === 0
          ? // an empty boundary would make the for-all rule vacuously true
            // for EVERY owner - fail closed instead, by its own name
            Effect.fail(new FormulaNotBindable({ batchId, reason: 'no-management-boundary' }))
          : Effect.succeed(managementAnchors),
      ),
    )

  return BindableFormulaCatalog.of({
    listForBatch: (tenantId, batchId) =>
      Effect.gen(function* () {
        const anchors = yield* anchorsOf(tenantId, batchId)
        const rows = yield* database(
          db.query((k) =>
            k
              .selectFrom('FormulaVersion as v')
              .innerJoin('FormulaFunction as f', (join) =>
                join.onRef('f.tenantId', '=', 'v.tenantId').onRef('f.id', '=', 'v.functionId'),
              )
              .innerJoin('OrgNode as owner', (join) =>
                join
                  .onRef('owner.tenantId', '=', 'f.tenantId')
                  .onRef('owner.id', '=', 'f.ownerNodeId'),
              )
              .select([
                'v.id as versionId',
                'v.functionId as functionId',
                'f.name as functionName',
                'v.versionNo as versionNo',
                'v.contractSha256 as contractSha256',
                'v.inputSchema as inputSchema',
                'v.outputSchema as outputSchema',
              ])
              .where('v.tenantId', '=', tenantId)
              .where('f.archivedAt', 'is', null)
              .where(coversEveryAnchor(tenantId, anchors))
              .orderBy('f.name')
              .orderBy('v.versionNo', 'desc')
              .execute(),
          ),
        ).pipe(Effect.orDie)
        return (rows as unknown as CandidateRow[]).map(toBindable)
      }),

    requireBindable: (tenantId, batchId, versionId) =>
      Effect.gen(function* () {
        const anchors = yield* anchorsOf(tenantId, batchId)
        // full state first, judged step by step - the list's "only what
        // qualifies" filter would collapse every distinct refusal into
        // version-not-found and the reasons would mean nothing
        const row = yield* database(
          db.query((k) =>
            k
              .selectFrom('FormulaVersion as v')
              .innerJoin('FormulaFunction as f', (join) =>
                join.onRef('f.tenantId', '=', 'v.tenantId').onRef('f.id', '=', 'v.functionId'),
              )
              .leftJoin('OrgNode as owner', (join) =>
                join
                  .onRef('owner.tenantId', '=', 'f.tenantId')
                  .onRef('owner.id', '=', 'f.ownerNodeId'),
              )
              .select([
                'v.id as versionId',
                'v.functionId as functionId',
                'f.name as functionName',
                'v.versionNo as versionNo',
                'v.contractSha256 as contractSha256',
                'v.inputSchema as inputSchema',
                'v.outputSchema as outputSchema',
                'f.archivedAt as archivedAt',
                'owner.id as ownerId',
                sql<boolean>`case when owner.id is null then false else ${coversEveryAnchor(tenantId, anchors)} end`.as(
                  'covers',
                ),
              ])
              .where('v.tenantId', '=', tenantId)
              .where('v.id', '=', versionId)
              .executeTakeFirst(),
          ),
        ).pipe(Effect.orDie)
        const refuse = (reason: NotBindableReason) =>
          new FormulaNotBindable({ batchId, versionId, reason })
        if (row === undefined) return yield* refuse('version-not-found')
        const state = row as unknown as CandidateRow & {
          archivedAt: unknown
          ownerId: string | null
          covers: boolean
        }
        if (state.archivedAt !== null) return yield* refuse('function-archived')
        if (state.ownerId === null) return yield* refuse('owner-node-missing')
        if (state.covers !== true) return yield* refuse('outside-management-boundary')
        return toBindable(state)
      }),
  })
})

export const bindingCatalogLayer = Layer.effect(BindableFormulaCatalog, make())
