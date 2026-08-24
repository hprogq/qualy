import { Effect, Layer, Option, Schema } from 'effect'
import { sql } from 'kysely'
import { currentRequestContext } from '@qualy/api-kit/request'
import { withDatabase, type Orm } from '@qualy/plugin-database/server'
import type { AuditAction, AuditDetailsSchema } from '@qualy/audit-contract/action'
import {
  Audit,
  AuditActionCatalog,
  type AuditRecordInput,
  type RegisteredAuditAction,
} from '@qualy/audit-contract/effect'
import { db } from './db.ts'

// The writer: one INSERT, on whatever connection the caller's transaction is
// running on. Everything here fails as a defect, never as an error a caller
// chooses between - an operation declared auditable either commits with its
// event or aborts, and a rejected event is a programming mistake to fix, not
// an outcome to handle.

/**
 * The second line of defence behind the action schemas (the first: a
 * credential has no declared field to arrive in). Key names that smell like
 * secrets are refused wherever they appear, strings are capped, and the whole
 * document is capped - an audit row is a summary, not a payload store.
 */
const FORBIDDEN_KEY = /password|passphrase|secret|token|credential|cookie|authorization/i
const MAX_DETAILS_BYTES = 32 * 1024
const MAX_STRING_LENGTH = 4096

const detailViolations = (details: unknown): string[] => {
  const violations: string[] = []
  const walk = (node: unknown, path: string): void => {
    if (typeof node === 'string') {
      if (node.length > MAX_STRING_LENGTH) {
        violations.push(`${path} holds a string of ${node.length} characters`)
      }
      return
    }
    if (Array.isArray(node)) {
      node.forEach((item, at) => walk(item, `${path}[${at}]`))
      return
    }
    if (node !== null && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (FORBIDDEN_KEY.test(key)) {
          violations.push(`${path}.${key} names credential-like material`)
        } else {
          walk(value, `${path}.${key}`)
        }
      }
    }
  }
  walk(details, 'details')
  const bytes = Buffer.byteLength(JSON.stringify(details))
  if (bytes > MAX_DETAILS_BYTES) {
    violations.push(`details weigh ${bytes} bytes; the cap is ${MAX_DETAILS_BYTES}`)
  }
  return violations
}

/** a display snapshot clipped to its column, never a reason to refuse the event */
const snapshot = (value: string | undefined): string | null =>
  value === undefined ? null : value.length > 255 ? value.slice(0, 255) : value

// stringified before the cast so an encoded array cannot be mistaken for a
// postgres array on the wire
const jsonb = (value: unknown) => sql<Record<string, unknown>>`${JSON.stringify(value)}::jsonb`

export const make = Effect.fn('Audit.make')(function* () {
  const catalog = yield* AuditActionCatalog
  const registered = new Map<string, RegisteredAuditAction>(
    catalog.map((entry) => [entry.action.code, entry]),
  )

  // closed over rather than required: the record contract fixes R to nothing,
  // so a caller inside its own transaction records with nothing in scope -
  // the ambient transaction manager is what routes this INSERT onto the
  // caller's connection
  const withDb = yield* withDatabase

  const write = Effect.fn('Audit.record')(function* (
    action: AuditAction,
    input: AuditRecordInput<unknown>,
  ) {
    const entry = registered.get(action.code)
    if (entry === undefined) {
      return yield* Effect.die(
        new Error(`audit action ${action.code} is not declared by any plugin in this assembly`),
      )
    }
    if (entry.action.version !== action.version) {
      return yield* Effect.die(
        new Error(
          `audit action ${action.code} v${action.version} does not match the declared v${entry.action.version}`,
        ),
      )
    }

    const details = yield* Schema.encodeUnknownEffect(entry.action.details)(input.details).pipe(
      Effect.mapError(
        (error) => new Error(`audit ${action.code}: details rejected by schema: ${error.message}`),
      ),
      Effect.orDie,
    )
    const violations = detailViolations(details)
    if (violations.length > 0) {
      return yield* Effect.die(new Error(`audit ${action.code}: ${violations.join('; ')}`))
    }

    const context = Option.getOrUndefined(yield* currentRequestContext)
    yield* db
      .query((k) =>
        k
          .insertInto('AuditEvent')
          .values({
            tenantId: input.tenantId,
            actionCode: action.code,
            actionVersion: action.version,
            actorKind: input.actor.kind,
            actorUserId: input.actor.userId ?? null,
            actorLabel: snapshot(input.actor.label),
            targetKind: action.target ?? null,
            targetId: input.target?.id ?? null,
            targetLabel: snapshot(input.target?.label),
            organizationId: input.organizationId ?? null,
            outcome: input.outcome ?? 'success',
            reasonCode: input.reasonCode ?? null,
            details: jsonb(details),
            source: input.source ?? (context === undefined ? 'system' : 'http'),
            requestId: context?.requestId ?? null,
            traceId: context?.traceId ?? null,
            sessionId: context?.sessionId ?? null,
            clientIp: context?.clientIp ?? null,
            userAgent: context?.userAgent ?? null,
          })
          .execute(),
      )
      .pipe(Effect.orDie)
  })

  return Audit.of({
    record: <Details extends AuditDetailsSchema>(
      action: AuditAction<Details>,
      input: AuditRecordInput<Details['Type']>,
    ) => withDb(write(action as AuditAction, input as AuditRecordInput<unknown>)),
  })
})

export const writerLayer: Layer.Layer<Audit, never, Orm | AuditActionCatalog> = Layer.effect(
  Audit,
  make(),
)
