import { createHmac, hkdfSync } from 'node:crypto'
import { Effect, Layer, Option, Redacted } from 'effect'
import { sql } from 'kysely'
import { Db } from '@qualy/plugin-database/plugin'
import { withDatabase, type Orm, type QueryFailed } from '@qualy/plugin-database/server'
import { entities } from '../db/entities.ts'
import { Secrets, SecretUnreadable, type SecretOwner, type SecretRef } from '../plugin.ts'
import { SecretsConfig } from './config.ts'
import { decodeSealed, decrypt, encodeSealed, encrypt, KEY_VERSION } from './crypto.ts'

// The capability itself. Each call supplies the database this layer was built
// with and nothing else, so a caller inside a transaction has its secrets
// written on that transaction's connection.

const db = Db.scope([...entities] as const)

/** what the fingerprint key is derived for; a new version is a new key */
const FINGERPRINT_INFO = 'qualy/secrets/fingerprint/v1'
/** the root every derived secret hangs from; a caller's domain is appended, never substituted */
const DERIVED_SECRET_INFO = 'qualy/secrets/derived/v1'

export const serviceLayer: Layer.Layer<Secrets, never, Orm | SecretsConfig> = Layer.effect(
  Secrets,
  Effect.gen(function* () {
    const withDb = yield* withDatabase
    const { masterKey } = yield* SecretsConfig
    const key = () => Redacted.value(masterKey)
    // Its own key, derived once: the encryption key never doubles as a MAC
    // key, and a fingerprint cannot be turned into anything that decrypts.
    const fingerprintKey = Buffer.from(
      hkdfSync('sha256', key(), Buffer.alloc(0), FINGERPRINT_INFO, 32),
    )
    const run = <A>(effect: Effect.Effect<A, QueryFailed, Orm>) => withDb(effect).pipe(Effect.orDie)

    const rowOf = (ref: SecretRef) =>
      run(
        db.query((k) =>
          k
            .selectFrom('Secret')
            .select(['ciphertext', 'nonce', 'authTag'])
            .where('tenantId', '=', ref.tenantId)
            .where('ownerKind', '=', ref.ownerKind)
            .where('ownerId', '=', ref.ownerId)
            .where('key', '=', ref.key)
            .executeTakeFirst(),
        ),
      )

    const opened = (ref: SecretRef, plaintext: string | undefined) =>
      plaintext === undefined
        ? Effect.fail(new SecretUnreadable({ key: ref.key }))
        : Effect.succeed(Redacted.make(plaintext))

    return Secrets.of({
      put: Effect.fn('Secrets.put')(function* (ref: SecretRef, value: Redacted.Redacted<string>) {
        const encrypted = encrypt(key(), ref, Redacted.value(value))
        const stored = {
          ciphertext: encrypted.ciphertext,
          nonce: encrypted.nonce,
          authTag: encrypted.authTag,
          keyVersion: KEY_VERSION,
        }
        yield* run(
          db.query((k) =>
            k
              .insertInto('Secret')
              .values({
                tenantId: ref.tenantId,
                ownerKind: ref.ownerKind,
                ownerId: ref.ownerId,
                key: ref.key,
                ...stored,
              })
              .onConflict((conflict) =>
                conflict
                  .columns(['tenantId', 'ownerKind', 'ownerId', 'key'])
                  .doUpdateSet({ ...stored, updatedAt: sql<Date>`now()` }),
              )
              .execute(),
          ),
        )
      }),

      get: Effect.fn('Secrets.get')(function* (ref: SecretRef) {
        const row = yield* rowOf(ref)
        if (row === undefined) return Option.none()
        return Option.some(
          yield* opened(
            ref,
            decrypt(key(), ref, {
              ciphertext: Buffer.from(row.ciphertext),
              nonce: Buffer.from(row.nonce),
              authTag: Buffer.from(row.authTag),
            }),
          ),
        )
      }),

      has: (ref: SecretRef) => Effect.map(rowOf(ref), (row) => row !== undefined),

      keysOf: (owner: SecretOwner) =>
        run(
          db.query((k) =>
            k
              .selectFrom('Secret')
              .select('key')
              .where('tenantId', '=', owner.tenantId)
              .where('ownerKind', '=', owner.ownerKind)
              .where('ownerId', '=', owner.ownerId)
              .orderBy('key')
              .execute(),
          ),
        ).pipe(Effect.map((rows) => rows.map((row) => row.key))),

      delete: (ref: SecretRef) =>
        run(
          db.query((k) =>
            k
              .deleteFrom('Secret')
              .where('tenantId', '=', ref.tenantId)
              .where('ownerKind', '=', ref.ownerKind)
              .where('ownerId', '=', ref.ownerId)
              .where('key', '=', ref.key)
              .returning('id')
              .executeTakeFirst(),
          ),
        ).pipe(Effect.map((row) => row !== undefined)),

      deleteOwner: (owner: SecretOwner) =>
        run(
          db.query((k) =>
            k
              .deleteFrom('Secret')
              .where('tenantId', '=', owner.tenantId)
              .where('ownerKind', '=', owner.ownerKind)
              .where('ownerId', '=', owner.ownerId)
              .returning('id')
              .execute(),
          ),
        ).pipe(Effect.map((rows) => rows.length)),

      seal: (ref: SecretRef, value: Redacted.Redacted<string>) =>
        Effect.sync(() => encodeSealed(encrypt(key(), ref, Redacted.value(value)))),

      fingerprint: (scope: string, value: string) =>
        Effect.sync(() =>
          createHmac('sha256', fingerprintKey)
            .update(scope)
            .update('\0')
            .update(value)
            .digest('hex'),
        ),

      deriveSecret: (domain: string) =>
        Effect.sync(() =>
          Redacted.make(
            Buffer.from(
              hkdfSync('sha256', key(), Buffer.alloc(0), `${DERIVED_SECRET_INFO}\0${domain}`, 32),
            ).toString('base64url'),
          ),
        ),

      open: (ref: SecretRef, sealed: string) => {
        const encrypted = decodeSealed(sealed)
        return opened(ref, encrypted === undefined ? undefined : decrypt(key(), ref, encrypted))
      },
    })
  }),
)
