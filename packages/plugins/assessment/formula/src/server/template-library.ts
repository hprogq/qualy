/**
 * Who a published formula has been offered to, and who may offer it.
 *
 * Separate from `FormulaLibrary` on purpose. That service means one thing -
 * my private, mutable functions - and its every read is hard-scoped to the
 * author. This one is about the audience a published version carries: rows
 * that say "everybody standing here or under here may find this and copy
 * it", and nothing about who may run anything.
 *
 * Sharing is an authoring act on a version the caller wrote, so ownership
 * is the gate. Archival is NOT: a function whose author archived it stops
 * being offered for new configuration, but the versions it published keep
 * whatever audience they were given, and taking that audience back is
 * exactly the act this service exists for. Refusing it because the function
 * is archived would leave an author unable to stop distributing something.
 */

import { Effect, Layer, Context } from 'effect'
import { createHash } from 'node:crypto'
import { sql, type RawBuilder } from 'kysely'
import { transaction, withDatabase } from '@qualy/plugin-database/server'
import { Rbac } from '@qualy/rbac-contract/effect'
import { scopeCoverage } from '@qualy/rbac-contract'
import { AccessDenied } from '@qualy/rbac-contract/effect'
import { BadRequest } from '@qualy/api-kit/schema'
import type { Principal } from '@qualy/rbac-contract'
import { Audit } from '@qualy/audit-contract/effect'
import { db } from './db.ts'
import { FormulaTemplateCopied, FormulaVersionSharingChanged } from '../actions.ts'
import { SOURCE_LIMIT } from '@qualy/sandbox-rpc'
import {
  FormulaFunctionNotFound,
  FormulaSharingConflict,
  FormulaSourceTooLarge,
  FormulaTemplateNotFound,
  FormulaVersionNotFound,
} from './errors.ts'

/** the one spelling of the audience-widening permission */
export const SHARE = 'assessment.formula.share'

export interface SharedScope {
  readonly orgNodeId: string
  readonly name: string
}

export interface VersionSharing {
  readonly scopes: readonly SharedScope[]
  /**
   * What the audience looked like when it was read.
   *
   * Derived from the scope set rather than stored, because the row it
   * belongs to is immutable: a published version must not grow a mutable
   * column so that two screens can take turns editing something beside it.
   */
  readonly token: string
}

/** the audience, as a value two readers can compare */
export const sharingToken = (orgNodeIds: readonly string[]): string =>
  createHash('sha256')
    .update([...orgNodeIds].sort().join('\n'), 'utf8')
    .digest('hex')

export interface TemplateSummary {
  readonly versionId: string
  readonly functionId: string
  readonly functionName: string
  readonly description: string | null
  readonly versionNo: number
  readonly publishedAt: Date | string
  /** null when the author's row is gone; a template does not depend on it */
  readonly authorUserId: string
  readonly authorName: string | null
  readonly parameters: readonly string[]
  readonly sourceStatus: 'active' | 'archived'
}

export interface TemplateDetail extends TemplateSummary {
  readonly sourceTs: string
  readonly tests: readonly Record<string, unknown>[]
  readonly inputSchema: unknown
  readonly outputSchema: unknown
}

export interface TemplatePage {
  readonly items: readonly TemplateSummary[]
  readonly last: { readonly publishedAt: string; readonly versionId: string } | null
  readonly more: boolean
}

