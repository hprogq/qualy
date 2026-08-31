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
  readonly publishedAt: Date | string
  readonly contractSha256: string
  readonly inputSchema: NormalizedInputSchema
  readonly outputSchema: NormalizedAtomicSchema
}

/** one page of what a batch may newly bind, oldest cursor rules apply */
export interface BindablePage {
  readonly items: readonly BindableFormulaVersion[]
  /** the last row's ordering key, for the caller to encode */
  readonly last: {
    readonly functionName: string
    readonly versionNo: number
    readonly versionId: string
  } | null
  readonly more: boolean
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
      page?: {
        readonly limit?: number
        readonly after?: {
          readonly functionName: string
          readonly versionNo: number
          readonly versionId: string
        }
      },
    ) => Effect.Effect<BindablePage, FormulaNotBindable>
    /**
     * One exact version as this batch's history, not as an option.
     *
     * A question already bound to a version keeps showing it however its
     * function or owner has changed since - so this read asks for none of
     * that, and answers separately whether the same version could still be
     * bound anew. It never proves the version is executable: that is the
     * runtime store's answer, and finally the save's.
     */
    readonly currentBinding: (
      tenantId: string,
      batchId: string,
      versionId: string,
    ) => Effect.Effect<
      { readonly version: BindableFormulaVersion; readonly bindableForNew: boolean } | null,
      FormulaNotBindable
    >
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
  readonly publishedAt: Date | string
  readonly contractSha256: string
  readonly inputSchema: unknown
  readonly outputSchema: unknown
}

