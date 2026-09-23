import { inspect } from 'node:util'
import { Cause, ConfigProvider, Effect, Exit, Layer, Logger, Option, Redacted } from 'effect'
import { sql } from 'kysely'
import { describe, expect, it } from 'vitest'
import {
  createTestContext,
  databaseFor,
  postgresAvailable,
  runSql,
} from '@qualy/plugin-database/testkit'
import { transaction, type Orm } from '@qualy/plugin-database/server'
import { Secrets, type SecretRef } from '../src/plugin.ts'
import {
  config,
  DEVELOPMENT_KEY_IN_PRODUCTION,
  DEVELOPMENT_KEY_WARNING,
  MASTER_KEY_MALFORMED,
  SecretsConfig,
} from '../src/server/config.ts'
import { entities, secretsLayer, secretsLayerWith, TEST_MASTER_KEY } from '../src/testkit/index.ts'

// What an encrypted value promises: it is not readable in the table, it opens
// only under the key and the reference it was written for, and it commits or
// rolls back with whatever the caller was writing beside it.

const TENANT = '00000000-0000-4000-8000-000000000001'
const OWNER = '00000000-0000-4000-8000-00000000000a'
const OTHER = '00000000-0000-4000-8000-00000000000b'
const ref = (key: string, ownerId = OWNER): SecretRef => ({
  tenantId: TENANT,
  ownerKind: 'auth-provider',
  ownerId,
  key,
})

const configured = (env: Record<string, string>) => {
  const logged: string[] = []
  const capture = Logger.layer([
    Logger.make((options) => {
      logged.push(String(Array.isArray(options.message) ? options.message[0] : options.message))
    }),
  ])
  return Effect.runPromiseExit(
    Effect.flatMap(SecretsConfig, (settings) =>
      Effect.succeed(Buffer.from(Redacted.value(settings.masterKey)).toString('base64')),
    ).pipe(
      Effect.provide(
        config({}, { manifestDir: '/somewhere' }).pipe(
          Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
          Layer.provideMerge(capture),
        ),
      ),
    ),
  ).then((exit) => ({ exit, logged }))
}

const refusal = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) ? Cause.pretty(exit.cause) : 'started'

describe('the master key', () => {
  it('is taken as exactly 32 bytes of base64', async () => {
    const { exit } = await configured({ NODE_ENV: 'production', QUALY_SECRETS_MASTER_KEY: TEST_MASTER_KEY })
    expect(Exit.isSuccess(exit) && exit.value).toBe(TEST_MASTER_KEY)
  })

  it('refuses to start production without one, or with anything that is not one', async () => {
    const bad = [
      undefined,
      '',
      'a passphrase somebody liked',
      // 31 bytes, 33 bytes, and 32 bytes in the url-safe alphabet
      Buffer.alloc(31, 7).toString('base64'),
      Buffer.alloc(33, 7).toString('base64'),
      Buffer.alloc(32, 255).toString('base64url'),
    ]
    for (const value of bad) {
      const env: Record<string, string> = { NODE_ENV: 'production' }
      if (value !== undefined) env['QUALY_SECRETS_MASTER_KEY'] = value
      const { exit } = await configured(env)
      expect(refusal(exit), String(value)).toContain(MASTER_KEY_MALFORMED)
    }
  })

  it('refuses a malformed key in development too, rather than stretching it into one', async () => {
    const { exit } = await configured({ QUALY_SECRETS_MASTER_KEY: 'hunter2' })
    expect(refusal(exit)).toContain(MASTER_KEY_MALFORMED)
  })

  it('falls back to the development key in development, and says so', async () => {
    const { exit, logged } = await configured({})
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(logged).toContain(DEVELOPMENT_KEY_WARNING)
    // and that key does not start a production instance
    const fallback = Exit.isSuccess(exit) ? exit.value : ''
    const production = await configured({ NODE_ENV: 'production', QUALY_SECRETS_MASTER_KEY: fallback })
    expect(refusal(production.exit)).toContain(DEVELOPMENT_KEY_IN_PRODUCTION)
  })
})

const run = <A, E>(
  url: string,
  effect: Effect.Effect<A, E, Secrets | Orm>,
  layer: Layer.Layer<Secrets, never, Orm> = secretsLayer,
) =>
  Effect.runPromiseExit(
    Effect.provide(
      effect,
      layer.pipe(Layer.provideMerge(databaseFor(url, { entities: [...entities] }))),
    ),
  )

const ok = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isSuccess(exit)) return exit.value
  throw new Error(`expected success, got ${inspect(exit.cause, { depth: 10 })}`)
}

const tagOf = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit)
    ? ((exit.cause as { reasons?: readonly { error?: { _tag?: string } }[] }).reasons ?? [])
        .map((reason) => reason.error?._tag)
        .find((tag) => tag !== undefined)
    : undefined

const plain = (value: Option.Option<Redacted.Redacted<string>>) =>
  Option.map(value, Redacted.value).pipe(Option.getOrUndefined)

