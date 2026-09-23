import { Effect } from 'effect'
import { sql } from 'kysely'
import { pageWindow } from '@qualy/api-kit/schema'
import { PERSON_TARGET } from '@qualy/audit-contract/action'
import type { SubjectEventsPage, SubjectEventsQuery } from '@qualy/audit-contract/effect'
import type { UiText } from '@qualy/i18n-contract'
import { db } from './db.ts'

// What happened to one person's account, as they are told it: the actions
// that speak to their subject, done to this person, that went through,
// newest first, a numbered page at a time.

type Kysely = Parameters<Parameters<typeof db.query>[0]>[0]

/** the rows the question is about, before it is counted or paged */
const matching = (k: Kysely, query: SubjectEventsQuery, codes: readonly string[]) =>
  k
    .selectFrom('AuditEvent')
    .where('AuditEvent.tenantId', '=', query.tenantId)
    .where('AuditEvent.targetKind', '=', PERSON_TARGET)
    .where('AuditEvent.targetId', '=', query.userId)
    .where('AuditEvent.outcome', '=', 'success')
    .where('AuditEvent.actionCode', 'in', [...codes])
    .$if(query.from !== undefined, (q) =>
      q.where(
        (eb) => sql<boolean>`${eb.ref('AuditEvent.occurredAt')} >= ${query.from}::timestamptz`,
      ),
    )
    .$if(query.to !== undefined, (q) =>
      q.where((eb) => sql<boolean>`${eb.ref('AuditEvent.occurredAt')} < ${query.to}::timestamptz`),
    )

/** one page of them, with how many there are in all */
export const subjectEvents = (query: SubjectEventsQuery, voices: ReadonlyMap<string, UiText>) =>
  Effect.gen(function* () {
    if (voices.size === 0) return { items: [], total: 0, page: 1 } satisfies SubjectEventsPage
    const codes = [...voices.keys()]
    const counted = yield* db.query((k) =>
      matching(k, query, codes)
        .select((eb) => eb.fn.countAll<string>().as('count'))
        .executeTakeFirstOrThrow(),
    )
    const total = Number(counted.count)
    const window = pageWindow(query.page, query.pageSize, total)
    const rows = yield* db.query((k) =>
      matching(k, query, codes)
        .select([
          'AuditEvent.id',
          'AuditEvent.occurredAt',
          'AuditEvent.actionCode',
          'AuditEvent.actorKind',
          'AuditEvent.actorUserId',
        ])
        .orderBy('AuditEvent.occurredAt', 'desc')
        .orderBy('AuditEvent.id', 'desc')
        .limit(query.pageSize)
        .offset(window.offset)
        .execute(),
    )
    return {
      items: rows.map((row) => ({
        id: row.id,
        occurredAt: new Date(row.occurredAt).toISOString(),
        name: voices.get(row.actionCode)!,
        actor:
          row.actorKind === 'user' && row.actorUserId === query.userId
            ? ('self' as const)
            : ('other' as const),
      })),
      total,
      page: window.page,
    } satisfies SubjectEventsPage
  })
