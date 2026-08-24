import type { Schema } from 'effect'
import type { UiText } from '@qualy/i18n-contract'

/**
 * What a details schema may be: plain data in, plain JSON out, no services on
 * either side. The service channels are pinned to `never` so the writer can
 * encode any registered action without carrying an open requirement - and
 * because a details schema that needs a service to serialize is a sign the
 * event is holding live objects instead of a snapshot.
 */
export type AuditDetailsSchema = Schema.Codec<any, any, never, never>

// An audit action, declared by the plugin whose operation it records.
//
// The declaration is the allowlist: an event can only be recorded through a
// declared action, its details can only hold what the action's schema admits,
// and the version is written beside every row so a schema that later changes
// meaning does not silently reinterpret the JSON already stored under it.

export interface AuditAction<Details extends AuditDetailsSchema = AuditDetailsSchema> {
  readonly _tag: 'AuditAction'
  /** dotted, stable, and owned: `auth.user.disable` */
  readonly code: string
  /**
   * The kind of thing this action acts on - `auth.user`, `iam.role` - fixed
   * here rather than chosen per event, so every event of one action names the
   * same kind of target. Absent for actions that act on nothing in
   * particular (an export, a bulk import).
   */
  readonly target?: string
  /**
   * Bumped when the MEANING of the details changes, not when a field is
   * added compatibly. Rows store it, so a reader of old rows knows which
   * shape it is looking at; the history itself is never rewritten.
   */
  readonly version: number
  /** what a reader of the audit screen sees; the language is chosen there */
  readonly name: UiText
  /**
   * What may be recorded about this operation - and therefore what may not:
   * a credential has no field to arrive in. Encoded on write, so a value
   * that does not conform is refused before it reaches a row.
   */
  readonly details: Details
}

export const AuditAction = {
  define: <Details extends AuditDetailsSchema>(options: {
    readonly code: string
    readonly target?: string
    readonly version: number
    readonly name: UiText
    readonly details: Details
  }): AuditAction<Details> => ({ _tag: 'AuditAction', ...options }),
}
