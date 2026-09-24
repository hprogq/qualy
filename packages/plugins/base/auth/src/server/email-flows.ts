import { createHash, randomBytes } from 'node:crypto'
import { Context, Effect, Layer, Option, Redacted } from 'effect'
import { sql } from 'kysely'
import { transaction, withDatabase, type Orm } from '@qualy/plugin-database/server'
import { Audit } from '@qualy/audit-contract/effect'
import { normalizeEmail } from '@qualy/auth-contract/email'
import { LoginDrivers } from '@qualy/auth-contract/login'
import { TooManyAttempts } from '@qualy/auth-contract/session'
import { currentRequestContext } from '@qualy/api-kit/request'
import { Mailer } from '@qualy/plugin-mail/plugin'
import type { Principal } from '@qualy/rbac-contract'
import { Secrets } from '@qualy/plugin-secrets/plugin'
import { BindingWritten, UserUpdated } from '../actions.ts'
import { CONFIRM_EMAIL_PATH, RESET_PASSWORD_PATH } from '../constants.ts'
import { actorOf } from './audit-actor.ts'
import { db, lockTenant } from './db.ts'
import {
  AuthBindingCredentialInvalid,
  ChallengeInvalid,
  EmailMissing,
  EmailUnverified,
  MailNotSent,
  PasswordIncorrect,
  PasswordUnavailable,
  SystemAccountProtected,
  UserEmailConflict,
  UserNotFound,
} from './errors.ts'
import { captchaPurpose, CaptchaRequired, type CaptchaProof } from '@qualy/plugin-captcha/contract'
import { Captcha } from '@qualy/plugin-captcha/server'
import { HARD_LIMITS, makeLimiter, RISK_RULES, type HardLimitRule } from './limiter.ts'
import { mailFor, type MailLocale, type MailPurpose } from './mail-copy.ts'
import { PublicOriginResolver } from './public-origin.ts'
import { AnonymousTenantResolver } from './tenancy.ts'
import { doorsOf } from './self.ts'

// The flows that go through somebody's inbox: proving an address, setting a
// password without the old one, moving to a new address - and changing one's
// own password, which needs no mail but is the same question of who may set it.
//
// A link carries a token; only its digest is stored, it works once and not
// for long, and a newer link of the same kind retires the older. The link is
// written and committed first and the mail sent after, never inside the
// transaction: a relay that is slow holds no lock, and a relay that fails
// leaves a link nobody was sent, which is then spent so it can never be used.
//
// A forgotten-password request answers the same whether or not anybody has
// that address, and costs the same: the mail goes out on its own after the
// answer, so how long the answer took says nothing either.

const TTL: Record<MailPurpose, string> = { verify: '24 hours', change: '24 hours', reset: '1 hour' }

const digest = (token: string) => createHash('sha256').update(token).digest('hex')

/** the person as these flows need them; live, and neither they nor their type disabled */
const personOf = (tenantId: string, userId: string) =>
  db.query((k) =>
    k
      .selectFrom('User as u')
      .innerJoin('UserType as t', (join) =>
        join.onRef('t.tenantId', '=', 'u.tenantId').onRef('t.id', '=', 'u.userTypeId'),
      )
      .select([
        'u.id',
        'u.displayName',
        'u.email',
        'u.emailVerifiedAt',
        'u.userTypeId',
        'u.primaryOrgNodeId',
        't.isSystem',
      ])
      .where('u.tenantId', '=', tenantId)
      .where('u.id', '=', userId)
      .where('u.deletedAt', 'is', null)
      .where('u.enabled', '=', true)
      .where('t.enabled', '=', true)
      .executeTakeFirst(),
  )

type Person = NonNullable<Effect.Success<ReturnType<typeof personOf>>>

/** whoever a forgotten-password request is about: only an address proven theirs */
const personByVerifiedEmail = (tenantId: string, email: string) =>
  db.query((k) =>
    k
      .selectFrom('User as u')
      .innerJoin('UserType as t', (join) =>
        join.onRef('t.tenantId', '=', 'u.tenantId').onRef('t.id', '=', 'u.userTypeId'),
      )
      .select(['u.id'])
      .where('u.tenantId', '=', tenantId)
      .where('u.email', '=', email)
      .where('u.emailVerifiedAt', 'is not', null)
      .where('u.deletedAt', 'is', null)
      .where('u.enabled', '=', true)
      .where('t.enabled', '=', true)
      .executeTakeFirst(),
  )

