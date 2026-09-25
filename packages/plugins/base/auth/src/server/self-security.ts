import { Effect } from 'effect'
import { sql } from 'kysely'
import { transaction, withDatabase } from '@qualy/plugin-database/server'
import { Audit } from '@qualy/audit-contract/effect'
import { pageWindow } from '@qualy/api-kit/schema'
import type { Principal } from '@qualy/rbac-contract'
import { SessionsEnded } from '../actions.ts'
import { actorOf } from './audit-actor.ts'
import { db } from './db.ts'
import { retireChallenges } from './email-flows.ts'
import { SessionNotFound, UserNotFound } from './errors.ts'

// The reader's own security record: where they came in from and when, the
// sessions still open for them, and ending those. As with the rest of the
// self surface nothing here takes a person: it is the principal, always.

/** one page of a list read newest first, resuming strictly after a row */
export interface NewestFirst {
  /** the last row's key, as the cursor carried it: its time as text and its id */
  readonly after?: readonly [string, string]
  readonly limit: number
}

/** which of the reader's sign-ins to read */
export interface SignInFilter {
  /** all of them, or only those that went one way */
  readonly outcome?: 'success' | 'failure'
  /** inclusive lower and exclusive upper bounds, as instants postgres reads */
  readonly from?: string
  readonly to?: string
}

/** a numbered page: counted from one, past the last is the last */
export interface NumberedPage {
  readonly page: number
  readonly pageSize: number
}

type Kysely = Parameters<Parameters<typeof db.query>[0]>[0]

/** the reader's sign-in attempts the filter keeps, before they are counted or paged */
const signInsMatching = (k: Kysely, tenantId: string, userId: string, filter: SignInFilter) =>
  k
    .selectFrom('SignInEvent as e')
    .where('e.tenantId', '=', tenantId)
    .where('e.userId', '=', userId)
    .$if(filter.outcome !== undefined, (q) => q.where('e.outcome', '=', filter.outcome!))
    .$if(filter.from !== undefined, (q) =>
      q.where((eb) => sql<boolean>`${eb.ref('e.occurredAt')} >= ${filter.from}::timestamptz`),
    )
    .$if(filter.to !== undefined, (q) =>
      q.where((eb) => sql<boolean>`${eb.ref('e.occurredAt')} < ${filter.to}::timestamptz`),
    )

/** one numbered page of the reader's sign-ins, newest first, with how many there are */
const signInsOf = (tenantId: string, userId: string, filter: SignInFilter, page: NumberedPage) =>
  Effect.gen(function* () {
    const counted = yield* db.query((k) =>
      signInsMatching(k, tenantId, userId, filter)
        .select((eb) => eb.fn.countAll<string>().as('count'))
        .executeTakeFirstOrThrow(),
    )
    const total = Number(counted.count)
    const window = pageWindow(page.page, page.pageSize, total)
    const rows = yield* db.query((k) =>
      signInsMatching(k, tenantId, userId, filter)
        .leftJoin('AuthProvider as p', (join) =>
          join.onRef('p.tenantId', '=', 'e.tenantId').onRef('p.id', '=', 'e.providerId'),
        )
        .select([
          'e.id',
          'e.occurredAt',
          'e.outcome',
          'e.providerType',
          'e.sessionId',
          'e.clientIp',
          'e.userAgent',
          'p.name as providerName',
        ])
        // the id breaks a tie inside one instant, so no row is on two pages
        .orderBy('e.occurredAt', 'desc')
        .orderBy('e.id', 'desc')
        .limit(page.pageSize)
        .offset(window.offset)
        .execute(),
    )
    return { rows, total, page: window.page }
  })

