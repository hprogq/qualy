import { randomInt, timingSafeEqual } from 'node:crypto'
import { Effect, Redacted } from 'effect'
import { sql } from 'kysely'
import { Secrets, type SecretRef } from '@qualy/plugin-secrets/plugin'
import type { LoginDriver } from '@qualy/auth-contract/login'
import { ReauthenticationRequired } from '@qualy/auth-contract/sign-in-failure'
import { db } from './db.ts'

// Showing it is still you, a moment ago.
//
// A session is proof that somebody signed in once, days ago perhaps, on a
// computer that may since have been left open. The changes that decide who
// can reach an account from then on - moving its address, setting its first
// password, binding another way in - ask for more: that the session in hand
// was shown to be its owner's within the last few minutes. The session keeps
// that as a grant of the core's own, beside the ones a driver keeps, and it
// ends with the session.
//
// How somebody shows it follows from what the account has: the password,
// when there is one; otherwise a code sent to the address they proved; and
// for somebody with neither, signing in again through a way in whose other
// side asks for their credentials every time. A way in that may let them
// straight through proves nothing about who is at the keyboard now, so an
// account reached only through such ways cannot make these changes itself.

/** how long a session stands re-authenticated once it has shown it */
export const REAUTHENTICATION_MINUTES = 10
/** how long a code mailed to show it is them can be typed back */
export const REAUTHENTICATION_CODE_MINUTES = 10

/** grant kinds the core keeps for itself on a session; a driver's own never start so */
export const CORE_GRANT_PREFIX = 'qualy:'
const RECENT = `${CORE_GRANT_PREFIX}reauthenticated`
const CODE = `${CORE_GRANT_PREFIX}reauthentication-code`

/** how the session in hand showed it is them */
export type ReauthenticatedBy = 'password' | 'code' | 'sign-in'

/** a grant's sealed identity: its session, its entrance, its kind, its format */
export const sessionGrantRef = (
  tenantId: string,
  sessionId: string,
  providerId: string,
  kind: string,
): SecretRef => ({
  tenantId,
  ownerKind: 'session-grant',
  ownerId: sessionId,
  key: `${providerId}:${kind}:v1`,
})

/** whether signing in through this entrance shows the person is there now */
export const provesPresence = (
  driver: LoginDriver | undefined,
  config: Readonly<Record<string, unknown>>,
) => driver?.provesPresence?.({ config }) === true

/** the entrance a live session came in through, which its grants are kept under */
const sessionDoor = (tenantId: string, sessionId: string) =>
  db.query((k) =>
    k
      .selectFrom('Session')
      .select('authProviderId')
      .where('tenantId', '=', tenantId)
      .where('id', '=', sessionId)
      .where('expiresAt', '>', sql<Date>`now()`)
      .executeTakeFirst(),
  )

/** until when a session stands re-authenticated; undefined when it does not */
export const reauthenticatedUntil = (tenantId: string, sessionId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('SessionAuthGrant')
        .select('expiresAt')
        .where('tenantId', '=', tenantId)
        .where('sessionId', '=', sessionId)
        .where('kind', '=', RECENT)
        .where('expiresAt', '>', sql<Date>`now()`)
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row?.expiresAt ?? undefined))

/** refuses unless the session in hand showed it is its owner's a moment ago */
export const requireReauthenticated = (tenantId: string, sessionId: string) =>
  reauthenticatedUntil(tenantId, sessionId).pipe(
    Effect.flatMap((until) =>
      until === undefined ? Effect.fail(new ReauthenticationRequired()) : Effect.void,
    ),
  )

/** what a code typed back is compared as: its digits, and nothing around them */
const codeOf = (typed: string) => typed.replaceAll(/\s/g, '')

export const makeReauthentication = Effect.gen(function* () {
  const secrets = yield* Secrets

  /** one grant of the core's on a session, replacing the one of its kind before it */
  const put = Effect.fnUntraced(function* (
    tenantId: string,
    sessionId: string,
    kind: string,
    value: string,
    minutes: number,
  ) {
    const door = yield* sessionDoor(tenantId, sessionId)
    if (door === undefined) return undefined
    const sealed = yield* secrets.seal(
      sessionGrantRef(tenantId, sessionId, door.authProviderId, kind),
      Redacted.make(value),
    )
    yield* db.query((k) =>
      k
        .deleteFrom('SessionAuthGrant')
        .where('tenantId', '=', tenantId)
        .where('sessionId', '=', sessionId)
        .where('kind', '=', kind)
        .execute(),
    )
    const row = yield* db.query((k) =>
      k
        .insertInto('SessionAuthGrant')
        .values({
          tenantId,
          sessionId,
          authProviderId: door.authProviderId,
          kind,
          stateSealed: sealed,
          expiresAt: sql<Date>`now() + make_interval(mins => ${minutes})`,
        })
        .returning('expiresAt')
        .executeTakeFirstOrThrow(),
    )
    return row.expiresAt!
  })

  const dropCode = (tenantId: string, sessionId: string) =>
    db
      .query((k) =>
        k
          .deleteFrom('SessionAuthGrant')
          .where('tenantId', '=', tenantId)
          .where('sessionId', '=', sessionId)
          .where('kind', '=', CODE)
          .execute(),
      )
      .pipe(Effect.asVoid)

  return {
    /**
     * The session in hand was just shown to be its owner's. Undefined when
     * the session is gone, which nothing can be granted to.
     */
    mark: (tenantId: string, sessionId: string, by: ReauthenticatedBy) =>
      put(tenantId, sessionId, RECENT, by, REAUTHENTICATION_MINUTES),

    /** a code for this session alone to type back, replacing any sent before it */
    issueCode: Effect.fnUntraced(function* (tenantId: string, sessionId: string) {
      const code = randomInt(0, 1_000_000).toString().padStart(6, '0')
      const until = yield* put(tenantId, sessionId, CODE, code, REAUTHENTICATION_CODE_MINUTES)
      return until === undefined ? undefined : Redacted.make(code)
    }),

    /** a code that was not sent after all, taken back */
    dropCode,

    /**
     * Whether what was typed is the code this session was sent, while it
     * still works; a right one is spent in the same breath.
     */
    takeCode: Effect.fnUntraced(function* (tenantId: string, sessionId: string, typed: string) {
      const row = yield* db.query((k) =>
        k
          .selectFrom('SessionAuthGrant')
          .select(['authProviderId', 'stateSealed'])
          .where('tenantId', '=', tenantId)
          .where('sessionId', '=', sessionId)
          .where('kind', '=', CODE)
          .where('expiresAt', '>', sql<Date>`now()`)
          .forUpdate()
          .executeTakeFirst(),
      )
      if (row === undefined) return false
      const opened = yield* secrets
        .open(sessionGrantRef(tenantId, sessionId, row.authProviderId, CODE), row.stateSealed)
        .pipe(Effect.option)
      if (opened._tag === 'None') return false
      const expected = Buffer.from(Redacted.value(opened.value))
      const given = Buffer.from(codeOf(typed))
      const right = expected.length === given.length && timingSafeEqual(expected, given)
      if (right) yield* dropCode(tenantId, sessionId)
      return right
    }),
  }
})
