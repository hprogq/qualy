import { Effect, Layer } from 'effect'
import { sql } from 'kysely'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { Api } from '@qualy/api-kit/plugin'
import { DEFAULT_PAGE_SIZE, encodeQueryCursor, readQueryCursor } from '@qualy/api-kit'
import { BadRequest, cursorUnusable, pageSize } from '@qualy/api-kit/schema'
import { CurrentUser } from '@qualy/plugin-auth/server/session'
import { Rbac } from '@qualy/rbac-contract/effect'
import { AuditActionCatalog } from '@qualy/audit-contract/effect'
import type { Orm } from '@qualy/plugin-database/server'
import type { Audit } from '@qualy/audit-contract/effect'
import { auditApiGroup } from '../api.ts'
import { db } from './db.ts'
import { writerLayer } from './writer.ts'

// The read side of the trail. The writer lives in writer.ts and depends on
// nothing above the database; these handlers are allowed to know auth and
// rbac, because reading the log is an administrative act somebody must be
// authorized for. That asymmetry is the contract's whole point.

export const serviceLayer: Layer.Layer<Audit, never, Orm | AuditActionCatalog> = writerLayer

const local = Api.local(auditApiGroup)

interface ListFilters {
  readonly actionCode?: string
  readonly actorUserId?: string
  readonly outcome?: string
  readonly targetKind?: string
  readonly targetId?: string
  readonly from?: string
  readonly to?: string
}

// exported for the tests that page and filter it against a seeded table; the
// handler below is the same query behind authorization
export const listEvents = (
  tenantId: string,
  filters: ListFilters,
  page: { readonly after?: readonly [string, string]; readonly limit: number },
) =>
  db.query((k) => {
    let query = k
      .selectFrom('AuditEvent')
      // the snapshot wins when it exists; the live name fills in for writers
      // that could not know one (a plugin whose closure cannot see users)
      .leftJoin('User as actor', (join) =>
        join
          .onRef('actor.tenantId', '=', 'AuditEvent.tenantId')
          .onRef('actor.id', '=', 'AuditEvent.actorUserId'),
      )
      // the cursor carries the column's own text form: a Date round-trips at
      // millisecond precision while now() writes microseconds, and the lost
      // digits made the boundary row - and everything sharing its instant -
      // vanish from the next page
      .select((eb) => [
        sql<string>`${eb.ref('AuditEvent.occurredAt')}::text`.as('occurredAtCursor'),
        sql<
          string | null
        >`coalesce(${eb.ref('AuditEvent.actorLabel')}, ${eb.ref('actor.displayName')})`.as(
          'actorLabel',
        ),
      ])
      .select([
        'AuditEvent.id',
        'AuditEvent.occurredAt',
        'AuditEvent.actionCode',
        'AuditEvent.actionVersion',
        'AuditEvent.actorKind',
        'AuditEvent.actorUserId',
        'AuditEvent.targetKind',
        'AuditEvent.targetId',
        'AuditEvent.targetLabel',
        'AuditEvent.organizationId',
        'AuditEvent.outcome',
        'AuditEvent.reasonCode',
        'AuditEvent.details',
        'AuditEvent.source',
        'AuditEvent.requestId',
        'AuditEvent.traceId',
        'AuditEvent.clientIp',
        'AuditEvent.userAgent',
      ])
      .where('AuditEvent.tenantId', '=', tenantId)
      .orderBy('AuditEvent.occurredAt', 'desc')
      .orderBy('AuditEvent.id', 'desc')
      .limit(page.limit)
    if (filters.actionCode !== undefined) {
      query = query.where('AuditEvent.actionCode', '=', filters.actionCode)
    }
    if (filters.actorUserId !== undefined) {
      query = query.where('AuditEvent.actorUserId', '=', filters.actorUserId)
    }
    if (filters.outcome !== undefined) {
      query = query.where('AuditEvent.outcome', '=', filters.outcome)
    }
    if (filters.targetKind !== undefined) {
      query = query.where('AuditEvent.targetKind', '=', filters.targetKind)
    }
    if (filters.targetId !== undefined) {
      query = query.where('AuditEvent.targetId', '=', filters.targetId)
    }
    if (filters.from !== undefined) {
      query = query.where(
        (eb) => sql<boolean>`${eb.ref('AuditEvent.occurredAt')} >= ${filters.from}::timestamptz`,
      )
    }
    if (filters.to !== undefined) {
      query = query.where(
        (eb) => sql<boolean>`${eb.ref('AuditEvent.occurredAt')} < ${filters.to}::timestamptz`,
      )
    }
    if (page.after !== undefined) {
      const [occurredAt, id] = page.after
      // row-value keyset: strictly before the cursor row in the (time, id)
      // order the screen reads in
      query = query.where(
        (eb) =>
          sql<boolean>`(${eb.ref('AuditEvent.occurredAt')}, ${eb.ref('AuditEvent.id')}) < (${occurredAt}::timestamptz, ${id}::uuid)`,
      )
    }
    return query.execute()
  })

