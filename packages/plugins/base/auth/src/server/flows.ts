import { createHash, randomBytes } from 'node:crypto'
import { Effect, Redacted } from 'effect'
import { sql } from 'kysely'
import { transaction, withDatabase } from '@qualy/plugin-database/server'
import { Secrets, type SecretRef } from '@qualy/plugin-secrets/plugin'
import {
  AuthFlowRejected,
  type ConsumedFlow,
  type FlowPayload,
  type FlowRejection,
  type ResolvedProvider,
  type StartedFlow,
} from '@qualy/auth-contract/login'
import type { ReauthenticationRequired } from '@qualy/auth-contract/sign-in-failure'
import { db } from './db.ts'
import { requireReauthenticated } from './reauthentication.ts'
import { safeReturnPath } from '@qualy/ui-contract/return-path'
import { deviceAtStart, recordFlowDevice } from './sign-in-device.ts'

// One redirect through somebody else's server, from the moment it leaves to
// the moment it comes back.
//
// What a flow has to guarantee is narrow and absolute: it is taken up at most
// once, by the entrance that started it, before it expires, and - for a bind -
// in the session it began in. Everything else a protocol needs (a verifier, a
// nonce) travels in a payload the driver seals and nobody else can open.
//
// The state is a secret: 32 random bytes handed to the other server, stored
// only as a digest, so a row read out of the database is not a state anybody
// can present.

const STATE_BYTES = 32
/** how long somebody has to come back; the browser's cookie lives as long */
export const FLOW_TTL_MINUTES = 10
/** how long a flow nobody came back for is kept before the sweep takes it */
const SWEEP_AFTER_HOURS = 24
/** at most this many rows per sweep, so a first start after a long idle is not a scan */
const SWEEP_LIMIT = 200

const digest = (state: string) => createHash('sha256').update(state).digest('hex')

/** the identity a flow's payload is sealed under, which no other flow has */
const payloadRef = (flow: {
  tenantId: string
  flowId: string
  providerId: string
  purpose: string
}): SecretRef => ({
  tenantId: flow.tenantId,
  ownerKind: 'auth-flow',
  ownerId: flow.flowId,
  key: `${flow.providerId}:${flow.purpose}`,
})

// where somebody asked to be returned to: one rule with the browser's
export { safeReturnPath }

/** a live session of this person, which is what a bind may be pinned to */
const liveSession = (tenantId: string, userId: string, sessionId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('Session')
        .select('id')
        .where('tenantId', '=', tenantId)
        .where('id', '=', sessionId)
        .where('userId', '=', userId)
        .where('expiresAt', '>', sql<Date>`now()`)
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row !== undefined))

/** a flow's id, minted where every other id is, before the row exists */
const nextFlowId = db
  .query((k) => sql<{ id: string }>`select uuidv7() as id`.execute(k))
  .pipe(Effect.map(({ rows }) => rows[0]!.id))

/** flows nobody came back for, long past any use */
const sweep = db.query((k) =>
  k
    .deleteFrom('AuthFlow')
    // a batch by physical row, PostgreSQL's own handle: a delete takes no limit
    .where((eb) =>
      eb(
        sql.ref('ctid'),
        'in',
        eb
          .selectFrom('AuthFlow')
          .select(sql<string>`ctid`.as('ctid'))
          .where('expiresAt', '<', sql<Date>`now() - make_interval(hours => ${SWEEP_AFTER_HOURS})`)
          .limit(SWEEP_LIMIT),
      ),
    )
    .execute(),
)

