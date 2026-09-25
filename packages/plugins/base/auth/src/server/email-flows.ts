import { createHash, randomBytes } from 'node:crypto'
import { Context, Effect, Layer, Option, Redacted } from 'effect'
import { sql } from 'kysely'
import { transaction, withDatabase, type Orm } from '@qualy/plugin-database/server'
import { Audit } from '@qualy/audit-contract/effect'
import { normalizeEmail } from '@qualy/auth-contract/email'
import { LoginDrivers, type SecretChecks } from '@qualy/auth-contract/login'
import { TooManyAttempts } from '@qualy/auth-contract/session'
import { ReauthenticationRequired } from '@qualy/auth-contract/sign-in-failure'
import { currentRequestContext } from '@qualy/api-kit/request'
import { Mailer } from '@qualy/plugin-mail/plugin'
import type { Principal } from '@qualy/rbac-contract'
import { Secrets } from '@qualy/plugin-secrets/plugin'
import { BindingWritten, UserUpdated } from '../actions.ts'
import { CONFIRM_EMAIL_PATH, RESET_PASSWORD_PATH } from '../constants.ts'
import { actorOf } from './audit-actor.ts'
import { db, lockTenant } from './db.ts'
import { secretSubjectOf } from './secret-subject.ts'
import {
  AuthBindingCredentialInvalid,
  ChallengeInvalid,
  DemoAccountLocked,
  EmailMissing,
  EmailUnverified,
  MailNotSent,
  PasswordIncorrect,
  PasswordUnavailable,
  ReauthenticationCodeInvalid,
  ReauthenticationMethodUnavailable,
  SystemAccountProtected,
  UserEmailConflict,
  UserNotFound,
} from './errors.ts'
import { captchaPurpose, CaptchaRequired, type CaptchaProof } from '@qualy/plugin-captcha/contract'
import { Captcha } from '@qualy/plugin-captcha/server'
import { HARD_LIMITS, makeLimiter, RISK_RULES, type HardLimitRule } from './limiter.ts'
import { mailFor, noticeFor, type MailLocale, type MailPurpose } from './mail-copy.ts'
import { makeReauthentication, requireReauthenticated } from './reauthentication.ts'
import { PublicOriginResolver } from './public-origin.ts'
import { AnonymousTenantResolver } from './tenancy.ts'
import { doorsOf } from './self.ts'
import { AuthConfig } from './auth-config.ts'
import { isDemoAccount } from './demo-accounts.ts'
import { makeDemoGuard } from './demo-guard.ts'

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

/** how long somebody turned away for presenting a link twice at once is told to wait */
const RETRY_SOON = 2

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

const insertChallenge = (
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

/** the same link redeemChallenge would take, left where it is */
const openChallenge = (token: string, purpose: MailPurpose) =>
  db.query((k) =>
    k
      .selectFrom('UserEmailChallenge')
      .select(['tenantId', 'userId'])
      .where('tokenHash', '=', digest(token))
      .where('purpose', '=', purpose)
      .where('consumedAt', 'is', null)
      .where('expiresAt', '>', sql<Date>`now()`)
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
    }) => Effect.Effect<void, ChallengeInvalid | AuthBindingCredentialInvalid | TooManyAttempts>
    /** whether a reset link would still be taken, without taking it */
    readonly inspectReset: (input: {
      readonly token: string
    }) => Effect.Effect<void, ChallengeInvalid>
    /** the checks the password a reset link would set is held to, while it is typed */
    readonly assessReset: (input: {
      readonly token: string
      readonly password: string
    }) => Effect.Effect<SecretChecks, ChallengeInvalid | TooManyAttempts>
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
      | UserEmailConflict
      | SystemAccountProtected
      | MailNotSent
      | TooManyAttempts
      | UserNotFound
      | DemoAccountLocked
      | ReauthenticationRequired
    >
    readonly redeemChange: (
      token: string,
    ) => Effect.Effect<void, ChallengeInvalid | UserEmailConflict>
    /** the checks a new password of the reader's own is held to, while it is typed */
    readonly assessPassword: (
      principal: Principal,
      input: { readonly password: string },
    ) => Effect.Effect<SecretChecks, PasswordUnavailable | UserNotFound | TooManyAttempts>
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
      | DemoAccountLocked
      | ReauthenticationRequired
    >
    /**
     * The session in hand shows it is its owner's: with the password when
     * the account has one, or else with the code last mailed to it. Answers
     * until when it stands so.
     */
    readonly reauthenticate: (
      principal: Principal,
      proof:
        | { readonly method: 'password'; readonly password: string }
        | { readonly method: 'code'; readonly code: string },
    ) => Effect.Effect<
      { readonly until: Date | string },
      | UserNotFound
      | PasswordIncorrect
      | ReauthenticationCodeInvalid
      | ReauthenticationMethodUnavailable
      | ReauthenticationRequired
      | TooManyAttempts
    >
    /** a code to show it is them, mailed to the address they proved, for an account with no password */
    readonly sendReauthenticationCode: (
      principal: Principal,
      locale: MailLocale,
    ) => Effect.Effect<
      void,
      UserNotFound | ReauthenticationMethodUnavailable | MailNotSent | TooManyAttempts
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
  | AuthConfig