const toBindable = (row: CandidateRow): BindableFormulaVersion => ({
  versionId: row.versionId,
  functionId: row.functionId,
  functionName: row.functionName,
  versionNo: Number(row.versionNo),
  publishedAt: row.publishedAt,
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
    listForBatch: (tenantId, batchId, page) =>
      Effect.gen(function* () {
        const anchors = yield* anchorsOf(tenantId, batchId)
        const size = Math.max(1, page?.limit ?? 50)
        const after = page?.after
        const rows = yield* database(
          db.query((k) => {
            let query = k
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
                'v.publishedAt as publishedAt',
                'v.contractSha256 as contractSha256',
                'v.inputSchema as inputSchema',
                'v.outputSchema as outputSchema',
              ])
              .where('v.tenantId', '=', tenantId)
              .where('f.archivedAt', 'is', null)
              .where(coversEveryAnchor(tenantId, anchors))
            if (after !== undefined) {
              // The ordering runs in two directions - names up, versions
              // down - so a row-value comparison would be asking postgres
              // the wrong question. Spelled out per key instead, which is
              // what a mixed-direction keyset actually means. The version
              // id closes it: two functions may share a name, and without a
              // unique last key a page boundary would drop rows or repeat
              // them.
              query = query.where(
                sql<boolean>`(
                  f.name > ${after.functionName}
                  or (f.name = ${after.functionName} and v.version_no < ${after.versionNo})
                  or (f.name = ${after.functionName} and v.version_no = ${after.versionNo}
                      and v.id > ${after.versionId}::uuid)
                )`,
              )
            }
            return query
              .orderBy('f.name')
              .orderBy('v.versionNo', 'desc')
              .orderBy('v.id')
              .limit(size + 1)
              .execute()
          }),
        ).pipe(Effect.orDie)
        const all = rows as unknown as CandidateRow[]
        const items = all.slice(0, size).map(toBindable)
        const tail = items[items.length - 1]
        return {
          items,
          last:
            tail === undefined
              ? null
              : {
                  functionName: tail.functionName,
                  versionNo: tail.versionNo,
                  versionId: tail.versionId,
                },
          more: all.length > size,
        }
      }),

    currentBinding: (tenantId, batchId, versionId) =>
      Effect.gen(function* () {
        // the anchors are read first for the same reason every other read
        // here does: a batch with no boundary can bind nothing, and saying
        // so is not the same as saying the version does not exist
        const anchors = yield* anchorsOf(tenantId, batchId)
        const row = yield* database(
          db.query((k) =>
            k
              .selectFrom('FormulaVersion as v')
              // the function, whatever state it is in - a version outlives
              // its function's archival, and the question bound to it keeps
              // showing it. No owner join at all: a deleted owner node is
              // exactly one of the histories this read exists to survive.
              .innerJoin('FormulaFunction as f', (join) =>
                join.onRef('f.tenantId', '=', 'v.tenantId').onRef('f.id', '=', 'v.functionId'),
              )
              .select([
                'v.id as versionId',
                'v.functionId as functionId',
                'f.name as functionName',
                'v.versionNo as versionNo',
                'v.publishedAt as publishedAt',
                'v.contractSha256 as contractSha256',
                'v.inputSchema as inputSchema',
                'v.outputSchema as outputSchema',
              ])
              .select(['f.archivedAt as archivedAt', 'f.ownerNodeId as ownerNodeId'])
              .where('v.tenantId', '=', tenantId)
              .where('v.id', '=', versionId)
              .executeTakeFirst(),
          ),
        ).pipe(Effect.orDie)
        if (row === undefined) return null
        const state = row as unknown as CandidateRow & {
          archivedAt: unknown
          ownerNodeId: string
        }
        // whether the SAME version could be bound afresh today, which is a
        // policy snapshot and nothing more
        const covers = yield* database(
          db.query((k) =>
            k
              .selectFrom('OrgNode as owner')
              .select(['owner.id as id'])
              .where('owner.tenantId', '=', tenantId)
              .where('owner.id', '=', state.ownerNodeId)
              .where(coversEveryAnchor(tenantId, anchors))
              .executeTakeFirst(),
          ),
        ).pipe(Effect.orDie)
        return {
          version: toBindable(state),
          bindableForNew: state.archivedAt === null && covers !== undefined,
        }
      }),

    requireBindable: (tenantId, batchId, versionId) =>
      Effect.gen(function* () {
        const anchors = yield* anchorsOf(tenantId, batchId)
        const refuse = (reason: NotBindableReason) =>
          new FormulaNotBindable({ batchId, versionId, reason })
        // A writer's eligibility check, judged step by step on ROWS IT
        // LOCKS: this runs inside the item save's transaction (the batch
        // row is already held FOR UPDATE), and every fact the yes depends
        // on - the function's liveness and owner, the owner's and every
        // anchor's place in the tree - is read under FOR SHARE, so an
        // archive or an org move serializes after the ItemRevision commit
        // instead of racing it. The anchor SET itself is creation-frozen
        // with the batch (its one writer runs in createBatch, under the
        // same batch lock), so the batch lock stabilizes the set and the
        // node rows stabilize the facts. The lock order is fixed: batch,
        // then function, then org nodes in UUID order.
        const version = yield* database(
          db.query((k) =>
            k
              .selectFrom('FormulaVersion as v')
              .select([
                'v.id as versionId',
                'v.functionId as functionId',
                'v.versionNo as versionNo',
                'v.contractSha256 as contractSha256',
                'v.inputSchema as inputSchema',
                'v.outputSchema as outputSchema',
              ])
              .where('v.tenantId', '=', tenantId)
              .where('v.id', '=', versionId)
              .executeTakeFirst(),
          ),
        ).pipe(Effect.orDie)
        if (version === undefined) return yield* refuse('version-not-found')
        const found = version as unknown as Omit<CandidateRow, 'functionName'>
        const fn = yield* database(
          db.query((k) =>
            k
              .selectFrom('FormulaFunction')
              .select(['id', 'name', 'archivedAt', 'ownerNodeId'])
              .where('tenantId', '=', tenantId)
              .where('id', '=', found.functionId)
              .forShare()
              .executeTakeFirst(),
          ),
        ).pipe(Effect.orDie)
        if (fn === undefined) {
          // the version row references it under RESTRICT; absence is a
          // broken invariant, not a state this catalog explains
          return yield* Effect.die(new Error('a formula version outlived its function'))
        }
        const holder = fn as unknown as {
          name: string
          archivedAt: unknown
          ownerNodeId: string
        }
        if (holder.archivedAt !== null) return yield* refuse('function-archived')
        const nodeIds = [...new Set([holder.ownerNodeId, ...anchors])].sort()
        const nodes = yield* database(
          db.query((k) =>
            k
              .selectFrom('OrgNode')
              .select(['id', sql<string>`path::text`.as('path')])
              .where('tenantId', '=', tenantId)
              .where('id', 'in', nodeIds)
              .orderBy('id')
              .forShare()
              .execute(),
          ),
        ).pipe(Effect.orDie)
        const pathOf = new Map(
          (nodes as unknown as readonly { id: string; path: string }[]).map((node) => [
            node.id,
            node.path,
          ]),
        )
        const ownerPath = pathOf.get(holder.ownerNodeId)
        if (ownerPath === undefined) return yield* refuse('owner-node-missing')
        // ancestor-or-self, proven on the locked rows: ltree labels never
        // contain a dot, so prefix-by-label is exactly @>
        const covers = (anchorPath: string) =>
          anchorPath === ownerPath || anchorPath.startsWith(`${ownerPath}.`)
        for (const anchor of anchors) {
          const anchorPath = pathOf.get(anchor)
          if (anchorPath === undefined || !covers(anchorPath)) {
            return yield* refuse('outside-management-boundary')
          }
        }
        return toBindable({ ...found, functionName: holder.name })
      }),
  })
})

export const bindingCatalogLayer = Layer.effect(BindableFormulaCatalog, make())