export class FormulaTemplateLibrary extends Context.Service<
  FormulaTemplateLibrary,
  {
    /**
     * The published versions this reader may discover.
     *
     * `viewerNodeId` is where they stand, and null means nowhere - which
     * reaches nothing rather than everything.
     */
    readonly listTemplates: (
      tenantId: string,
      viewer: { readonly userId: string; readonly nodeId: string | null },
      page?: {
        readonly limit?: number
        readonly after?: { readonly publishedAt: string; readonly versionId: string }
      },
    ) => Effect.Effect<TemplatePage>
    readonly getTemplate: (
      tenantId: string,
      versionId: string,
      viewer: { readonly userId: string; readonly nodeId: string | null },
    ) => Effect.Effect<TemplateDetail, FormulaTemplateNotFound>
    /**
     * Fork one template into a private draft of the reader's own.
     *
     * A snapshot, not a subscription: what comes back is theirs, and
     * nothing about the source reaches it afterwards.
     */
    readonly copyTemplate: (
      tenantId: string,
      versionId: string,
      viewer: { readonly userId: string; readonly nodeId: string | null },
      input: { readonly name: string; readonly description?: string | null },
    ) => Effect.Effect<
      { readonly functionId: string },
      FormulaTemplateNotFound | FormulaSourceTooLarge
    >
    /**
     * The units this person may offer a formula to.
     *
     * Their sharing permission's reach, expanded: a subtree grant means the
     * whole subtree, and returning only the anchor would hide most of what
     * they may actually do. Empty rather than refused when they hold none -
     * the screen still shows what is already offered, and still lets them
     * take it back.
     */
    readonly shareableNodes: (
      tenantId: string,
      as: Principal,
      options?: { readonly search?: string; readonly limit?: number },
    ) => Effect.Effect<{
      readonly nodes: readonly {
        readonly id: string
        readonly name: string
        readonly depth: number
      }[]
      readonly truncated: boolean
    }>
    readonly getSharing: (
      tenantId: string,
      functionId: string,
      versionNo: number,
      as: Principal,
    ) => Effect.Effect<VersionSharing, FormulaFunctionNotFound | FormulaVersionNotFound>
    readonly replaceSharing: (
      tenantId: string,
      functionId: string,
      versionNo: number,
      input: { readonly expectedToken: string; readonly orgNodeIds: readonly string[] },
      as: Principal,
    ) => Effect.Effect<
      VersionSharing,
      | FormulaFunctionNotFound
      | FormulaVersionNotFound
      | FormulaSharingConflict
      | AccessDenied
      | BadRequest
    >
  }
>()('@qualy/plugin-assessment-formula/FormulaTemplateLibrary') {}

/** the columns every template read projects, summary and detail alike */
const TEMPLATE_COLUMNS = [
  'v.id as versionId',
  'v.functionId as functionId',
  'f.name as functionName',
  'f.description as description',
  'v.versionNo as versionNo',
  'v.publishedAt as publishedAt',
  'v.inputSchema as inputSchema',
  'f.createdBy as authorUserId',
  'u.displayName as authorName',
  'f.archivedAt as archivedAt',
] as const

interface TemplateRow {
  readonly versionId: string
  readonly functionId: string
  readonly functionName: string
  readonly description: string | null
  readonly versionNo: number
  readonly publishedAt: Date | string
  readonly inputSchema: unknown
  readonly authorUserId: string
  readonly authorName: string | null
  readonly archivedAt: unknown
}

/** an org node as this service needs it: its identity and its place */
interface NodeRow {
  readonly id: string
  readonly path: string
}

/**
 * Whether one path is at or under another.
 *
 * The separator is load-bearing: without it an audience at `r.a` would
 * start covering a sibling at `r.ab`.
 */
const covers = (ancestor: string, node: string): boolean =>
  node === ancestor || node.startsWith(`${ancestor}.`)

