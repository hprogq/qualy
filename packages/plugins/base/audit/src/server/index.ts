import { Effect, Layer } from 'effect'
import { sql } from 'kysely'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '@qualy/api-kit/plugin'
import { requestLocale } from '@qualy/api-kit/locale'
import { render } from '@qualy/text'
import { DEFAULT_PAGE_SIZE, isReadableTimestamp } from '@qualy/api-kit'
import { BadRequest, pageNumber, pageSize, pageWindow } from '@qualy/api-kit/schema'
import { CurrentUser } from '@qualy/auth-contract/session'
import { Rbac } from '@qualy/rbac-contract/effect'
import { AuditActionCatalog } from '@qualy/audit-contract/effect'
import { transaction, type Orm } from '@qualy/plugin-database/server'
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

type Kysely = Parameters<Parameters<typeof db.query>[0]>[0]

/** Shared by the count and page so every filter, including tenancy, stays identical. */
const matching = (k: Kysely, tenantId: string, filters: ListFilters) => {
  let query = k.selectFrom('AuditEvent').where('AuditEvent.tenantId', '=', tenantId)
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
    query = query.where((eb) =>
      eb('AuditEvent.occurredAt', '>=', eb.cast<Date>(eb.val(filters.from!), 'timestamptz')),
    )
  }
  if (filters.to !== undefined) {
    query = query.where((eb) =>
      eb('AuditEvent.occurredAt', '<', eb.cast<Date>(eb.val(filters.to!), 'timestamptz')),
    )
  }
  return query
}

export const listEvents = Effect.fn('audit.listEvents')(
  function* (
    tenantId: string,
    filters: ListFilters,
    page: { readonly page: number; readonly pageSize: number },
  ) {
    const counted = yield* db.query((k) =>
      matching(k, tenantId, filters)
        .select((eb) => eb.fn.countAll<string>().as('count'))
        .executeTakeFirstOrThrow(),
    )
    const total = Number(counted.count)
    const window = pageWindow(page.page, page.pageSize, total)
    const items = yield* db.query((k) =>
      matching(k, tenantId, filters)
        // Prefer the recorded actor name; the live name only fills a missing snapshot.
        .leftJoin('User as actor', (join) =>
          join
            .onRef('actor.tenantId', '=', 'AuditEvent.tenantId')
            .onRef('actor.id', '=', 'AuditEvent.actorUserId'),
        )
        .select((eb) =>
          sql<
            string | null
          >`coalesce(${eb.ref('AuditEvent.actorLabel')}, ${eb.ref('actor.displayName')})`.as(
            'actorLabel',
          ),
        )
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
        .orderBy('AuditEvent.occurredAt', 'desc')
        .orderBy('AuditEvent.id', 'desc')
        .limit(page.pageSize)
        .offset(window.offset)
        .execute(),
    )
    return { items, total, page: window.page, pageSize: page.pageSize }
  },
  // One response must count and read the same trail even while operations append events.
  (effect) => transaction(effect, { isolation: 'repeatable read', readOnly: true }),
)

/**
 * A timestamp filter the database would refuse is a bad request, not a
 * defect. Parsing wears no span; the refusal lands on the handler's own.
 */
const timeBound = Effect.fnUntraced(function* (value: string | undefined) {
  if (value === undefined) return undefined
  // asked the way the database would answer, not the way `Date.parse` does:
  // the two grammars disagree about `2026-02-30` and about a spelled-out
  // `Sat Sep 19 2026 ... GMT+0800`, and both of those reached the cast as a
  // fault instead of being refused here
  if (!isReadableTimestamp(value)) {
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
        const locale = yield* requestLocale
        const names = new Map(
          catalog.map((entry) => [entry.action.code, render(entry.action.name, { locale })]),
        )

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
        const found = yield* listEvents(principal.tenantId, filters, {
          page: pageNumber(query.page),
          pageSize: pageSize(query.limit, DEFAULT_PAGE_SIZE),
        }).pipe(Effect.orDie)
        return {
          items: found.items.map((row) => ({
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
          total: found.total,
          page: found.page,
          pageSize: found.pageSize,
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
        const locale = yield* requestLocale
        return {
          actions: catalog.map((entry) => ({
            code: entry.action.code,
            name: render(entry.action.name, { locale }),
            plugin: entry.plugin,
          })),
        }
      }),
    ),
)