describe.runIf(postgresAvailable)('a secret at rest', () => {
  it('is written, replaced, listed and removed, and never stored as typed', async () => {
    const db = await createTestContext('secrets-lifecycle')
    try {
      const answer = ok(
        await run(
          db.url,
          Effect.gen(function* () {
            const secrets = yield* Secrets
            yield* secrets.put(ref('clientSecret'), Redacted.make('first value'))
            yield* secrets.put(ref('clientSecret'), Redacted.make('second value'))
            yield* secrets.put(ref('signingKey'), Redacted.make('another'))
            yield* secrets.put(ref('clientSecret', OTHER), Redacted.make('not mine'))
            const raw = yield* runSql<{ ciphertext: Buffer }>(
              sql`select ciphertext from secrets where owner_id = ${OWNER}`,
            )
            const read = plain(yield* secrets.get(ref('clientSecret')))
            const keys = yield* secrets.keysOf(ref('clientSecret'))
            const has = yield* secrets.has(ref('signingKey'))
            const removed = yield* secrets.delete(ref('signingKey'))
            const removedAgain = yield* secrets.delete(ref('signingKey'))
            const gone = plain(yield* secrets.get(ref('signingKey')))
            const owner = yield* secrets.deleteOwner(ref('clientSecret'))
            const left = yield* secrets.keysOf(ref('clientSecret', OTHER))
            return {
              raw: raw.rows.map((row) => Buffer.from(row.ciphertext).toString('utf8')),
              read,
              keys,
              has,
              removed,
              removedAgain,
              gone,
              owner,
              left,
            }
          }),
        ),
      )
      expect(answer.raw).toHaveLength(2)
      for (const stored of answer.raw) {
        expect(stored).not.toContain('value')
        expect(stored).not.toContain('another')
      }
      expect(answer.read).toBe('second value')
      expect(answer.keys).toEqual(['clientSecret', 'signingKey'])
      expect(answer.has).toBe(true)
      expect([answer.removed, answer.removedAgain, answer.gone]).toEqual([true, false, undefined])
      expect(answer.owner).toBe(1)
      // another owner's value is not an owner's to delete
      expect(answer.left).toEqual(['clientSecret'])
    } finally {
      await db.dispose()
    }
  })

  it('opens only under the reference and the key it was written with', async () => {
    const db = await createTestContext('secrets-binding')
    try {
      await run(
        db.url,
        Effect.gen(function* () {
          const secrets = yield* Secrets
          yield* secrets.put(ref('clientSecret'), Redacted.make('the value'))
        }),
      )
      // a different master key reads nothing
      const otherKey = await run(
        db.url,
        Effect.flatMap(Secrets, (secrets) => secrets.get(ref('clientSecret'))),
        secretsLayerWith(Buffer.alloc(32, 9).toString('base64')),
      )
      expect(tagOf(otherKey)).toBe('SecretUnreadable')
      // the row moved onto another owner, or renamed, does not open there
      const moved = await run(
        db.url,
        Effect.gen(function* () {
          yield* runSql(sql`update secrets set owner_id = ${OTHER} where owner_id = ${OWNER}`)
          return yield* Effect.flatMap(Secrets, (secrets) => secrets.get(ref('clientSecret', OTHER)))
        }),
      )
      expect(tagOf(moved)).toBe('SecretUnreadable')
      const renamed = await run(
        db.url,
        Effect.gen(function* () {
          yield* runSql(sql`update secrets set owner_id = ${OWNER}, key = 'signingKey'`)
          return yield* Effect.flatMap(Secrets, (secrets) => secrets.get(ref('signingKey')))
        }),
      )
      expect(tagOf(renamed)).toBe('SecretUnreadable')
    } finally {
      await db.dispose()
    }
  })

  it('commits and rolls back with the transaction it was written in', async () => {
    const db = await createTestContext('secrets-transaction')
    try {
      const failed = await run(
        db.url,
        transaction(
          Effect.gen(function* () {
            const secrets = yield* Secrets
            yield* secrets.put(ref('clientSecret'), Redacted.make('never kept'))
            return yield* Effect.fail('the write beside it failed' as const)
          }),
        ),
      )
      expect(Exit.isFailure(failed)).toBe(true)
      const after = ok(
        await run(
          db.url,
          Effect.flatMap(Secrets, (secrets) => secrets.has(ref('clientSecret'))),
        ),
      )
      expect(after).toBe(false)
    } finally {
      await db.dispose()
    }
  })

  it('sealed for somebody else to keep, opens only under the reference it was sealed for', async () => {
    const db = await createTestContext('secrets-sealed')
    try {
      const answer = ok(
        await run(
          db.url,
          Effect.gen(function* () {
            const secrets = yield* Secrets
            const sealed = yield* secrets.seal(ref('login'), Redacted.make('{"verifier":"v"}'))
            const opened = Redacted.value(yield* secrets.open(ref('login'), sealed))
            const elsewhere = yield* Effect.exit(secrets.open(ref('bind'), sealed))
            // one bit of the ciphertext flipped, which a changed base64
            // character is not: the last character carries spare bits
            const parts = sealed.split('.')
            const bytes = Buffer.from(parts[3]!, 'base64url')
            bytes[0] = bytes[0]! ^ 1
            const edited = yield* Effect.exit(
              secrets.open(
                ref('login'),
                [...parts.slice(0, 3), bytes.toString('base64url')].join('.'),
              ),
            )
            const garbage = yield* Effect.exit(secrets.open(ref('login'), 'not sealed at all'))
            return { sealed, opened, elsewhere, edited, garbage }
          }),
        ),
      )
      expect(answer.sealed).not.toContain('verifier')
      expect(answer.opened).toBe('{"verifier":"v"}')
      expect([answer.elsewhere, answer.edited, answer.garbage].map(tagOf)).toEqual([
        'SecretUnreadable',
        'SecretUnreadable',
        'SecretUnreadable',
      ])
    } finally {
      await db.dispose()
    }
  })

  it('fingerprints a value under a key of its own, apart for each scope', async () => {
    const db = await createTestContext('secrets-fingerprint')
    try {
      const other = Buffer.alloc(32, 9).toString('base64')
      const digest = (scope: string, value: string, layer = secretsLayer) =>
        run(
          db.url,
          Effect.flatMap(Secrets, (secrets) => secrets.fingerprint(scope, value)),
          layer,
        ).then(ok)
      const first = await digest('sign-in:identifier', 'ada@school.edu')
      expect(first).toMatch(/^[0-9a-f]{64}$/)
      // the same scope and value give the same text, every time
      expect(await digest('sign-in:identifier', 'ada@school.edu')).toBe(first)
      // another scope, another value, or another deployment's key: another text
      expect(await digest('sign-in:address', 'ada@school.edu')).not.toBe(first)
      expect(await digest('sign-in:identifier', 'grace@school.edu')).not.toBe(first)
      expect(await digest('sign-in:identifier', 'ada@school.edu', secretsLayerWith(other))).not.toBe(
        first,
      )
      // and nothing anybody could compute without the key: not a plain
      // digest of the value, and not a MAC under the encryption key itself
      const { createHash, createHmac } = await import('node:crypto')
      expect(first).not.toBe(createHash('sha256').update('ada@school.edu').digest('hex'))
      expect(first).not.toBe(
        createHmac('sha256', Buffer.from(TEST_MASTER_KEY, 'base64'))
          .update('sign-in:identifier')
          .update('\0')
          .update('ada@school.edu')
          .digest('hex'),
      )
    } finally {
      await db.dispose()
    }
  })

  it('derives a secret per domain, under a root no caller can leave', async () => {
    const db = await createTestContext('secrets-derived')
    try {
      const other = Buffer.alloc(32, 9).toString('base64')
      const derive = (domain: string, layer = secretsLayer) =>
        run(
          db.url,
          Effect.flatMap(Secrets, (secrets) => secrets.deriveSecret(domain)),
          layer,
        ).then(ok)
      const fingerprint = (scope: string, value: string) =>
        run(
          db.url,
          Effect.flatMap(Secrets, (secrets) => secrets.fingerprint(scope, value)),
          secretsLayer,
        ).then(ok)
      // computed here, from the key and the documented domains alone, so the
      // separation itself is what is asserted and not merely two unequal texts
      const { createHmac, hkdfSync } = await import('node:crypto')
      const master = Buffer.from(TEST_MASTER_KEY, 'base64')
      const hkdf = (info: string) => Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), info, 32))
      const derivedVector = (domain: string) =>
        hkdf(`qualy/secrets/derived/v1\0${domain}`).toString('base64url')
      const fingerprintKey = hkdf('qualy/secrets/fingerprint/v1')

      const challenge = await derive('captcha/altcha/challenge/v1')
      expect(Redacted.value(challenge)).toBe(derivedVector('captcha/altcha/challenge/v1'))
      expect(Redacted.value(await derive('captcha/altcha/challenge/v1'))).toBe(Redacted.value(challenge))
      // another domain, another deployment's key: another secret
      expect(Redacted.value(await derive('captcha/altcha/key/v1'))).toBe(
        derivedVector('captcha/altcha/key/v1'),
      )
      expect(Redacted.value(await derive('captcha/altcha/key/v1'))).not.toBe(Redacted.value(challenge))
      expect(Redacted.value(await derive('captcha/altcha/challenge/v1', secretsLayerWith(other)))).not.toBe(
        Redacted.value(challenge),
      )
      // fingerprints are made under a key of their own, which is not
      // anything a derived domain can name - not even its own label
      expect(await fingerprint('sign-in:identifier', 'ada@school.edu')).toBe(
        createHmac('sha256', fingerprintKey)
          .update('sign-in:identifier')
          .update('\0')
          .update('ada@school.edu')
          .digest('hex'),
      )
      const posing = await derive('qualy/secrets/fingerprint/v1')
      expect(Redacted.value(posing)).not.toBe(fingerprintKey.toString('base64url'))
      expect(Redacted.value(posing)).toBe(derivedVector('qualy/secrets/fingerprint/v1'))
      // and it prints as what it is
      expect(String(challenge)).not.toContain(Redacted.value(challenge))
      expect(inspect(challenge)).not.toContain(Redacted.value(challenge))
    } finally {
      await db.dispose()
    }
  })
})