const emailTaken = (tenantId: string, email: string, exceptUserId: string) =>
  db.query((k) =>
    k
      .selectFrom('User')
      .select('id')
      .where('tenantId', '=', tenantId)
      .where('email', '=', email)
      .where('deletedAt', 'is', null)
      .where('id', '!=', exceptUserId)
      .executeTakeFirst(),
  )

const tenantSlug = (tenantId: string) =>
  db.query((k) =>
    k.selectFrom('Tenant').select('slug').where('id', '=', tenantId).executeTakeFirstOrThrow(),
  )

/** spends every open link of this kind the person has; a newer one is the only one that works */
export const retireChallenges = (
  tenantId: string,
  userId: string,
  purposes: readonly MailPurpose[],
) =>
  db.query((k) =>
    k
      .updateTable('UserEmailChallenge')
      .set({ consumedAt: sql<Date>`now()` })
      .where('tenantId', '=', tenantId)
      .where('userId', '=', userId)
      .where('purpose', 'in', [...purposes])
      .where('consumedAt', 'is', null)
      .execute(),
  )

/** what a reset challenge protects; a proof for it is worth nothing anywhere else */
export const PASSWORD_RESET_CAPTCHA = captchaPurpose('auth/password-reset')

const issueChallenge = (
  tenantId: string,
  userId: string,
  purpose: MailPurpose,
  targetEmail: string | null,
) =>
  Effect.gen(function* () {
    // A newer confirmation link replaces the older one. A reset link does
    // not: anybody may ask for one on somebody's behalf, and if each request
    // spent the last, a stranger asking every few minutes would keep the
    // owner's inbox full of links that no longer work. Every open reset link
    // is spent together once one of them sets a password.
    if (purpose !== 'reset') yield* retireChallenges(tenantId, userId, [purpose])
    const token = randomBytes(32).toString('base64url')
    const row = yield* db.query((k) =>
      k
        .insertInto('UserEmailChallenge')
        .values({
          tenantId,
          userId,
          purpose,
          targetEmail,
          tokenHash: digest(token),
          expiresAt: sql<Date>`now() + ${sql.raw(`interval '${TTL[purpose]}'`)}`,
        } as never)
        .returning('id')
        .executeTakeFirstOrThrow(),
    )
    return { id: row.id, token: Redacted.make(token) }
  })

/** takes a link up, once: only an open, unexpired one of this kind, and it is spent doing so */
const redeemChallenge = (token: string, purpose: MailPurpose) =>
  db.query((k) =>
    k
      .updateTable('UserEmailChallenge')
      .set({ consumedAt: sql<Date>`now()` })
      .where('tokenHash', '=', digest(token))
      .where('purpose', '=', purpose)
      .where('consumedAt', 'is', null)
      .where('expiresAt', '>', sql<Date>`now()`)
      .returning(['tenantId', 'userId', 'targetEmail'])
      .executeTakeFirst(),
  )

const spend = (id: string) =>
  db.query((k) =>
    k
      .updateTable('UserEmailChallenge')
      .set({ consumedAt: sql<Date>`now()` })
      .where('id', '=', id)
      .where('consumedAt', 'is', null)
      .execute(),
  )

const credentialOf = (tenantId: string, userId: string, providerId: string) =>
  db.query((k) =>
    k
      .selectFrom('UserAuthBinding')
      .select(['id', 'credentialHash'])
      .where('tenantId', '=', tenantId)
      .where('userId', '=', userId)
      .where('authProviderId', '=', providerId)
      .where('revokedAt', 'is', null)
      .executeTakeFirst(),
  )

const endSessions = (tenantId: string, userId: string, keep: string | undefined) =>
  db
    .query((k) => {
      let query = k
        .deleteFrom('Session')
        .where('tenantId', '=', tenantId)
        .where('userId', '=', userId)
      if (keep !== undefined) query = query.where('id', '!=', keep)
      return query.returning('id').execute()
    })
    .pipe(Effect.map((ended) => ended.length))

