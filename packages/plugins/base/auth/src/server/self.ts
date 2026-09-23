import { Effect } from 'effect'
import { sql } from 'kysely'
import { transaction, withDatabase } from '@qualy/plugin-database/server'
import { Audit } from '@qualy/audit-contract/effect'
import { LoginDrivers, type LoginDriver } from '@qualy/auth-contract/login'
import type { Principal } from '@qualy/rbac-contract'
import { BindingRevoked } from '../actions.ts'
import { actorOf } from './audit-actor.ts'
import { db, lockTenant } from './db.ts'
import {
  AuthBindingNotFound,
  AuthBindingUnsupported,
  AuthLastWayIn,
  SystemAccountProtected,
  UserNotFound,
} from './errors.ts'
import { makeReadiness } from './readiness.ts'
import { sameOriginPath } from './same-origin.ts'
import { lineageOf } from './sign-in.ts'

// The signed-in person's own account, as they read it.
//
// Nothing here takes a person as an argument: who is asked about is the
// principal, always. That is the whole difference from the administrative
// reads beside it - the same facts, no authority to check, and no way to name
// anybody else.

const NO_TYPE = '00000000-0000-0000-0000-000000000000'

/** the reader, with what they are called, filed as and placed at */
const selfRow = (tenantId: string, userId: string) =>
  db.query((k) =>
    k
      .selectFrom('User as u')
      .innerJoin('UserType as t', (join) =>
        join.onRef('t.tenantId', '=', 'u.tenantId').onRef('t.id', '=', 'u.userTypeId'),
      )
      .leftJoin('OrgNode as n', (join) =>
        join.onRef('n.tenantId', '=', 'u.tenantId').onRef('n.id', '=', 'u.primaryOrgNodeId'),
      )
      .select([
        'u.id',
        'u.displayName',
        'u.businessNo',
        'u.email',
        'u.emailVerifiedAt',
        'u.userTypeId',
        't.name as userTypeName',
        't.isSystem',
        'n.id as unitId',
        'n.name as unitName',
        'n.path as unitPath',
      ])
      .where('u.tenantId', '=', tenantId)
      .where('u.id', '=', userId)
      .where('u.deletedAt', 'is', null)
      .executeTakeFirst(),
  )

/**
 * Every entrance in service that lets the reader's kind of person through,
 * with their live binding at it when there is one. The credential is never
 * selected, only whether there is one.
 */
export const doorsOf = (tenantId: string, userId: string, userTypeId: string | null) =>
  db.query((k) =>
    k
      .selectFrom('AuthProvider as p')
      .leftJoin('UserAuthBinding as b', (join) =>
        join
          .onRef('b.tenantId', '=', 'p.tenantId')
          .onRef('b.authProviderId', '=', 'p.id')
          .on('b.userId', '=', userId)
          .on('b.revokedAt', 'is', null),
      )
      .select((eb) => [
        'p.id',
        'p.tenantId',
        'p.code',
        'p.name',
        'p.type',
        'p.config',
        'b.id as bindingId',
        'b.subject',
        'b.displayLabel',
        'b.boundAt',
        'b.lastUsedAt',
        eb('b.credentialHash', 'is not', null).as('hasCredential'),
        eb
          .selectFrom('SignInEvent as e')
          .select((e) => e.fn.max('e.occurredAt').as('at'))
          .whereRef('e.tenantId', '=', 'p.tenantId')
          .whereRef('e.providerId', '=', 'p.id')
          .where('e.userId', '=', userId)
          .where('e.outcome', '=', 'success')
          .as('lastSignInAt'),
      ])
      .where('p.tenantId', '=', tenantId)
      .where('p.enabled', '=', true)
      .where('p.deletedAt', 'is', null)
      .where((eb) =>
        eb.or([
          eb('p.audienceMode', '=', 'unrestricted'),
          eb.exists(
            eb
              .selectFrom('AuthProviderUserType as a')
              .select('a.id')
              .whereRef('a.tenantId', '=', 'p.tenantId')
              .whereRef('a.authProviderId', '=', 'p.id')
              .where('a.userTypeId', '=', userTypeId ?? NO_TYPE),
          ),
        ]),
      )
      .orderBy('p.sortOrder')
      .orderBy('p.name')
      .execute(),
  )