/** the reader's sessions that have not run out, newest first */
const sessionsOf = (tenantId: string, userId: string, page: NewestFirst) =>
  db.query((k) => {
    let query = k
      .selectFrom('Session as s')
      .leftJoin('AuthProvider as p', (join) =>
        join.onRef('p.tenantId', '=', 's.tenantId').onRef('p.id', '=', 's.authProviderId'),
      )
      .select((eb) => [sql<string>`${eb.ref('s.createdAt')}::text`.as('cursorAt')])
      .select([
        's.id',
        's.createdAt',
        's.lastUsedAt',
        's.expiresAt',
        's.loginIp',
        's.userAgent',
        'p.name as providerName',
        'p.type as providerType',
      ])
      .where('s.tenantId', '=', tenantId)
      .where('s.userId', '=', userId)
      .where((eb) => sql<boolean>`${eb.ref('s.expiresAt')} > now()`)
      .orderBy('s.createdAt', 'desc')
      .orderBy('s.id', 'desc')
      .limit(page.limit)
    if (page.after !== undefined) {
      const [at, id] = page.after
      query = query.where(
        (eb) =>
          sql<boolean>`(${eb.ref('s.createdAt')}, ${eb.ref('s.id')}) < (${at}::timestamptz, ${id}::uuid)`,
      )
    }
    return query.execute()
  })

/** the person the record is about, as the trail names them */
const personOf = (tenantId: string, userId: string) =>
  db.query((k) =>
    k
      .selectFrom('User')
      .select(['id', 'displayName', 'primaryOrgNodeId'])
      .where('tenantId', '=', tenantId)
      .where('id', '=', userId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst(),
  )

export const make = Effect.fn('Iam.selfSecurity.make')(function* () {
  const audit = yield* Audit
  const withDb = yield* withDatabase

  /** ends the reader's sessions that match, never the one in hand, and records it */
  const end = Effect.fn('Iam.selfSecurity.end')(function* (
    principal: Principal,
    scope: 'one' | 'others',
    sessionId?: string,
  ) {
    return yield* withDb(
      transaction(
        Effect.gen(function* () {
          const person = yield* personOf(principal.tenantId, principal.userId)
          if (person === undefined) return yield* new UserNotFound()
          const ended = yield* db.query((k) => {
            let query = k
              .deleteFrom('Session')
              .where('tenantId', '=', principal.tenantId)
              .where('userId', '=', principal.userId)
              // the session in hand is ended by signing out, not from here
              .where('id', '!=', principal.sessionId)
            if (sessionId !== undefined) query = query.where('id', '=', sessionId)
            return query.returning('id').execute()
          })
          if (scope === 'one' && ended.length === 0) return yield* new SessionNotFound()
          // Signing somebody out is what a person does who thinks another
          // has their account: a move to another address asked for in one
          // of those sessions must not outlive it in that other's inbox.
          yield* retireChallenges(principal.tenantId, principal.userId, ['change'])
          if (ended.length > 0) {
            yield* audit.record(SessionsEnded, {
              tenantId: principal.tenantId,
              actor: yield* actorOf(principal.tenantId, principal),
              target: { id: person.id, label: person.displayName },
              ...(person.primaryOrgNodeId === null
                ? {}
                : { organizationId: person.primaryOrgNodeId }),
              details: { scope, ended: ended.length },
            })
          }
          return ended.length
        }),
      ),
    ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error)))
  })

  return {
    signIns: (principal: Principal, filter: SignInFilter, page: NumberedPage) =>
      withDb(signInsOf(principal.tenantId, principal.userId, filter, page)).pipe(Effect.orDie),
    /** what was done to the reader's account, as the trail tells it to them */
    accountChanges: (
      principal: Principal,
      filter: Omit<SignInFilter, 'outcome'>,
      page: NumberedPage,
    ) =>
      audit.subjectEvents({
        tenantId: principal.tenantId,
        userId: principal.userId,
        ...filter,
        ...page,
      }),
    sessions: (principal: Principal, page: NewestFirst) =>
      withDb(sessionsOf(principal.tenantId, principal.userId, page)).pipe(Effect.orDie),
    /** one of the reader's other sessions, by its id */
    endSession: (principal: Principal, sessionId: string) =>
      end(principal, 'one', sessionId).pipe(Effect.asVoid),
    /** every session of the reader's but the one in hand; how many there were */
    endOtherSessions: (principal: Principal) =>
      // with no id to miss, nothing is ever not found: none ended is zero
      end(principal, 'others').pipe(
        Effect.catchTag('AUTH_SESSION_NOT_FOUND', () => Effect.succeed(0)),
      ),
  }
})
