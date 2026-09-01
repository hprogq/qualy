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
import { sql } from 'kysely'
import { transaction, withDatabase } from '@qualy/plugin-database/server'
import { Rbac } from '@qualy/rbac-contract/effect'
import { AccessDenied } from '@qualy/rbac-contract/effect'
import { BadRequest } from '@qualy/api-kit/schema'
import type { Principal } from '@qualy/rbac-contract'
import { Audit } from '@qualy/audit-contract/effect'
import { db } from './db.ts'
import { FormulaVersionSharingChanged } from '../actions.ts'
import {
  FormulaFunctionNotFound,
  FormulaSharingConflict,
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

export class FormulaTemplateLibrary extends Context.Service<
  FormulaTemplateLibrary,
  {
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

  return FormulaTemplateLibrary.of({
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