/** a timestamp filter the database would refuse is a bad request, not a defect */
const timeBound = Effect.fn('audit.timeBound')(function* (value: string | undefined) {
  if (value === undefined) return undefined
  if (Number.isNaN(Date.parse(value))) {
    return yield* new BadRequest({ message: `not a timestamp: ${value}` })
  }
  return value
})

export const auditApiHandlers = HttpApiBuilder.group(local, 'audit', (handlers) =>
  handlers
    .handle(
      'listAuditEvents',
      Effect.fn('audit.listAuditEvents.handler')(function* ({ query }) {
        const rbac = yield* Rbac
        const principal = yield* CurrentUser
        yield* rbac.require(principal, 'audit.event.read')
        const catalog = yield* AuditActionCatalog
        const names = new Map(catalog.map((entry) => [entry.action.code, entry.action.name]))

        const from = yield* timeBound(query.from)
        const to = yield* timeBound(query.to)
        const filters: ListFilters = {
          ...(query.actionCode !== undefined ? { actionCode: query.actionCode } : {}),
          ...(query.actorUserId !== undefined ? { actorUserId: query.actorUserId } : {}),
          ...(query.outcome !== undefined ? { outcome: query.outcome } : {}),
          ...(query.targetKind !== undefined ? { targetKind: query.targetKind } : {}),
          ...(query.targetId !== undefined ? { targetId: query.targetId } : {}),
          ...(from !== undefined ? { from } : {}),
          ...(to !== undefined ? { to } : {}),
        }
        const limit = pageSize(query.limit, DEFAULT_PAGE_SIZE)
        // the cursor belongs to this filter and no other
        const fingerprint = `audit:${filters.actionCode ?? ''}:${filters.actorUserId ?? ''}:${
          filters.outcome ?? ''
        }:${filters.targetKind ?? ''}:${filters.targetId ?? ''}:${filters.from ?? ''}:${
          filters.to ?? ''
        }`
        const key = readQueryCursor(query.cursor, fingerprint, ['text', 'uuid'])
        if (key === null) return yield* cursorUnusable()

        const found = yield* listEvents(principal.tenantId, filters, {
          ...(key === undefined ? {} : { after: [key[0]!, key[1]!] as const }),
          limit: limit + 1,
        }).pipe(Effect.orDie)
        const items = found.slice(0, limit)
        const last = items.at(-1)
        return {
          items: items.map((row) => ({
            id: row.id,
            occurredAt: new Date(row.occurredAt).toISOString(),
            actionCode: row.actionCode,
            actionVersion: row.actionVersion,
            actionName: names.get(row.actionCode) ?? null,
            actorKind: row.actorKind as 'user' | 'system' | 'service' | 'anonymous',
            actorUserId: row.actorUserId,
            actorLabel: row.actorLabel,
            targetKind: row.targetKind,
            targetId: row.targetId,
            targetLabel: row.targetLabel,
            organizationId: row.organizationId,
            outcome: row.outcome as 'success' | 'denied' | 'failure',
            reasonCode: row.reasonCode,
            details: row.details,
            source: row.source as 'http' | 'job' | 'cli' | 'system',
            requestId: row.requestId,
            traceId: row.traceId,
            clientIp: row.clientIp,
            userAgent: row.userAgent,
          })),
          nextCursor:
            found.length > limit && last
              ? encodeQueryCursor(fingerprint, [last.occurredAtCursor, last.id])
              : null,
        }
      }),
    )
    .handle(
      'getAuditEventOptions',
      Effect.fn('audit.getAuditEventOptions.handler')(function* () {
        const rbac = yield* Rbac
        const principal = yield* CurrentUser
        yield* rbac.require(principal, 'audit.event.read')
        const catalog = yield* AuditActionCatalog
        return {
          actions: catalog.map((entry) => ({
            code: entry.action.code,
            name: entry.action.name,
            plugin: entry.plugin,
          })),
        }
      }),
    ),
)