> = Layer.effect(
  EmailFlows,
  Effect.gen(function* () {
    const withDb = yield* withDatabase
    const guardDemo = yield* makeDemoGuard
    const demoAccounts = (yield* AuthConfig).demoAccounts
    const mailer = yield* Mailer
    const audit = yield* Audit
    const drivers = yield* LoginDrivers
    const origins = yield* PublicOriginResolver
    const tenants = yield* AnonymousTenantResolver
    const limiter = yield* makeLimiter
    const captcha = yield* Captcha
    const reauthentication = yield* makeReauthentication
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

    /**
     * A link is issued only when it can be written down. Without the
     * address this deployment is reached at there is no link to mail, and
     * refusing inside the transaction undoes whatever it counted for the
     * request: no link is left open and no quota is spent on it.
     */
    const issueChallenge = (...args: Parameters<typeof insertChallenge>) =>
      origins.configured
        ? insertChallenge(...args)
        : Effect.logWarning(
            'a link was asked for, and QUALY_PUBLIC_URL is not set to write it with',
          ).pipe(Effect.andThen(Effect.fail(new MailNotSent())))

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

    /**
     * How this person shows it is them: the password when they hold one at
     * the password door open to them, else a code to the address they
     * proved. Undefined when neither is theirs to use.
     */
    const ownProofOf = Effect.fn('Auth.email.ownProof')(function* (
      tenantId: string,
      person: Person,
    ) {
      const door = yield* passwordDoor(tenantId, person)
      const standing =
        door === undefined ? undefined : yield* credentialOf(tenantId, person.id, door.id)
      if (door !== undefined && standing?.credentialHash != null) {
        return { method: 'password', door, credentialHash: standing.credentialHash } as const
      }
      if (person.email !== null && person.emailVerifiedAt !== null) {
        return { method: 'code', email: person.email } as const
      }
      return undefined
    })

    /**
     * The person a reset link is for and the door it would set a password
     * at, when redeeming it now would get that far; read, not taken. The
     * same conditions redeemReset holds a link to.
     */
    const openReset = (token: string) =>
      Effect.gen(function* () {
        const tenant = yield* tenants.resolve.pipe(Effect.option)
        if (Option.isNone(tenant)) return yield* new ChallengeInvalid()
        const tenantId = tenant.value.id
        return yield* withDb(
          Effect.gen(function* () {
            const open = yield* openChallenge(token, 'reset')
            if (open === undefined || open.tenantId !== tenantId)
              return yield* new ChallengeInvalid()
            const person = yield* personOf(tenantId, open.userId)
            if (person === undefined || person.emailVerifiedAt === null) {
              return yield* new ChallengeInvalid()
            }
            const door = yield* passwordDoor(tenantId, person)
            if (door === undefined) return yield* new ChallengeInvalid()
            return { tenantId, person, door }
          }),
        ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error)))
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
      // a move to another address asked for in a session that just ended
      // must not outlive it in somebody's inbox
      yield* retireChallenges(tenantId, person.id, ['change'])
      yield* audit.record(BindingWritten, {
        tenantId,
        actor: yield* actorOf(tenantId, actor),
        target: { id: person.id, label: person.displayName },
        ...(person.primaryOrgNodeId === null ? {} : { organizationId: person.primaryOrgNodeId }),
        details: {
          providerId: door.id,
          bindingId,
          replaced: standing !== undefined,
          endedSessions,
        },
      })
    })

    /**
     * The reset links being redeemed in this process right now, by digest.
     *
     * Only one redemption of a link can ever set a password, so a second
     * one arriving while the first is still working out its digest is
     * turned away rather than queued behind it: a link is anonymous to
     * present, and every copy of it presented at once would otherwise be
     * one more hash in the line every sign-in waits in.
     */
    const redeeming = new Set<string>()
    const oneAtATime = <A, E, R>(token: string, body: Effect.Effect<A, E, R>) => {
      const key = digest(token)
      return Effect.acquireUseRelease(
        Effect.sync(() => {
          if (redeeming.has(key)) return false
          redeeming.add(key)
          return true
        }),
        (mine): Effect.Effect<A, E | TooManyAttempts, R> =>
          mine ? body : Effect.fail(new TooManyAttempts({ retryAfterSeconds: RETRY_SOON })),
        (mine) =>
          Effect.sync(() => {
            if (mine) redeeming.delete(key)
          }),
      )
    }

    const inLock = <A, E, R>(tenantId: string, body: Effect.Effect<A, E, R>) =>
      withDb(
        transaction(
          Effect.gen(function* () {
            yield* lockTenant(tenantId)
            return yield* body
          }),
        ),
      ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error)))

    /**
     * A link that would not be taken is answered before anything is locked:
     * anybody may present one, and the tenant's row is every structural
     * write's queue. Taking it up stays inside the lock, where two presented
     * at once are decided.
     */
    const unlessIssued = (tenantId: string, token: string, purpose: MailPurpose) =>
      withDb(openChallenge(token, purpose)).pipe(
        Effect.orDie,
        Effect.flatMap((open) =>
          open === undefined || open.tenantId !== tenantId
            ? Effect.fail(new ChallengeInvalid())
            : Effect.void,
        ),
      )

    return EmailFlows.of({
      requestReset: Effect.fn('Auth.email.requestReset')(function* ({
        email,
        locale,
        captcha: proof,
      }) {
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
            if (
              here.challengeRequired ||
              again.challengeRequired ||
              context?.clientIp === undefined
            ) {
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
        // Looked up before anything is locked: an address nobody holds, which
        // is what a stream of made-up ones is, costs nobody the tenant's row,
        // the queue every structural write waits in. Whoever it names is
        // asked about again inside the lock.
        const candidate = yield* withDb(personByVerifiedEmail(tenantId, normalized)).pipe(
          Effect.catchTag('QueryFailed', (error) => Effect.die(error)),
        )
        if (candidate === undefined) return
        const issued = yield* inLock(
          tenant.value.id,
          Effect.gen(function* () {
            const found = yield* personByVerifiedEmail(tenant.value.id, normalized)
            if (found === undefined) return undefined
            const person = yield* personOf(tenant.value.id, found.id)
            if (person === undefined) return undefined
            // a shared demonstration account is never reset, and says so to
            // nobody: the answer is the one any other address gets
            if (isDemoAccount(demoAccounts, person.email)) return undefined
            if ((yield* passwordDoor(tenant.value.id, person)) === undefined) return undefined
            return {
              person,
              challenge: yield* issueChallenge(tenant.value.id, person.id, 'reset', null),
            }
          }),
        ).pipe(
          // a link nobody can be sent is the answer every other address
          // gets: whether this one has a person behind it stays unsaid
          Effect.catchTag('AUTH_MAIL_NOT_SENT', () => Effect.succeed(undefined)),
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
          ).pipe(Effect.ignore),
          scope,
        )
      }),

      inspectReset: Effect.fn('Auth.email.inspectReset')(function* ({ token }) {
        yield* openReset(token)
      }),

      assessReset: Effect.fn('Auth.email.assessReset')(function* ({ token, password }) {
        const { tenantId, person, door } = yield* openReset(token)
        yield* throttle(tenantId, HARD_LIMITS.passwordAssessment, `reset:${person.id}`)
        const subject = yield* withDb(secretSubjectOf(tenantId, person.id)).pipe(Effect.orDie)
        return yield* door.binding.assess({ secret: password, subject })
      }),

      redeemReset: Effect.fn('Auth.email.redeemReset')(function* ({ token, password }) {
        // The link is looked at, and the digest worked out, before anything
        // is locked, as a password set any other way is: a link nobody
        // issued costs nobody a lock, and a digest that queues behind others
        // holds the tenant's row for none of that time. Whether it may still
        // be written is asked again inside the lock.
        const { tenantId, person: asked, door: askedAt } = yield* openReset(token)
        // a password judged through the link, counted as one judged while
        // typed is: a link that keeps being handed passwords the door will
        // not take is never taken up, and could be handed them forever
        yield* throttle(tenantId, HARD_LIMITS.passwordAssessment, `reset:${asked.id}`)
        yield* oneAtATime(
          token,
          Effect.gen(function* () {
            const prepared = yield* askedAt.binding.prepare({
              secret: password,
              subject: yield* withDb(secretSubjectOf(tenantId, asked.id)).pipe(Effect.orDie),
            })
            if (!prepared.ok)
              return yield* new AuthBindingCredentialInvalid({ checks: prepared.checks })
            yield* inLock(
              tenantId,
              Effect.gen(function* () {
                const taken = yield* redeemChallenge(token, 'reset')
                if (taken === undefined || taken.tenantId !== tenantId || taken.userId !== asked.id)
                  return yield* new ChallengeInvalid()
                const person = yield* personOf(tenantId, taken.userId)
                // the person may have lost the address the link went to since
                if (person === undefined || person.emailVerifiedAt === null) {
                  return yield* new ChallengeInvalid()
                }
                const door = yield* passwordDoor(tenantId, person)
                if (door === undefined || door.id !== askedAt.id)
                  return yield* new ChallengeInvalid()
                // everywhere they were signed in ends: whoever else knew the
                // old password is now on the outside
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
        )
      }),

      requestVerification: Effect.fn('Auth.email.requestVerification')(
        function* (principal, locale) {
          const issued = yield* inLock(
            principal.tenantId,
            Effect.gen(function* () {
              const person = yield* personOf(principal.tenantId, principal.userId)
              if (person === undefined || person.email === null) return yield* new EmailMissing()
              if (person.emailVerifiedAt !== null) return undefined
              yield* throttle(principal.tenantId, HARD_LIMITS.mailBySelf, principal.userId)
              return {
                email: person.email,
                challenge: yield* issueChallenge(
                  principal.tenantId,
                  person.id,
                  'verify',
                  person.email,
                ),
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
        },
      ),

      redeemVerification: Effect.fn('Auth.email.redeemVerification')(function* (token) {
        const tenant = yield* tenants.resolve.pipe(Effect.option)
        if (Option.isNone(tenant)) return yield* new ChallengeInvalid()
        const tenantId = tenant.value.id
        yield* unlessIssued(tenantId, token, 'verify')
        yield* inLock(
          tenantId,
          Effect.gen(function* () {
            const taken = yield* redeemChallenge(token, 'verify')
            if (taken === undefined || taken.tenantId !== tenantId)
              return yield* new ChallengeInvalid()
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
            yield* guardDemo(principal.tenantId, person.id)
            // where the account's mail goes is where it is recovered from:
            // a session alone does not move it
            yield* requireReauthenticated(principal.tenantId, principal.sessionId)
            // counted before the address is looked up, and kept when it is
            // somebody's: asking is how anybody would learn whose it is
            yield* throttle(principal.tenantId, HARD_LIMITS.mailBySelf, principal.userId)
            if ((yield* emailTaken(principal.tenantId, normalized, person.id)) !== undefined) {
              return undefined
            }
            return yield* issueChallenge(principal.tenantId, person.id, 'change', normalized)
          }),
        )
        if (issued === undefined) return yield* new UserEmailConflict()
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
        yield* unlessIssued(tenantId, token, 'change')
        yield* inLock(
          tenantId,
          Effect.gen(function* () {
            const taken = yield* redeemChallenge(token, 'change')
            if (taken === undefined || taken.tenantId !== tenantId)
              return yield* new ChallengeInvalid()
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

      assessPassword: Effect.fn('Auth.email.assessPassword')(function* (principal, input) {
        const tenantId = principal.tenantId
        yield* throttle(tenantId, HARD_LIMITS.passwordAssessment, principal.userId)
        const person = yield* withDb(personOf(tenantId, principal.userId)).pipe(Effect.orDie)
        if (person === undefined) return yield* new UserNotFound()
        const door = yield* withDb(passwordDoor(tenantId, person)).pipe(Effect.orDie)
        if (door === undefined) return yield* new PasswordUnavailable()
        const subject = yield* withDb(secretSubjectOf(tenantId, person.id)).pipe(Effect.orDie)
        return yield* door.binding.assess({ secret: input.password, subject })
      }),

      setPassword: Effect.fn('Auth.email.setPassword')(function* (principal, input) {
        const tenantId = principal.tenantId
        // the digest is worked out before the lock, as an administrator's is
        const person = yield* withDb(personOf(tenantId, principal.userId)).pipe(Effect.orDie)
        if (person === undefined) return yield* new UserNotFound()
        yield* guardDemo(tenantId, person.id)
        const door = yield* withDb(passwordDoor(tenantId, person)).pipe(Effect.orDie)
        if (door === undefined) return yield* new PasswordUnavailable()
        const standing = yield* withDb(credentialOf(tenantId, person.id, door.id)).pipe(
          Effect.orDie,
        )
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
        } else {
          // a first password is a new way in: the session in hand shows it
          // is its owner's first, since there is no old password to ask for
          yield* withDb(requireReauthenticated(tenantId, principal.sessionId)).pipe(
            Effect.catchTag('QueryFailed', (error) => Effect.die(error)),
          )
          // no password to check, and a digest to work out all the same:
          // counted as a try at one would be
          yield* withDb(throttle(tenantId, HARD_LIMITS.passwordBySelf, person.id))
        }
        const prepared = yield* door.binding.prepare({
          secret: input.newPassword,
          subject: yield* withDb(secretSubjectOf(tenantId, person.id)).pipe(Effect.orDie),
        })
        if (!prepared.ok)
          return yield* new AuthBindingCredentialInvalid({ checks: prepared.checks })
        yield* inLock(
          tenantId,
          Effect.gen(function* () {
            const again = yield* personOf(tenantId, person.id)
            if (again === undefined) return yield* new UserNotFound()
            // every other session ends; the one that changed it goes on
            yield* writeCredential(
              tenantId,
              again,
              door,
              prepared.credentialHash,
              principal.sessionId,
              principal,
            )
          }),
        )
      }),

      reauthenticate: Effect.fn('Auth.email.reauthenticate')(function* (principal, proof) {
        const tenantId = principal.tenantId
        const person = yield* withDb(personOf(tenantId, principal.userId)).pipe(Effect.orDie)
        if (person === undefined) return yield* new UserNotFound()
        const own = yield* withDb(ownProofOf(tenantId, person)).pipe(Effect.orDie)
        if (own?.method !== proof.method) return yield* new ReauthenticationMethodUnavailable()
        if (own.method === 'password' && proof.method === 'password') {
          // tried as a current password is tried when it is changed
          yield* withDb(throttle(tenantId, HARD_LIMITS.passwordBySelf, person.id))
          const right = yield* own.door.binding.verify({
            secret: proof.password,
            credentialHash: own.credentialHash,
          })
          if (!right) return yield* new PasswordIncorrect()
        } else {
          // counted where a wrong code rolls nothing back
          yield* withDb(throttle(tenantId, HARD_LIMITS.reauthenticationCodeBySelf, person.id))
        }
        const until = yield* withDb(
          transaction(
            Effect.gen(function* () {
              if (proof.method === 'code') {
                const right = yield* reauthentication.takeCode(
                  tenantId,
                  principal.sessionId,
                  proof.code,
                )
                if (!right) return yield* new ReauthenticationCodeInvalid()
              }
              return yield* reauthentication.mark(
                tenantId,
                principal.sessionId,
                proof.method === 'code' ? 'code' : 'password',
              )
            }),
          ),
        ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error)))
        // the session ended between the question and the answer
        if (until === undefined) return yield* new ReauthenticationRequired()
        return { until }
      }),

      sendReauthenticationCode: Effect.fn('Auth.email.sendReauthenticationCode')(
        function* (principal, locale) {
          const tenantId = principal.tenantId
          const person = yield* withDb(personOf(tenantId, principal.userId)).pipe(Effect.orDie)
          if (person === undefined) return yield* new UserNotFound()
          const own = yield* withDb(ownProofOf(tenantId, person)).pipe(Effect.orDie)
          if (own?.method !== 'code') return yield* new ReauthenticationMethodUnavailable()
          // a code is mail somebody is sent, counted as a link to them is
          yield* withDb(throttle(tenantId, HARD_LIMITS.mailBySelf, person.id))
          const code = yield* withDb(
            transaction(reauthentication.issueCode(tenantId, principal.sessionId)),
          ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error)))
          // the session ended between the question and the answer; nothing to send it to
          if (code === undefined) return yield* new ReauthenticationMethodUnavailable()
          const slug = (yield* withDb(tenantSlug(tenantId)).pipe(Effect.orDie)).slug
          const origin = yield* origins
            .resolve({ id: tenantId, slug })
            .pipe(Effect.option, Effect.map(Option.getOrNull))
          const message = noticeFor('reauthentication-code', locale, {
            to: own.email,
            workspace: yield* workspaceOf(tenantId),
            origin: origin === null ? null : origin.toString(),
            code: Redacted.value(code),
          })
          yield* mailer
            .send({ to: own.email, ...message })
            .pipe(
              Effect.catchTag('MailUnavailable', (failed) =>
                withDb(reauthentication.dropCode(tenantId, principal.sessionId)).pipe(
                  Effect.orDie,
                  Effect.andThen(
                    Effect.logWarning('a code could not be mailed and was taken back').pipe(
                      Effect.annotateLogs({ tenantId, reason: failed.reason }),
                    ),
                  ),
                  Effect.andThen(Effect.fail(new MailNotSent())),
                ),
              ),
            )
        },
      ),
    })
  }),
)
