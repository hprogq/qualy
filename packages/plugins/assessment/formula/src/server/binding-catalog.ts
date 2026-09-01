import { Context, Data, Effect, Layer } from 'effect'
import { sql } from 'kysely'
import type { NormalizedAtomicSchema, NormalizedInputSchema } from '@qualy/value-schema'
import { withDatabase } from '@qualy/plugin-database/server'
import { db } from './db.ts'

// What a question may be scored by - a read model of facts, and only facts.
//
// Deliberately no principal. Two different questions used to be tangled
// here and are now apart: whether a person may create a binding at all is
// an authoring question with an actor, answered beside the compiler by the
// authoring policy; whether a version is a thing that can be bound is a
// property of rows, answered here. A caller that needs the author-scoped
// view passes an author's id as DATA - a column to filter on, not an
// identity to authorize.
//
// Deliberately not the runtime store either: what is offered here is about
// a function's CURRENT state, which historical replay must never consult.
// The two answers part ways on the same row - an archived function still
// resolves, and stops being newly bindable - and that divergence is the
// point.

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

/** one page of what an author may newly bind, oldest cursor rules apply */
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

export type NotBindableReason = 'version-not-found' | 'function-archived'

export class FormulaNotBindable extends Data.TaggedError('ASSESSMENT_FORMULA_NOT_BINDABLE')<{
  readonly versionId: string
  readonly reason: NotBindableReason
}> {}

export class BindableFormulaCatalog extends Context.Service<
  BindableFormulaCatalog,
  {
    /**
     * The published versions one author may point a question at.
     *
     * `authorUserId` is a filter, not a principal: this service authorizes
     * nobody, and its caller has already established whose list this is.
     */
    readonly listForBatch: (
      tenantId: string,
      authorUserId: string,
      page?: {
        readonly limit?: number
        readonly after?: {
          readonly functionName: string
          readonly versionNo: number
          readonly versionId: string
        }
      },
    ) => Effect.Effect<BindablePage>
    /**
     * One exact version as a question's history, not as an option.
     *
     * A question already bound to a version keeps showing it however its
     * function has changed since - so this read asks for none of that, and
     * answers separately whether the same version could still be bound
     * anew. It never proves the version is executable: that is the runtime
     * store's answer, and finally the save's.
     */
    readonly currentBinding: (
      tenantId: string,
      versionId: string,
      viewerUserId: string,
    ) => Effect.Effect<{
      readonly version: BindableFormulaVersion
      readonly bindableForNew: boolean
    } | null>
    /**
     * The facts a NEW binding needs, on rows this holds.
     *
     * Still principal-free, and it stays that way: this runs inside the
     * calculator's compile, which by the frozen contract knows nothing
     * about who is asking. What it proves is that the version exists and
     * that its function is still open to new configuration.
     */
    readonly requireBindable: (
      tenantId: string,
      versionId: string,
    ) => Effect.Effect<BindableFormulaVersion, FormulaNotBindable>
  }
>()('@qualy/plugin-assessment-formula/BindableFormulaCatalog') {}

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

  return BindableFormulaCatalog.of({
    listForBatch: (tenantId, authorUserId, page) =>
      Effect.gen(function* () {
        const size = Math.max(1, page?.limit ?? 50)
        const after = page?.after
        const rows = yield* database(
          db.query((k) => {
            let query = k
              .selectFrom('FormulaVersion as v')
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
              .where('v.tenantId', '=', tenantId)
              .where('f.createdBy', '=', authorUserId)
              .where('f.archivedAt', 'is', null)
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

    currentBinding: (tenantId, versionId, viewerUserId) =>
      Effect.gen(function* () {
        const row = yield* database(
          db.query((k) =>
            k
              .selectFrom('FormulaVersion as v')
              // the function, whatever state it is in - a version outlives
              // its function's archival, and the question bound to it keeps
              // showing it
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
              .select(['f.archivedAt as archivedAt', 'f.createdBy as createdBy'])
              .where('v.tenantId', '=', tenantId)
              .where('v.id', '=', versionId)
              .executeTakeFirst(),
          ),
        ).pipe(Effect.orDie)
        if (row === undefined) return null
        const state = row as unknown as CandidateRow & {
          archivedAt: unknown
          createdBy: string
        }
        return {
          version: toBindable(state),
          // whether THIS viewer could bind the same version afresh today: a
          // policy snapshot beside a historical fact, and nothing more
          bindableForNew: state.archivedAt === null && state.createdBy === viewerUserId,
        }
      }),

    requireBindable: (tenantId, versionId) =>
      Effect.gen(function* () {
        const refuse = (reason: NotBindableReason) => new FormulaNotBindable({ versionId, reason })
        // Judged on a row it LOCKS: this runs inside the item save's
        // transaction, and the function's liveness is read FOR SHARE, so an
        // archive serializes after the ItemRevision commit instead of
        // racing it.
        const version = yield* database(
          db.query((k) =>
            k
              .selectFrom('FormulaVersion as v')
              .select([
                'v.id as versionId',
                'v.functionId as functionId',
                'v.versionNo as versionNo',
                'v.publishedAt as publishedAt',
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
              .select(['id', 'name', 'archivedAt'])
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
        const holder = fn as unknown as { name: string; archivedAt: unknown }
        if (holder.archivedAt !== null) return yield* refuse('function-archived')
        return toBindable({ ...found, functionName: holder.name })
      }),
  })
})

export const bindingCatalogLayer = Layer.effect(BindableFormulaCatalog, make())
