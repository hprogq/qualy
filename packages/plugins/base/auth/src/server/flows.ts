import { createHash, randomBytes } from 'node:crypto'
import { Effect, Redacted } from 'effect'
import { sql } from 'kysely'
import { transaction, withDatabase } from '@qualy/plugin-database/server'
import { Secrets, type SecretRef } from '@qualy/plugin-secrets/plugin'
import {
  AuthFlowRejected,
  type ConsumedFlow,
  type FlowRejection,
  type ResolvedProvider,
  type StartedFlow,
} from '@qualy/auth-contract/login'
import { db } from './db.ts'

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
const FLOW_TTL_MINUTES = 10
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

/**
 * A path inside this application, or nothing.
 *
 * Where somebody asked to be returned to arrives from the outside, so an
 * absolute url, a protocol-relative one, or anything that is not a path is
 * dropped rather than followed: the redirect happens under this
 * application's own name.
 */
export const safeReturnPath = (path: string | undefined): string | undefined => {
  if (path === undefined || !path.startsWith('/') || path.startsWith('//')) return undefined
  const sentinel = 'https://qualy.invalid'
  let target: URL
  try {
    target = new URL(path, sentinel)
  } catch {
    return undefined
  }
  if (target.origin !== sentinel) return undefined
  const inside = `${target.pathname}${target.search}${target.hash}`
  return inside.length > 255 ? undefined : inside
}

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

/** flows nobody came back for, long past any use */
const sweep = db.query((k) =>
  sql`
    delete from auth_flows
     where ctid in (
       select ctid from auth_flows
        where expires_at < now() - ${sql.raw(`interval '${String(SWEEP_AFTER_HOURS)} hours'`)}
        limit ${SWEEP_LIMIT}
     )`.execute(k),
)

export const makeFlows = Effect.fn('Auth.makeFlows')(function* () {
  const withDb = yield* withDatabase
  const secrets = yield* Secrets

  const startFlow = (input: {
    provider: ResolvedProvider
    purpose: 'login' | 'bind'
    binding?: { userId: string; sessionId: string }
    returnPath?: string
    payload?: Redacted.Redacted<string>
  }): Effect.Effect<StartedFlow, AuthFlowRejected> =>
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
          }
          yield* sweep
          const state = randomBytes(STATE_BYTES).toString('base64url')
          const started = yield* db.query((k) =>
            k
              .insertInto('AuthFlow')
              .values({
                tenantId: input.provider.tenantId,
                authProviderId: input.provider.providerId,
                stateHash: digest(state),
                purpose: input.purpose,
                userId: input.purpose === 'bind' ? input.binding!.userId : null,
                sessionId: input.purpose === 'bind' ? input.binding!.sessionId : null,
                returnPath: safeReturnPath(input.returnPath) ?? null,
                expiresAt: sql<Date>`now() + ${sql.raw(`interval '${String(FLOW_TTL_MINUTES)} minutes'`)}`,
              })
              .returning(['id', 'expiresAt'])
              .executeTakeFirstOrThrow(),
          )
          const flowId = String(started.id)
          if (input.payload !== undefined) {
            // sealed after the insert, because what it is sealed under is the
            // row's own id: a payload lifted onto another flow does not open
            const sealed = yield* secrets.seal(
              payloadRef({
                tenantId: input.provider.tenantId,
                flowId,
                providerId: input.provider.providerId,
                purpose: input.purpose,
              }),
              input.payload,
            )
            yield* db.query((k) =>
              k
                .updateTable('AuthFlow')
                .set({ payloadSealed: sealed })
                .where('id', '=', flowId)
                .execute(),
            )
          }
          return {
            flowId,
            state: Redacted.make(state),
            expiresAt: new Date(started.expiresAt as unknown as string),
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
          const taken = yield* db.query((k) =>
            sql<{
              id: string
              tenant_id: string
              auth_provider_id: string
              purpose: string
              user_id: string | null
              session_id: string | null
              return_path: string | null
              payload_sealed: string | null
            }>`
              update auth_flows
                 set consumed_at = now()
               where state_hash = ${hash}
                 and consumed_at is null
                 and expires_at > now()
              returning id, tenant_id, auth_provider_id, purpose, user_id, session_id,
                        return_path, payload_sealed`.execute(k),
          )
          const row = taken.rows[0]
          if (row === undefined) {
            // why it could not be taken, for the record the caller keeps
            const known = yield* db.query((k) =>
              sql<{ consumed: boolean }>`
                select consumed_at is not null as consumed from auth_flows
                 where state_hash = ${hash}`.execute(k),
            )
            const seen = known.rows[0]
            const reason: FlowRejection =
              seen === undefined ? 'unknown' : seen.consumed ? 'consumed' : 'expired'
            return { ok: false as const, reason }
          }
          if (
            row.tenant_id !== input.provider.tenantId ||
            row.auth_provider_id !== input.provider.providerId
          ) {
            return { ok: false as const, reason: 'provider-mismatch' as const }
          }
          const purpose = row.purpose as 'login' | 'bind'
          if (purpose === 'bind') {
            const held =
              row.user_id !== null &&
              row.session_id !== null &&
              (yield* liveSession(row.tenant_id, row.user_id, row.session_id))
            if (!held) return { ok: false as const, reason: 'session-mismatch' as const }
          }
          const payload =
            row.payload_sealed === null
              ? undefined
              : // a payload that does not open is a database somebody edited
                // or a master key that changed: nothing this call can answer
                yield* secrets
                  .open(
                    payloadRef({
                      tenantId: row.tenant_id,
                      flowId: String(row.id),
                      providerId: row.auth_provider_id,
                      purpose,
                    }),
                    row.payload_sealed,
                  )
                  .pipe(Effect.orDie)
          return {
            ok: true as const,
            flow: {
              flowId: String(row.id),
              purpose,
              ...(row.user_id === null ? {} : { userId: row.user_id }),
              ...(row.session_id === null ? {} : { sessionId: row.session_id }),
              ...(row.return_path === null ? {} : { returnPath: row.return_path }),
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