export const makeFlows = Effect.fn('Auth.makeFlows')(function* () {
  const withDb = yield* withDatabase
  const secrets = yield* Secrets

  const startFlow = (input: {
    provider: ResolvedProvider
    purpose: 'login' | 'bind'
    binding?: { userId: string; sessionId: string }
    returnPath?: string
    payload?: FlowPayload
  }): Effect.Effect<StartedFlow, AuthFlowRejected | ReauthenticationRequired> =>
    withDb(
      transaction(
        Effect.gen(function* () {
          if (input.purpose === 'bind') {
            if (
              input.binding === undefined ||
              !(yield* liveSession(
                input.provider.tenantId,
                input.binding.userId,
                input.binding.sessionId,
              ))
            ) {
              return yield* new AuthFlowRejected({ reason: 'session-mismatch' })
            }
            // another way in is a way in for whoever holds the session: it
            // begins only in one that showed it is its owner's a moment ago
            yield* requireReauthenticated(input.provider.tenantId, input.binding.sessionId)
          }
          yield* sweep
          // what the person said of their device, read where they set out
          const device = yield* deviceAtStart
          const state = Redacted.make(randomBytes(STATE_BYTES).toString('base64url'))
          // the id first, because the payload is sealed under it: a payload
          // lifted onto another flow does not open
          const flowId = yield* nextFlowId
          const payload =
            input.payload === undefined
              ? undefined
              : typeof input.payload === 'function'
                ? input.payload(state)
                : input.payload
          const sealed =
            payload === undefined
              ? null
              : yield* secrets.seal(
                  payloadRef({
                    tenantId: input.provider.tenantId,
                    flowId,
                    providerId: input.provider.providerId,
                    purpose: input.purpose,
                  }),
                  payload,
                )
          const started = yield* db.query((k) =>
            k
              .insertInto('AuthFlow')
              .values({
                id: flowId,
                tenantId: input.provider.tenantId,
                authProviderId: input.provider.providerId,
                stateHash: digest(Redacted.value(state)),
                purpose: input.purpose,
                userId: input.purpose === 'bind' ? input.binding!.userId : null,
                sessionId: input.purpose === 'bind' ? input.binding!.sessionId : null,
                returnPath: safeReturnPath(input.returnPath) ?? null,
                payloadSealed: sealed,
                device,
                expiresAt: sql<Date>`now() + make_interval(mins => ${FLOW_TTL_MINUTES})`,
              })
              .returning(['expiresAt'])
              .executeTakeFirstOrThrow(),
          )
          return {
            flowId,
            state,
            expiresAt: new Date(started.expiresAt),
          } satisfies StartedFlow
        }),
      ),
    ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error)))

  /**
   * Takes the flow, or says why not - and either way it is spent.
   *
   * The refusals are values rather than failures inside the transaction on
   * purpose: a state that reached the wrong entrance has been presented, and
   * a presented state is burned. Only a defect rolls the burn back, which is
   * what it should do - nothing was decided.
   */
  const consumeFlow = (input: {
    provider: ResolvedProvider
    state: string
  }): Effect.Effect<ConsumedFlow, AuthFlowRejected> =>
    withDb(
      transaction(
        Effect.gen(function* () {
          const hash = digest(input.state)
          const row = yield* db.query((k) =>
            k
              .updateTable('AuthFlow')
              .set({ consumedAt: sql<Date>`now()` })
              .where('stateHash', '=', hash)
              .where('consumedAt', 'is', null)
              .where('expiresAt', '>', sql<Date>`now()`)
              .returning([
                'id',
                'tenantId',
                'authProviderId',
                'purpose',
                'userId',
                'sessionId',
                'returnPath',
                'payloadSealed',
                'device',
              ])
              .executeTakeFirst(),
          )
          if (row === undefined) {
            // why it could not be taken, for the record the caller keeps
            const seen = yield* db.query((k) =>
              k
                .selectFrom('AuthFlow')
                .select((eb) => eb('consumedAt', 'is not', null).$castTo<boolean>().as('consumed'))
                .where('stateHash', '=', hash)
                .executeTakeFirst(),
            )
            const reason: FlowRejection =
              seen === undefined ? 'unknown' : seen.consumed ? 'consumed' : 'expired'
            return { ok: false as const, reason }
          }
          if (
            row.tenantId !== input.provider.tenantId ||
            row.authProviderId !== input.provider.providerId
          ) {
            return { ok: false as const, reason: 'provider-mismatch' as const }
          }
          const purpose = row.purpose as 'login' | 'bind'
          if (purpose === 'bind') {
            const held =
              row.userId !== null &&
              row.sessionId !== null &&
              (yield* liveSession(row.tenantId, row.userId, row.sessionId))
            if (!held) return { ok: false as const, reason: 'session-mismatch' as const }
          }
          const payload =
            row.payloadSealed === null
              ? undefined
              : // a payload that does not open is a database somebody edited
                // or a master key that changed: nothing this call can answer
                yield* secrets
                  .open(
                    payloadRef({
                      tenantId: row.tenantId,
                      flowId: String(row.id),
                      providerId: row.authProviderId,
                      purpose,
                    }),
                    row.payloadSealed,
                  )
                  .pipe(Effect.orDie)
          // judged again on the way out, for a row stored under an older rule
          const returnPath = safeReturnPath(row.returnPath)
          // the session this flow ends in is made for the device it left on
          yield* recordFlowDevice(row.device === 'shared' ? 'shared' : 'personal')
          return {
            ok: true as const,
            flow: {
              flowId: String(row.id),
              purpose,
              ...(row.userId === null ? {} : { userId: row.userId }),
              ...(row.sessionId === null ? {} : { sessionId: row.sessionId }),
              ...(returnPath === undefined ? {} : { returnPath }),
              ...(payload === undefined ? {} : { payload }),
            } satisfies ConsumedFlow,
          }
        }),
      ),
    ).pipe(
      Effect.catchTag('QueryFailed', (error) => Effect.die(error)),
      // the refusal is raised after the burn has committed
      Effect.flatMap((answer) =>
        answer.ok
          ? Effect.succeed(answer.flow)
          : Effect.fail(new AuthFlowRejected({ reason: answer.reason })),
      ),
    )

  return { startFlow, consumeFlow }
})

/**
 * Every open flow of a door, ended because the door is gone.
 *
 * A door is only ever soft-deleted, so nothing ends these for us. A person's
 * flows need no such call: a flow that belongs to somebody is a bind, a bind
 * is pinned to the session it began in, and deleting a person deletes their
 * sessions - which takes the flows with them.
 */
export const endFlowsOfProvider = (tenantId: string, providerId: string) =>
  db.query((k) =>
    k
      .updateTable('AuthFlow')
      .set({ consumedAt: sql<Date>`now()` })
      .where('tenantId', '=', tenantId)
      .where('authProviderId', '=', providerId)
      .where('consumedAt', 'is', null)
      .execute(),
  )