export class EmailFlows extends Context.Service<
  EmailFlows,
  {
    readonly requestReset: (input: {
      readonly email: string
      readonly locale: MailLocale
      /** what the browser sent back after meeting a challenge */
      readonly captcha?: CaptchaProof
    }) => Effect.Effect<void, TooManyAttempts | CaptchaRequired>
    readonly redeemReset: (input: {
      readonly token: string
      readonly password: string
    }) => Effect.Effect<void, ChallengeInvalid | AuthBindingCredentialInvalid>
    readonly requestVerification: (
      principal: Principal,
      locale: MailLocale,
    ) => Effect.Effect<{ readonly sent: boolean }, EmailMissing | MailNotSent | TooManyAttempts>
    readonly redeemVerification: (token: string) => Effect.Effect<void, ChallengeInvalid>
    readonly requestChange: (
      principal: Principal,
      input: { readonly newEmail: string; readonly locale: MailLocale },
    ) => Effect.Effect<
      void,
      UserEmailConflict | SystemAccountProtected | MailNotSent | TooManyAttempts | UserNotFound
    >
    readonly redeemChange: (token: string) => Effect.Effect<void, ChallengeInvalid | UserEmailConflict>
    readonly setPassword: (
      principal: Principal,
      input: { readonly currentPassword?: string; readonly newPassword: string },
    ) => Effect.Effect<
      void,
      | PasswordIncorrect
      | EmailUnverified
      | PasswordUnavailable
      | AuthBindingCredentialInvalid
      | TooManyAttempts
      | UserNotFound
    >
  }
>()('@qualy/plugin-auth/EmailFlows') {}

export const emailFlowsLayer: Layer.Layer<
  EmailFlows,
  never,
  | Orm
  | Mailer
  | Audit
  | LoginDrivers
  | Secrets
  | PublicOriginResolver
  | AnonymousTenantResolver
  | Captcha