export const make = Effect.fn('FormulaTemplateLibrary.make')(function* () {
  const database = yield* withDatabase
  const rbac = yield* Rbac
  const audit = yield* Audit

  /** the version being shared, proven to be one the caller wrote */
  const ownedVersion = (
    tenantId: string,
    functionId: string,
    versionNo: number,
    as: Principal,
    lock: 'none' | 'update',
  ) =>
    Effect.gen(function* () {
      // A function somebody else wrote reads as absent, exactly as it does
      // everywhere else in this plugin: whether it exists is not the
      // caller's business. Archival is deliberately NOT consulted - taking
      // back an audience is the one act an archived function still needs.
      const owner = yield* db
        .query((k) =>
          k
            .selectFrom('FormulaFunction')
            .select(['id', 'createdBy'])
            .where('tenantId', '=', tenantId)
            .where('id', '=', functionId)
            .executeTakeFirst(),
        )
        .pipe(Effect.orDie)
      if (owner === undefined || (owner as { createdBy: string }).createdBy !== as.userId) {
        return yield* new FormulaFunctionNotFound()
      }
      const version = yield* db
        .query((k) => {
          const found = k
            .selectFrom('FormulaVersion')
            .select(['id'])
            .where('tenantId', '=', tenantId)
            .where('functionId', '=', functionId)
            .where('versionNo', '=', versionNo)
          return (lock === 'update' ? found.forUpdate() : found).executeTakeFirst()
        })
        .pipe(Effect.orDie)
      if (version === undefined) return yield* new FormulaVersionNotFound()
      return (version as { id: string }).id
    })

  /** the audience a version carries, with the names a screen shows */
  const scopesOf = (tenantId: string, versionId: string) =>
    db
      .query((k) =>
        k
          .selectFrom('FormulaShareScope as s')
          .innerJoin('OrgNode as n', (join) =>
            join.onRef('n.tenantId', '=', 's.tenantId').onRef('n.id', '=', 's.orgNodeId'),
          )
          .select(['s.orgNodeId as orgNodeId', 'n.name as name'])
          .where('s.tenantId', '=', tenantId)
          .where('s.versionId', '=', versionId)
          .orderBy('n.name')
          .execute(),
      )
      .pipe(
        Effect.orDie,
        Effect.map((rows) => rows as unknown as SharedScope[]),
      )

  const sharingOf = (tenantId: string, versionId: string) =>
    Effect.map(scopesOf(tenantId, versionId), (scopes) => ({
      scopes,
      token: sharingToken(scopes.map((scope) => scope.orgNodeId)),
    }))

  /**
   * Whether one published version is a template FOR THIS READER.
   *
   * One predicate, and the same one behind every way of reaching a template
   * - listing them, opening one, copying one. Discovery and copying must
   * never drift into two rules: a version excluded from a reader's list but
   * copyable by version id would be a hole shaped exactly like the product
   * decision it contradicts.
   *
   * Their own work is not a template to them; it is already in their
   * library. Standing nowhere reaches nothing, which is why a null node
   * short-circuits rather than widening the query.
   */
  const visibleTemplate = (
    tenantId: string,
    viewerUserId: string,
    viewerNodeId: string,
  ): RawBuilder<boolean> =>
    sql<boolean>`(
      f.created_by <> ${viewerUserId}::uuid
      and exists (
        select 1
          from assessment_formula_share_scopes s
          join org_nodes scope
            on scope.tenant_id = s.tenant_id and scope.id = s.org_node_id
          join org_nodes viewer
            on viewer.tenant_id = s.tenant_id and viewer.id = ${viewerNodeId}::uuid
         where s.tenant_id = ${tenantId}::uuid
           and s.version_id = v.id
           and viewer.path <@ scope.path
      )
    )`

  const summaryOf = (row: TemplateRow): TemplateSummary => ({
    versionId: row.versionId,
    functionId: row.functionId,
    functionName: row.functionName,
    description: row.description,
    versionNo: Number(row.versionNo),
    publishedAt: row.publishedAt,
    authorUserId: row.authorUserId,
    authorName: row.authorName,
    parameters: Object.keys(
      (row.inputSchema as { properties?: Record<string, unknown> }).properties ?? {},
    ).sort(),
    sourceStatus: row.archivedAt === null ? 'active' : 'archived',
  })

  return FormulaTemplateLibrary.of({
    listTemplates: (tenantId, viewer, page) =>
      Effect.gen(function* () {
        const size = Math.max(1, page?.limit ?? 50)
        if (viewer.nodeId === null) return { items: [], last: null, more: false }
        const nodeId = viewer.nodeId
        const after = page?.after
        const rows = yield* database(
          db.query((k) => {
            let query = k
              .selectFrom('FormulaVersion as v')
              .innerJoin('FormulaFunction as f', (join) =>
                join.onRef('f.tenantId', '=', 'v.tenantId').onRef('f.id', '=', 'v.functionId'),
              )
              // LEFT, because authorship carries no foreign key: a template
              // must not disappear because the row naming its author did
              .leftJoin('User as u', (join) =>
                join.onRef('u.tenantId', '=', 'f.tenantId').onRef('u.id', '=', 'f.createdBy'),
              )
              .select(TEMPLATE_COLUMNS)
              .where('v.tenantId', '=', tenantId)
              .where(visibleTemplate(tenantId, viewer.userId, nodeId))
            if (after !== undefined) {
              // newest first, the id closing the boundary: two versions can
              // share an instant, and without a unique last key a page edge
              // would drop rows or repeat them
              query = query.where(
                sql<boolean>`(
                  v.published_at < ${after.publishedAt}::timestamptz
                  or (v.published_at = ${after.publishedAt}::timestamptz
                      and v.id < ${after.versionId}::uuid)
                )`,
              )
            }
            return query
              .orderBy('v.publishedAt', 'desc')
              .orderBy('v.id', 'desc')
              .limit(size + 1)
              .execute()
          }),
        ).pipe(Effect.orDie)
        const all = rows as unknown as TemplateRow[]
        const items = all.slice(0, size).map(summaryOf)
        const tail = all[items.length - 1]
        return {
          items,
          last:
            tail === undefined
              ? null
              : {
                  publishedAt: new Date(tail.publishedAt).toISOString(),
                  versionId: tail.versionId,
                },
          more: all.length > size,
        }
      }),

    getTemplate: (tenantId, versionId, viewer) =>
      Effect.gen(function* () {
        // the same predicate the listing uses, asked of one row: a version
        // somebody can name but not discover is not a template to them, and
        // saying so any other way would tell them it exists
        if (viewer.nodeId === null) return yield* new FormulaTemplateNotFound()
        const nodeId = viewer.nodeId
        const row = yield* database(
          db.query((k) =>
            k
              .selectFrom('FormulaVersion as v')
              .innerJoin('FormulaFunction as f', (join) =>
                join.onRef('f.tenantId', '=', 'v.tenantId').onRef('f.id', '=', 'v.functionId'),
              )
              .leftJoin('User as u', (join) =>
                join.onRef('u.tenantId', '=', 'f.tenantId').onRef('u.id', '=', 'f.createdBy'),
              )
              .select([...TEMPLATE_COLUMNS, 'v.sourceTs as sourceTs', 'v.tests as tests'])
              .select('v.outputSchema as outputSchema')
              .where('v.tenantId', '=', tenantId)
              .where('v.id', '=', versionId)
              .where(visibleTemplate(tenantId, viewer.userId, nodeId))
              .executeTakeFirst(),
          ),
        ).pipe(Effect.orDie)
        if (row === undefined) return yield* new FormulaTemplateNotFound()
        const found = row as unknown as TemplateRow & {
          sourceTs: string
          tests: readonly Record<string, unknown>[]
          outputSchema: unknown
        }
        return {
          ...summaryOf(found),
          sourceTs: found.sourceTs,
          tests: found.tests,
          inputSchema: found.inputSchema,
          outputSchema: found.outputSchema,
        }
      }),

    copyTemplate: (tenantId, versionId, viewer, input) =>
      database(
        transaction(
          Effect.gen(function* () {
            if (viewer.nodeId === null) return yield* new FormulaTemplateNotFound()
            const nodeId = viewer.nodeId
            // The version row first, held FOR SHARE, and the audience read
            // under it - the same order every writer of that audience
            // takes. That is what makes this and a concurrent withdrawal
            // linear rather than racing: the database runs read committed,
            // where each statement sees its own moment, so a visibility
            // check followed by an unlocked insert would happily copy
            // something already taken back.
            const source = yield* db
              .query((k) =>
                k
                  .selectFrom('FormulaVersion as v')
                  .innerJoin('FormulaFunction as f', (join) =>
                    join.onRef('f.tenantId', '=', 'v.tenantId').onRef('f.id', '=', 'v.functionId'),
                  )
                  .select(['v.id as versionId', 'v.sourceTs as sourceTs', 'v.tests as tests'])
                  .where('v.tenantId', '=', tenantId)
                  .where('v.id', '=', versionId)
                  .where(visibleTemplate(tenantId, viewer.userId, nodeId))
                  .forShare()
                  .executeTakeFirst(),
              )
              .pipe(Effect.orDie)
            if (source === undefined) return yield* new FormulaTemplateNotFound()
            const found = source as unknown as {
              sourceTs: string
              tests: readonly Record<string, unknown>[]
            }
            // the same service invariant every other way of creating a
            // draft holds. A version published under a wider ceiling stays
            // replayable forever, but it must not become a draft that
            // breaks the ceiling drafts are held to today.
            if (Buffer.byteLength(found.sourceTs, 'utf8') > SOURCE_LIMIT) {
              return yield* new FormulaSourceTooLarge({ limit: SOURCE_LIMIT })
            }
            const created = yield* db
              .query((k) =>
                k
                  .insertInto('FormulaFunction')
                  .values({
                    tenantId,
                    name: input.name,
                    description: input.description ?? null,
                    // byte for byte what was published, and no version of
                    // its own: the source was compiled by a toolchain that
                    // has moved on, so its new author publishes it again in
                    // today's world or it never runs
                    draftSourceTs: found.sourceTs,
                    draftTests: sql`${JSON.stringify(found.tests)}::jsonb`,
                    createdBy: viewer.userId,
                    updatedBy: viewer.userId,
                    copiedFromVersionId: versionId,
                  } as never)
                  .returning('id')
                  .executeTakeFirstOrThrow(),
              )
              .pipe(Effect.orDie)
            const functionId = (created as { id: string }).id
            // one act, recorded once: this IS how the function came to
            // exist, so a separate creation entry beside it would say the
            // same thing twice
            yield* audit.record(FormulaTemplateCopied, {
              tenantId,
              actor: { kind: 'user', userId: viewer.userId },
              target: { id: functionId, label: input.name },
              details: { sourceVersionId: versionId },
            })
            return { functionId }
          }),
        ),
      ),

    shareableNodes: (tenantId, as, options) =>
      Effect.gen(function* () {
        // this IS an rbac scope projection, unlike the audience above: the
        // question is what a permission reaches, which is rbac's own
        // vocabulary rather than a rule about where somebody stands
        const scope = yield* rbac.listAuthorizedScope(as, SHARE)
        if (!scope.tenantWide && scope.anchors.length === 0) {
          return { nodes: [], truncated: false }
        }
        const limit = Math.max(1, options?.limit ?? 50)
        const search = options?.search?.trim() ?? ''
        const rows = yield* database(
          db.query((k) => {
            let found = k
              .selectFrom('OrgNode as n')
              // the parent shape a picker needs, never the path: handing
              // over the materialized path publishes the shape of an
              // organization to whoever holds a leaf of it
              .select(['n.id', 'n.name', 'n.depth'])
              .where('n.tenantId', '=', tenantId)
              .where((eb) =>
                scopeCoverage(scope, {
                  id: eb.ref('n.id'),
                  tenantId: eb.ref('n.tenantId'),
                  path: eb.ref('n.path'),
                }),
              )
            if (search !== '') found = found.where('n.name', 'ilike', `%${search}%`)
            return found
              .orderBy(sql`path`)
              .limit(limit + 1)
              .execute()
          }),
        ).pipe(Effect.orDie)
        const all = rows as unknown as { id: string; name: string; depth: number }[]
        return { nodes: all.slice(0, limit), truncated: all.length > limit }
      }),

    getSharing: (tenantId, functionId, versionNo, as) =>
      database(
        Effect.gen(function* () {
          const versionId = yield* ownedVersion(tenantId, functionId, versionNo, as, 'none')
          return yield* sharingOf(tenantId, versionId)
        }),
      ),

    replaceSharing: (tenantId, functionId, versionNo, input, as) =>
      database(
        transaction(
          Effect.gen(function* () {
            // the lock order every writer of this audience takes: the
            // version row first, then its share rows. A copy reads it FOR
            // SHARE, so the two linearize instead of racing - the database
            // runs read committed, where each statement sees its own moment
            const versionId = yield* ownedVersion(tenantId, functionId, versionNo, as, 'update')
            const current = yield* scopesOf(tenantId, versionId)
            const held = current.map((scope) => scope.orgNodeId)
            if (sharingToken(held) !== input.expectedToken) {
              return yield* new FormulaSharingConflict()
            }

            // exact duplicates are a spelling, not a decision
            const desired = [...new Set(input.orgNodeIds)]
            // taking everything back names no units at all, and asking the
            // database about an empty list is a question, not an answer
            const found =
              desired.length === 0
                ? []
                : ((yield* db
                    .query((k) =>
                      k
                        .selectFrom('OrgNode')
                        .select(['id', sql<string>`path::text`.as('path')])
                        .where('tenantId', '=', tenantId)
                        .where('id', 'in', desired)
                        .execute(),
                    )
                    .pipe(Effect.orDie)) as unknown as NodeRow[])
            // Existence first, and on purpose: `canAt` answers false for a
            // node that does not exist, so asking it first would report
            // every typo and every other tenant's id as a permission
            // problem. What is wrong with the request is that it names
            // something that is not there.
            if (found.length !== desired.length) {
              return yield* new BadRequest({
                message: 'one of the units named is not part of this tenant',
              })
            }
            // Redundancy is judged on the FINAL set, never on what is held
            // plus what is added: replacing a college with one of its
            // classes removes the ancestor in the same breath, and reading
            // the union would refuse a request that leaves nothing
            // overlapping. It is a canonicalization at the moment of
            // writing, not an invariant the database keeps - units move,
            // and this plugin does not follow them around.
            for (const node of found) {
              for (const other of found) {
                if (node.id !== other.id && covers(other.path, node.path)) {
                  return yield* new BadRequest({
                    message: 'one unit named is already inside another',
                  })
                }
              }
            }

            const wanted = new Set(desired)
            const added = desired.filter((id) => !held.includes(id))
            const removed = held.filter((id) => !wanted.has(id))
            if (added.length === 0 && removed.length === 0) {
              // nothing was decided; the rows keep the instants they have
              return yield* sharingOf(tenantId, versionId)
            }

            // Widening needs the permission where it widens TO; narrowing
            // never does. An author whose share permission was revoked must
            // still be able to take back what they already offered.
            for (const orgNodeId of added) {
              const allowed = yield* rbac.canAt(as, SHARE, orgNodeId)
              if (!allowed) {
                return yield* new AccessDenied({ reason: 'cannot share formulas to this unit' })
              }
            }

            // A delta, not a rewrite: re-inserting an unchanged row would
            // move its `sharedAt` and `sharedBy` while the audit says
            // nothing about it changed.
            if (removed.length > 0) {
              yield* db
                .query((k) =>
                  k
                    .deleteFrom('FormulaShareScope')
                    .where('tenantId', '=', tenantId)
                    .where('versionId', '=', versionId)
                    .where('orgNodeId', 'in', removed)
                    .execute(),
                )
                .pipe(Effect.orDie)
            }
            if (added.length > 0) {
              yield* db
                .query((k) =>
                  k
                    .insertInto('FormulaShareScope')
                    .values(
                      added.map((orgNodeId) => ({
                        tenantId,
                        versionId,
                        orgNodeId,
                        sharedBy: as.userId,
                      })) as never,
                    )
                    .execute(),
                )
                .pipe(Effect.orDie)
            }
            yield* audit.record(FormulaVersionSharingChanged, {
              tenantId,
              actor: { kind: 'user', userId: as.userId },
              target: { id: functionId, label: `v${versionNo}` },
              details: { versionId, addedOrgNodeIds: added, removedOrgNodeIds: removed },
            })
            return yield* sharingOf(tenantId, versionId)
          }),
        ),
      ),
  })
})

export const templateLibraryLayer = Layer.effect(FormulaTemplateLibrary, make())
