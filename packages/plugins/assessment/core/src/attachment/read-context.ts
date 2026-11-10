import { Effect } from 'effect'
import type { Orm } from '@qualy/plugin-database/server'
import type { Principal } from '@qualy/rbac-contract'
import type { Storage } from '@qualy/plugin-storage/server'
import type { Assessment } from '../server/index.ts'
import { siblingFileIds } from './db.ts'
import { historyFileIds, reviewFileIds } from './citations.ts'

/** The kind is supplied by the registered server-side key, never by the client. */
export type AssessmentReadContext =
  | { readonly kind: 'staged' }
  | { readonly kind: 'entry'; readonly entryId: string }
  | { readonly kind: 'review'; readonly instanceId: string }
  | { readonly kind: 'sibling'; readonly instanceId: string; readonly entryId: string }
  | { readonly kind: 'import-source'; readonly importId: string }

type WithDb = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, Exclude<R, Orm>>

/**
 * Returns only citations visible through the specified business door. It
 * never opens a backend, creates a signed URL or searches for another door
 * that might admit the same file.
 */
export const assessmentContentRead =
  (deps: {
    readonly assessment: Assessment['Service']
    readonly storage: Storage['Service']
    readonly withDb: WithDb
  }) =>
  (input: {
    readonly principal: Principal
    readonly context: AssessmentReadContext
    readonly attachmentIds: readonly string[]
  }): Effect.Effect<readonly string[]> =>
    Effect.gen(function* () {
      const { principal, context } = input
      const tenant = principal.tenantId
      const requested = [...new Set(input.attachmentIds)]
      if (requested.length === 0) return []
      if (context.kind === 'staged') {
        const metadata = yield* deps.storage.metadataMany({
          tenantId: tenant,
          attachmentIds: requested,
        })
        return metadata
          .filter((meta) => meta.status === 'staged' && meta.ownerUserId === principal.userId)
          .map((meta) => meta.id)
      }
      let visible: readonly string[]
      if (context.kind === 'entry') {
        const history = yield* deps.assessment
          .getEntryHistory(tenant, context.entryId, principal)
          .pipe(Effect.catchTag('ASSESSMENT_ENTRY_NOT_FOUND', () => Effect.succeed(null)))
        if (history === null) return []
        visible = historyFileIds(history)
      } else if (context.kind === 'review') {
        const review = yield* deps.assessment
          .getReviewInstance(tenant, context.instanceId, principal)
          .pipe(Effect.catchTag('ASSESSMENT_REVIEW_NOT_FOUND', () => Effect.succeed(null)))
        if (review === null) return []
        visible = reviewFileIds(review)
      } else if (context.kind === 'sibling') {
        const sibling = yield* deps.assessment
          .getReviewSibling(tenant, context.instanceId, context.entryId, principal)
          .pipe(Effect.catchTag('ASSESSMENT_REVIEW_NOT_FOUND', () => Effect.succeed(null)))
        if (sibling === null) return []
        visible = yield* deps
          .withDb(siblingFileIds(tenant, context.entryId, sibling.revision.revisionNo))
          .pipe(Effect.orDie)
      } else if (context.kind === 'import-source') {
        const source = yield* deps.assessment
          .administrativeImportSourceId(tenant, context.importId, principal)
          .pipe(
            Effect.catchTags({
              ASSESSMENT_ADMINISTRATIVE_IMPORT_NOT_FOUND: () => Effect.succeed(null),
              ACCESS_DENIED: () => Effect.succeed(null),
            }),
          )
        visible = source === null ? [] : [source]
      } else {
        const exhaustive: never = context
        return exhaustive
      }
      const cited = new Set(visible)
      return requested.filter((id) => cited.has(id))
    })