type Door = Effect.Success<ReturnType<typeof doorsOf>>[number]

/**
 * Whether a door would let this person in as things stand.
 *
 * A door that finds people by a field of theirs needs them to have it, and a
 * managed one a credential besides; a door that finds them by an account they
 * bound needs the binding. Only asked of doors in service that admit them.
 */
const opens = (
  driver: LoginDriver,
  door: Pick<Door, 'bindingId' | 'hasCredential'>,
  person: { readonly email: string | null; readonly businessNo: string | null },
) => {
  if (driver.resolution.mode === 'binding-subject') return door.bindingId !== null
  const field = driver.resolution.field === 'email' ? person.email : person.businessNo
  if (field === null) return false
  return driver.binding?.mode === 'managed' ? door.hasCredential === true : true
}

export const make = Effect.fn('Iam.self.make')(function* () {
  const audit = yield* Audit
  const drivers = yield* LoginDrivers
  const readiness = yield* makeReadiness
  const withDb = yield* withDatabase

  /** the doors that are really open to the reader, each with its driver */
  const serving = Effect.fn('Iam.self.serving')(function* (
    tenantId: string,
    userId: string,
    userTypeId: string | null,
  ) {
    const doors = yield* doorsOf(tenantId, userId, userTypeId)
    const found: { door: Door; driver: LoginDriver }[] = []
    for (const door of doors) {
      const driver = (yield* drivers.forType(door.type))?.driver
      if (driver === undefined) continue
      if (!(yield* readiness(door)).ready) continue
      found.push({ door, driver })
    }
    return found
  })

  const requireSelf = Effect.fn('Iam.self.require')(function* (principal: Principal) {
    const row = yield* selfRow(principal.tenantId, principal.userId)
    if (row === undefined) return yield* new UserNotFound()
    return row
  })

  return {
    /** who the reader is, as the product has them on file */
    profile: Effect.fn('Iam.self.profile')(function* (principal: Principal) {
      const { row, found } = yield* withDb(
        Effect.gen(function* () {
          const row = yield* requireSelf(principal)
          return {
            row,
            found: yield* serving(principal.tenantId, principal.userId, row.userTypeId),
          }
        }),
      ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error)))
      // the password way in open to them, if any, and whether they hold one there
      const passwordDoor = found.find(
        ({ driver }) =>
          driver.binding?.mode === 'managed' &&
          driver.resolution.mode === 'user-field' &&
          driver.resolution.field === 'email',
      )
      return {
        passwordStatus:
          passwordDoor === undefined
            ? ('unavailable' as const)
            : passwordDoor.door.hasCredential === true
              ? ('set' as const)
              : ('unset' as const),
        id: row.id,
        displayName: row.displayName,
        businessNo: row.businessNo,
        email: row.email,
        emailVerified: row.emailVerifiedAt !== null,
        // joined on, so it is there
        userType: { id: row.userTypeId!, name: row.userTypeName },
        unit: row.unitId === null ? null : { id: row.unitId, name: row.unitName! },
        // where that unit stands, root first and the unit itself last
        unitLineage:
          row.unitPath === null
            ? []
            : (yield* withDb(lineageOf(principal.tenantId, row.unitPath)).pipe(Effect.orDie)).map(
                (step) => ({ id: step.id, name: step.name }),
              ),
      }
    }),

    /**
     * How the reader can sign in: every door open to them, how it finds
     * them, what they have bound there, and whether they may let it go.
     */
    entrances: Effect.fn('Iam.self.entrances')(function* (principal: Principal) {
      return yield* withDb(
        Effect.gen(function* () {
          const row = yield* requireSelf(principal)
          const found = yield* serving(principal.tenantId, principal.userId, row.userTypeId)
          const usable = found.filter(({ door, driver }) => opens(driver, door, row))
          return found.map(({ door, driver }) => ({
            providerId: door.id,
            name: door.name,
            type: door.type,
            resolution: driver.resolution,
            binding: driver.binding ?? null,
            lastSignInAt: door.lastSignInAt,
            bound:
              door.bindingId === null
                ? null
                : {
                    id: door.bindingId,
                    subject: door.subject,
                    displayLabel: door.displayLabel,
                    boundAt: door.boundAt!,
                    lastUsedAt: door.lastUsedAt,
                    hasCredential: door.hasCredential === true,
                  },
            // where to begin binding one, for a door that binds and has none
            bindHref:
              driver.binding?.mode === 'self' &&
              driver.binding.start !== undefined &&
              door.bindingId === null
                ? (sameOriginPath(driver.binding.start({ code: door.code })) ?? null)
                : null,
            // only an account the person bound is theirs to let go, and not
            // while it is the one way they have left
            unbindable:
              !row.isSystem &&
              driver.binding?.mode === 'self' &&
              door.bindingId !== null &&
              usable.some((other) => other.door.id !== door.id),
          }))
        }),
      ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error)))
    }),

    /**
     * Lets go of an account the reader bound, and ends every session that
     * signed in through it - the current one too, when it did.
     *
     * Checked on the state the removal leaves, in the same locked transaction:
     * the reader must still have a way in. Answers whether the current
     * session was among those ended, so the screen knows to leave.
     */
    unbind: Effect.fn('Iam.self.unbind')(function* (principal: Principal, providerId: string) {
      return yield* withDb(
        transaction(
          Effect.gen(function* () {
            yield* lockTenant(principal.tenantId)
            const row = yield* requireSelf(principal)
            if (row.isSystem) return yield* new SystemAccountProtected()
            const found = yield* serving(principal.tenantId, principal.userId, row.userTypeId)
            const target = (yield* doorsOf(principal.tenantId, principal.userId, row.userTypeId))
              .find((door) => door.id === providerId)
            const driver =
              target === undefined ? undefined : (yield* drivers.forType(target.type))?.driver
            if (target === undefined || target.bindingId === null) {
              return yield* new AuthBindingNotFound()
            }
            if (driver?.binding?.mode !== 'self') return yield* new AuthBindingUnsupported()
            const bindingId = target.bindingId
            yield* db.query((k) =>
              k
                .updateTable('UserAuthBinding')
                .set({ revokedAt: sql<Date>`now()`, revokedBy: principal.userId })
                .where('tenantId', '=', principal.tenantId)
                .where('id', '=', bindingId)
                .execute(),
            )
            // the state the removal leaves: the door let go no longer counts,
            // and nothing about the others moved under the tenant lock
            const left = found.filter(
              ({ door, driver: other }) => door.id !== providerId && opens(other, door, row),
            )
            if (left.length === 0) return yield* new AuthLastWayIn()
            const ended = yield* db.query((k) =>
              k
                .deleteFrom('Session')
                .where('tenantId', '=', principal.tenantId)
                .where('userId', '=', principal.userId)
                .where('authBindingId', '=', bindingId)
                .returning('id')
                .execute(),
            )
            yield* audit.record(BindingRevoked, {
              tenantId: principal.tenantId,
              actor: yield* actorOf(principal.tenantId, principal),
              target: { id: row.id, label: row.displayName },
              ...(row.unitId === null ? {} : { organizationId: row.unitId }),
              details: { providerId, bindingId, endedSessions: ended.length },
            })
            return { signedOut: ended.some((session) => session.id === principal.sessionId) }
          }),
        ),
      ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error)))
    }),
  }
})