> = Layer.effect(
  EmailFlows,
  Effect.gen(function* () {
    const withDb = yield* withDatabase
    const mailer = yield* Mailer
    const audit = yield* Audit
    const drivers = yield* LoginDrivers
    const origins = yield* PublicOriginResolver
    const tenants = yield* AnonymousTenantResolver
    const limiter = yield* makeLimiter
    const captcha = yield* Captcha
    // mail leaves on its own fiber, which lives as long as this layer does
    const scope = yield* Effect.scope

    /** the workspace a message comes from, by name, for its header */
    const workspaceOf = (tenantId: string) =>
      withDb(
        db.query((k) =>
          k.selectFrom('Tenant').select('name').where('id', '=', tenantId).executeTakeFirst(),
        ),
      ).pipe(
        Effect.map((row) => row?.name ?? null),
        Effect.orElseSucceed(() => null),
      )

    const throttle = Effect.fn('Auth.email.throttle')(function* (
      tenantId: string,
      rule: HardLimitRule,
      key: string,
    ) {
      const answer = yield* limiter.consumeHard(tenantId, rule, key)
      if (!answer.allowed) {
        return yield* new TooManyAttempts({ retryAfterSeconds: answer.retryAfterSeconds })
      }
    })

    const linkTo = Effect.fn('Auth.email.link')(function* (
      tenantId: string,
      path: string,
      fragment: Record<string, string>,
    ) {
      const slug = (yield* tenantSlug(tenantId)).slug
      const origin = yield* origins.resolve({ id: tenantId, slug }).pipe(Effect.orDie)
      const url = new URL(path, origin)
      // a fragment, which a browser does not send: the token stays out of
      // every access log and proxy between the reader and this server
      url.hash = new URLSearchParams(fragment).toString()
      return url.toString()
    })

    /** the one password way in open to this person, with its driver */
    const passwordDoor = Effect.fn('Auth.email.passwordDoor')(function* (
      tenantId: string,
      person: Person,
    ) {
      for (const door of yield* doorsOf(tenantId, person.id, person.userTypeId)) {
        const driver = (yield* drivers.forType(door.type))?.driver
        if (
          driver?.binding?.mode === 'managed' &&
          driver.resolution.mode === 'user-field' &&
          driver.resolution.field === 'email'
        ) {
          return { id: door.id, driver, binding: driver.binding }
        }
      }
      return undefined
    })

    /** hands a message to the mailer after the link is committed; spends the link if it does not go */
    const deliver = (
      tenantId: string,
      challengeId: string,
      to: string,
      message: { readonly subject: string; readonly text: string; readonly html?: string },
    ) =>
      mailer
        .send({
          to,
          subject: message.subject,
          text: message.text,
          ...(message.html === undefined ? {} : { html: message.html }),
        })
        .pipe(
        Effect.catchTag('MailUnavailable', (failed) =>
          withDb(spend(challengeId)).pipe(
            Effect.orDie,
            Effect.andThen(Effect.fail(new MailNotSent())),
            Effect.tap(() =>
              Effect.logWarning('a link could not be mailed and was spent').pipe(
                Effect.annotateLogs({ tenantId, reason: failed.reason }),
              ),
            ),
          ),
        ),
      )

    const writeCredential = Effect.fn('Auth.email.writeCredential')(function* (
      tenantId: string,
      person: Person,
      door: { readonly id: string },
      credentialHash: string,
      keep: string | undefined,
      actor: Principal,
    ) {
      const standing = yield* credentialOf(tenantId, person.id, door.id)
      const bindingId =
        standing === undefined
          ? (yield* db.query((k) =>
              k
                .insertInto('UserAuthBinding')
                .values({
                  tenantId,
                  userId: person.id,
                  authProviderId: door.id,
                  subject: null,
                  credentialHash,
                })
                .returning('id')
                .executeTakeFirstOrThrow(),
            )).id
          : (yield* db.query((k) =>
              k
                .updateTable('UserAuthBinding')
                .set({ credentialHash })
                .where('tenantId', '=', tenantId)
                .where('id', '=', standing.id)
                .returning('id')
                .executeTakeFirstOrThrow(),
            )).id
      const endedSessions = yield* endSessions(tenantId, person.id, keep)
      yield* audit.record(BindingWritten, {
        tenantId,
        actor: yield* actorOf(tenantId, actor),
        target: { id: person.id, label: person.displayName },
        ...(person.primaryOrgNodeId === null ? {} : { organizationId: person.primaryOrgNodeId }),
        details: { providerId: door.id, bindingId, replaced: standing !== undefined, endedSessions },
      })
    })

    const inLock = <A, E, R>(tenantId: string, body: Effect.Effect<A, E, R>) =>
      withDb(
        transaction(
          Effect.gen(function* () {
            yield* lockTenant(tenantId)
            return yield* body
          }),
        ),
      ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error)))

    return EmailFlows.of({
      requestReset: Effect.fn('Auth.email.requestReset')(function* ({ email, locale, captcha: proof }) {
        const tenant = yield* tenants.resolve.pipe(Effect.option)
        if (Option.isNone(tenant)) return
        const tenantId = tenant.value.id
        const context = Option.getOrUndefined(yield* currentRequestContext)
        const normalized = normalizeEmail(email) ?? email.trim().toLowerCase()
        const place = context?.clientIp ?? 'unknown'
        // Everything up to the lookup is the same for an address nobody has,
        // one that is not verified and one without a password: the answers
        // must not tell them apart.
        yield* withDb(
          Effect.gen(function* () {
            const fuse = yield* limiter.consumeHard(tenantId, HARD_LIMITS.resetByAddressHard, place)
            if (!fuse.allowed) {
              return yield* new TooManyAttempts({ retryAfterSeconds: fuse.retryAfterSeconds })
            }
            const here = yield* limiter.observeRisk(tenantId, RISK_RULES.resetByAddressRisk, place)
            // counted as it is weighed, like sign-in: requests arriving
            // together cannot all find the address unasked-for
            const again = yield* limiter.observeRisk(
              tenantId,
              RISK_RULES.resetByIdentifierRisk,
              normalized,
            )
            if (here.challengeRequired || again.challengeRequired || context?.clientIp === undefined) {
              const guarded = yield* captcha.guard({
                tenantId,
                purpose: PASSWORD_RESET_CAPTCHA,
                bindingKey: normalized,
                ...(proof === undefined ? {} : { proof }),
              })
              if (guarded.kind === 'required') {
                return yield* new CaptchaRequired({
                  provider: guarded.prompt.provider,
                  challenge: { ...guarded.prompt.challenge },
                })
              }
            }
            // only now, past the challenge, does the request count against
            // the mail this address may be sent
            const quota = yield* limiter.consumeHard(
              tenantId,
              HARD_LIMITS.resetMailByIdentifierHard,
              normalized,
            )
            if (!quota.allowed) {
              return yield* new TooManyAttempts({ retryAfterSeconds: quota.retryAfterSeconds })
            }
          }),
        )
        const issued = yield* inLock(
          tenant.value.id,
          Effect.gen(function* () {
            const found = yield* personByVerifiedEmail(tenant.value.id, normalized)
            if (found === undefined) return undefined
            const person = yield* personOf(tenant.value.id, found.id)
            if (person === undefined) return undefined
            if ((yield* passwordDoor(tenant.value.id, person)) === undefined) return undefined
            return { person, challenge: yield* issueChallenge(tenant.value.id, person.id, 'reset', null) }
          }),
        )
        if (issued === undefined) return
        const link = yield* withDb(
          linkTo(tenant.value.id, RESET_PASSWORD_PATH, {
            token: Redacted.value(issued.challenge.token),
          }),
        ).pipe(Effect.orDie)
        // after the answer, on its own: its time is nobody's business, and a
        // failure is spent and logged rather than told to a stranger
        yield* Effect.forkIn(
          deliver(
            tenant.value.id,
            issued.challenge.id,
            normalized,
            mailFor('reset', locale, link, { to: normalized, workspace: tenant.value.name }),
          ).pipe(
            Effect.ignore,
          ),
          scope,
        )
      }),

      redeemReset: Effect.fn('Auth.email.redeemReset')(function* ({ token, password }) {
        const tenant = yield* tenants.resolve.pipe(Effect.option)
        if (Option.isNone(tenant)) return yield* new ChallengeInvalid()
        const tenantId = tenant.value.id
        yield* inLock(
          tenantId,
          Effect.gen(function* () {
            const taken = yield* redeemChallenge(token, 'reset')
            if (taken === undefined || taken.tenantId !== tenantId) return yield* new ChallengeInvalid()
            const person = yield* personOf(tenantId, taken.userId)
            // the person may have lost the address the link went to since
            if (person === undefined || person.emailVerifiedAt === null) {
              return yield* new ChallengeInvalid()
            }
            const door = yield* passwordDoor(tenantId, person)
            if (door === undefined) return yield* new ChallengeInvalid()
            const prepared = yield* door.binding.prepare({ secret: password })
            if (!prepared.ok) return yield* new AuthBindingCredentialInvalid()
            // everywhere they were signed in ends: whoever else knew the old
            // password is now on the outside
            yield* writeCredential(tenantId, person, door, prepared.credentialHash, undefined, {
              tenantId,
              userId: person.id,
              sessionId: '',
            })
            // the password is set: every other reset link still open is
            // spent with this one, in the same lock, so two used at once
            // cannot both set it
            yield* retireChallenges(tenantId, person.id, ['reset'])
          }),
        )
      }),

      requestVerification: Effect.fn('Auth.email.requestVerification')(function* (
        principal,
        locale,
      ) {
        const issued = yield* inLock(
          principal.tenantId,
          Effect.gen(function* () {
            const person = yield* personOf(principal.tenantId, principal.userId)
            if (person === undefined || person.email === null) return yield* new EmailMissing()
            if (person.emailVerifiedAt !== null) return undefined
            yield* throttle(principal.tenantId, HARD_LIMITS.mailBySelf, principal.userId)
            return {
              email: person.email,
              challenge: yield* issueChallenge(principal.tenantId, person.id, 'verify', person.email),
            }
          }),
        )
        if (issued === undefined) return { sent: false }
        const link = yield* withDb(
          linkTo(principal.tenantId, CONFIRM_EMAIL_PATH, {
            purpose: 'verify',
            token: Redacted.value(issued.challenge.token),
          }),
        ).pipe(Effect.orDie)
        yield* deliver(
          principal.tenantId,
          issued.challenge.id,
          issued.email,
          mailFor('verify', locale, link, {
            to: issued.email,
            workspace: yield* workspaceOf(principal.tenantId),
          }),
        )
        return { sent: true }
      }),

      redeemVerification: Effect.fn('Auth.email.redeemVerification')(function* (token) {
        const tenant = yield* tenants.resolve.pipe(Effect.option)
        if (Option.isNone(tenant)) return yield* new ChallengeInvalid()
        const tenantId = tenant.value.id
        yield* inLock(
          tenantId,
          Effect.gen(function* () {
            const taken = yield* redeemChallenge(token, 'verify')
            if (taken === undefined || taken.tenantId !== tenantId) return yield* new ChallengeInvalid()
            // proves the address it was sent to, and only while that is still
            // the address on file: a link to a replaced address proves nothing
            const marked = yield* db.query((k) =>
              k
                .updateTable('User')
                .set({ emailVerifiedAt: sql<Date>`now()` })
                .where('tenantId', '=', tenantId)
                .where('id', '=', taken.userId)
                .where('email', '=', taken.targetEmail!)
                .where('deletedAt', 'is', null)
                .returning('id')
                .execute(),
            )
            if (marked.length === 0) return yield* new ChallengeInvalid()
          }),
        )
      }),

      requestChange: Effect.fn('Auth.email.requestChange')(function* (principal, input) {
        const normalized = normalizeEmail(input.newEmail)
        if (normalized === null) return yield* new UserEmailConflict()
        const issued = yield* inLock(
          principal.tenantId,
          Effect.gen(function* () {
            const person = yield* personOf(principal.tenantId, principal.userId)
            if (person === undefined) return yield* new UserNotFound()
            // the recovery account's address is the seed's to set
            if (person.isSystem) return yield* new SystemAccountProtected()
            if ((yield* emailTaken(principal.tenantId, normalized, person.id)) !== undefined) {
              return yield* new UserEmailConflict()
            }
            yield* throttle(principal.tenantId, HARD_LIMITS.mailBySelf, principal.userId)
            return yield* issueChallenge(principal.tenantId, person.id, 'change', normalized)
          }),
        )
        const link = yield* withDb(
          linkTo(principal.tenantId, CONFIRM_EMAIL_PATH, {
            purpose: 'change',
            token: Redacted.value(issued.token),
          }),
        ).pipe(Effect.orDie)
        // to the new address: following the link is what proves it theirs
        yield* deliver(
          principal.tenantId,
          issued.id,
          normalized,
          mailFor('change', input.locale, link, {
            to: normalized,
            workspace: yield* workspaceOf(principal.tenantId),
          }),
        )
      }),

      redeemChange: Effect.fn('Auth.email.redeemChange')(function* (token) {
        const tenant = yield* tenants.resolve.pipe(Effect.option)
        if (Option.isNone(tenant)) return yield* new ChallengeInvalid()
        const tenantId = tenant.value.id
        yield* inLock(
          tenantId,
          Effect.gen(function* () {
            const taken = yield* redeemChallenge(token, 'change')
            if (taken === undefined || taken.tenantId !== tenantId) return yield* new ChallengeInvalid()
            const person = yield* personOf(tenantId, taken.userId)
            if (person === undefined || person.isSystem) return yield* new ChallengeInvalid()
            if ((yield* emailTaken(tenantId, taken.targetEmail!, person.id)) !== undefined) {
              return yield* new UserEmailConflict()
            }
            yield* db.query((k) =>
              k
                .updateTable('User')
                .set({
                  email: taken.targetEmail,
                  emailVerifiedAt: sql<Date>`now()`,
                  version: sql<number>`version + 1`,
                  updatedAt: sql<Date>`now()`,
                })
                .where('tenantId', '=', tenantId)
                .where('id', '=', person.id)
                .execute(),
            )
            // links to the old address are links to somebody else's inbox now
            yield* retireChallenges(tenantId, person.id, ['verify', 'reset', 'change'])
            yield* audit.record(UserUpdated, {
              tenantId,
              actor: yield* actorOf(tenantId, { tenantId, userId: person.id, sessionId: '' }),
              target: { id: person.id, label: person.displayName },
              ...(person.primaryOrgNodeId === null
                ? {}
                : { organizationId: person.primaryOrgNodeId }),
              details: { fields: ['email'] },
            })
          }),
        )
      }),

      setPassword: Effect.fn('Auth.email.setPassword')(function* (principal, input) {
        const tenantId = principal.tenantId
        // the digest is worked out before the lock, as an administrator's is
        const person = yield* withDb(personOf(tenantId, principal.userId)).pipe(Effect.orDie)
        if (person === undefined) return yield* new UserNotFound()
        const door = yield* withDb(passwordDoor(tenantId, person)).pipe(Effect.orDie)
        if (door === undefined) return yield* new PasswordUnavailable()
        const standing = yield* withDb(credentialOf(tenantId, person.id, door.id)).pipe(Effect.orDie)
        if (standing?.credentialHash != null) {
          yield* withDb(throttle(tenantId, HARD_LIMITS.passwordBySelf, person.id))
          const right =
            input.currentPassword !== undefined &&
            (yield* door.binding.verify({
              secret: input.currentPassword,
              credentialHash: standing.credentialHash,
            }))
          if (!right) return yield* new PasswordIncorrect()
        } else if (person.emailVerifiedAt === null) {
          // somebody with no password yet sets one only on a proven address
          return yield* new EmailUnverified()
        }
        const prepared = yield* door.binding.prepare({ secret: input.newPassword })
        if (!prepared.ok) return yield* new AuthBindingCredentialInvalid()
        yield* inLock(
          tenantId,
          Effect.gen(function* () {
            const again = yield* personOf(tenantId, person.id)
            if (again === undefined) return yield* new UserNotFound()
            // every other session ends; the one that changed it goes on
            yield* writeCredential(tenantId, again, door, prepared.credentialHash, principal.sessionId, principal)
          }),
        )
      }),
    })
  }),
)
