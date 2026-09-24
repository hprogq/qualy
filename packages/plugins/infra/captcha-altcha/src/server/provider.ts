import { randomUUID } from 'node:crypto'
import { Effect, Layer, Redacted, Schema } from 'effect'
import { sql } from 'kysely'
import { createChallenge, randomInt, verifySolution, type Challenge } from 'altcha-lib'
import { deriveKey } from 'altcha-lib/algorithms/pbkdf2'
import { Db } from '@qualy/plugin-database/plugin'
import { withDatabase, type Orm } from '@qualy/plugin-database/server'
import { Secrets } from '@qualy/plugin-secrets/plugin'
import {
  CaptchaProviders,
  type CaptchaProvider,
  type CaptchaProviderContext,
} from '@qualy/plugin-captcha/server'
import { entities } from '../db/entities.ts'

// A proof of work the visitor's browser computes and this server checks,
// with nobody else asked.
//
// What it is worth: every attempt it guards costs the one making it a
// measurable amount of computation - the same for a browser as for a
// script, because PBKDF2 is PBKDF2. It does not tell a person from a
// program; it makes guessing at scale expensive while a person meets it once,
// silently. The numbers below are where that trade starts, not a verdict:
// docs/notes/altcha.md has what they cost on real hardware.
//
// A challenge carries, signed, the tenant, the purpose and the binding it was
// issued for, and an id. The signature makes them tamper-evident; the id,
// recorded the first time a proof for it is accepted, makes it single-use.

export const ALTCHA_PROVIDER = 'altcha'

const ALGORITHM = 'PBKDF2/SHA-256'

/** how hard a challenge is, and for how long it holds */
export interface AltchaTuning {
  /** PBKDF2 iterations per attempt */
  readonly cost: number
  /**
   * The counter the solver has to reach, drawn afresh per challenge from
   * this range. It is the answer in deterministic mode: a fixed one would be
   * solved by one derivation instead of thousands.
   *
   * The range starts near 1 on purpose. The widget searches from 0, and a
   * script can start wherever it likes - this code is public - so a floor of
   * 5000 would cost a browser 5000 derivations it cannot skip and cost a
   * script nothing. From 1 up the search costs both the same.
   */
  readonly counterMin: number
  readonly counterMax: number
  readonly ttlMs: number
}

/** the only tuning a deployment runs with; a suite asks for an easier one */
export const ALTCHA_TUNING: AltchaTuning = {
  cost: 5000,
  counterMin: 1,
  counterMax: 10000,
  ttlMs: 5 * 60_000,
}
/** a spent challenge is remembered this long past its expiry */
const REMEMBERED_AFTER_EXPIRY = "interval '1 hour'"
/** a proof larger than this is not one: a challenge and a solution are well under 2 KiB */
const PAYLOAD_MAX_LENGTH = 4096
const SWEEP_EVERY = 100
const SWEEP_LIMIT = 500

/** what the signed challenge data says, and must still say when it comes back */
const ChallengeData = Schema.Struct({
  version: Schema.Literal(1),
  id: Schema.String,
  tenantId: Schema.String,
  purpose: Schema.String,
  bindingHash: Schema.String,
})

const hex = Schema.String.check(Schema.isPattern(/^(?:[0-9a-f]{2})+$/))

/** the widget's payload, decoded: the challenge as issued, and the solution to it */
const Payload = Schema.Struct({
  challenge: Schema.Struct({
    // held to what this provider issues, so what reaches the library is
    // input it was built for, and anything it throws after that is a defect
    parameters: Schema.Struct({
      algorithm: Schema.Literal(ALGORITHM),
      nonce: hex,
      salt: hex,
      cost: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_000_000 })),
      keyLength: Schema.Int.check(Schema.isBetween({ minimum: 16, maximum: 64 })),
      keyPrefix: hex,
      keySignature: Schema.optional(hex),
      expiresAt: Schema.optional(Schema.Number),
      data: Schema.optional(
        Schema.Record(
          Schema.String,
          Schema.Union([Schema.String, Schema.Number, Schema.Boolean, Schema.Null]),
        ),
      ),
    }),
    signature: Schema.optional(Schema.String),
  }),
  solution: Schema.Struct({
    counter: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    derivedKey: hex,
    time: Schema.optional(Schema.Number),
  }),
})

const decodePayload = Schema.decodeUnknownOption(Payload)
const decodeData = Schema.decodeUnknownOption(ChallengeData)

/** base64 of JSON, as the widget sends it; anything else is no proof at all */
const parsed = (response: string) => {
  if (response.length > PAYLOAD_MAX_LENGTH) return undefined
  try {
    const json: unknown = JSON.parse(Buffer.from(response, 'base64').toString('utf8'))
    const payload = decodePayload(json)
    return payload._tag === 'Some' ? payload.value : undefined
  } catch {
    return undefined
  }
}

const db = Db.scope([...entities] as const)

export const registrationLayerWith = (
  tuning: AltchaTuning,
): Layer.Layer<never, never, CaptchaProviders | Secrets | Orm> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const registry = yield* CaptchaProviders
      const secrets = yield* Secrets
      const withDb = yield* withDatabase
      // two keys, both derived from the master key, never configured: one
      // signs the challenge, the other the key its solution derives
      const signing = Redacted.value(yield* secrets.deriveSecret('captcha/altcha/challenge/v1'))
      const keySigning = Redacted.value(yield* secrets.deriveSecret('captcha/altcha/key/v1'))
      let verified = 0

      const sweep = withDb(
        db.query((k) =>
          sql`
            delete from captcha_altcha_used_challenges
             where ctid in (
               select ctid from captcha_altcha_used_challenges
                where expires_at < now() - ${sql.raw(REMEMBERED_AFTER_EXPIRY)}
                limit ${SWEEP_LIMIT}
             )`.execute(k),
        ),
      ).pipe(Effect.orDie, Effect.asVoid)

      /** records the challenge as spent; false when it already was */
      const spend = (tenantId: string, challengeId: string, expiresAtSeconds: number) =>
        withDb(
          db.query((k) =>
            k
              .insertInto('CaptchaAltchaUsedChallenge')
              .values({
                tenantId,
                challengeId,
                expiresAt: new Date(expiresAtSeconds * 1000),
              } as never)
              .onConflict((conflict) => conflict.columns(['tenantId', 'challengeId']).doNothing())
              .returning('id')
              .executeTakeFirst(),
          ),
        ).pipe(
          Effect.orDie,
          Effect.map((row) => row !== undefined),
        )

      const issue = (context: CaptchaProviderContext) =>
        Effect.promise(() =>
          createChallenge({
            algorithm: ALGORITHM,
            cost: tuning.cost,
            counter: randomInt(tuning.counterMax, tuning.counterMin),
            deriveKey,
            expiresAt: new Date(Date.now() + tuning.ttlMs),
            data: {
              version: 1,
              id: randomUUID(),
              tenantId: context.tenantId,
              purpose: context.purpose,
              bindingHash: context.bindingHash,
            },
            hmacSignatureSecret: signing,
            hmacKeySignatureSecret: keySigning,
          }),
        ).pipe(Effect.map((challenge) => ({ ...challenge }) as Record<string, unknown>))

      const verify = Effect.fn('CaptchaAltcha.verify')(function* (
        context: CaptchaProviderContext,
        response: string,
      ) {
        const payload = parsed(response)
        if (payload === undefined) return 'rejected' as const
        // the library checks expiry, the signature over every parameter - the
        // data included - and the solution. The payload was held to the shape
        // this provider issues before it got here, so a throw is the library
        // or the runtime failing, and it surfaces as one rather than as every
        // visitor's check quietly failing
        const outcome = yield* Effect.promise(() =>
          verifySolution({
            challenge: payload.challenge as Challenge,
            solution: payload.solution,
            deriveKey,
            hmacSignatureSecret: signing,
            hmacKeySignatureSecret: keySigning,
          }),
        )
        if (!outcome.verified) return 'rejected' as const
        // signed by us, so these are what we issued - and they must be what
        // this request is: this tenant, this purpose, this binding
        const data = decodeData(payload.challenge.parameters.data)
        if (data._tag === 'None') return 'rejected' as const
        if (
          data.value.tenantId !== context.tenantId ||
          data.value.purpose !== context.purpose ||
          data.value.bindingHash !== context.bindingHash
        ) {
          return 'rejected' as const
        }
        const expiresAt = payload.challenge.parameters.expiresAt
        if (expiresAt === undefined) return 'rejected' as const
        // one insert decides it: two requests with one proof, one of them wins
        const fresh = yield* spend(context.tenantId, data.value.id, expiresAt)
        verified += 1
        if (verified % SWEEP_EVERY === 0) yield* sweep
        return fresh ? ('verified' as const) : ('rejected' as const)
      })

      yield* registry.register({
        code: ALTCHA_PROVIDER,
        issue,
        verify,
      } satisfies CaptchaProvider)
    }),
  )

export const registrationLayer = registrationLayerWith(ALTCHA_TUNING)
