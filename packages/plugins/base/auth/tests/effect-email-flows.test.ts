import { literal } from '@qualy/i18n-contract'
import { booted } from '@qualy/rbac-contract/testkit'
import { compileCatalog } from '@qualy/rbac-contract/plugin'
import { permissions as authPermissions } from '@qualy/plugin-auth/permissions'
import { uiLayer } from '@qualy/plugin-ui-registry/server/registry'
import { sql } from 'kysely'
import { Cause, Effect, Exit, Layer } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import {
  createTestContext,
  databaseFor,
  postgresAvailable,
  runSql,
} from '@qualy/plugin-database/testkit'
import { secretsLayer } from '@qualy/plugin-secrets/testkit'
import { captchaLayer, captchaLayerWith } from '@qualy/plugin-captcha/testkit'
import type { CaptchaProvider } from '@qualy/plugin-captcha/server'
import { RequestContext } from '@qualy/api-kit/request'
import { mailerLayerWith, memoryMailBackend } from '@qualy/plugin-mail/testkit'
import { smtpBackend } from '@qualy/plugin-mail-smtp/backend'
import { type Orm } from '@qualy/plugin-database/server'
import type { Principal } from '@qualy/rbac-contract'
import { serviceLayer as rbacLayer } from '@qualy/plugin-rbac/server'
import { serviceLayer as auditLayer } from '@qualy/plugin-audit/server'
import { AuditActionCatalog } from '@qualy/audit-contract/effect'
import { compileActionCatalog } from '@qualy/audit-contract/plugin'
import { loginDriversLayer, registerLoginDriver } from '@qualy/auth-contract/login'
import { userActions } from '../src/actions.ts'
import { AuthConfig } from '../src/server/auth-config.ts'
import { EmailFlows, emailFlowsLayer } from '../src/server/email-flows.ts'
import { Iam, serviceLayer as authLayer } from '../src/server/index.ts'
import { SYSTEM_ACCOUNT_USER_TYPE } from '../src/constants.ts'
import { authClosure } from './support/closure.ts'
import { acceptable, standInChecks } from './support/secret-checks.ts'

// What goes through somebody's inbox: a link to set a password, to prove an
// address, to move to a new one - and changing one's own password. The mail
// is kept in memory and read back; the password is a digest a test can
// read, because what is being checked is who may set one, not argon2.

const passwordDoor = registerLoginDriver({
  type: 'local',
  presentation: { mode: 'redirect', href: () => '/nowhere' },
  provisioning: { mode: 'system-singleton', code: 'local', label: literal('Password') },
  resolution: { mode: 'user-field', field: 'email' },
  binding: {
    mode: 'managed',
    secret: { label: { kind: 'literal', value: 'Password' }, minLength: 8, maxLength: 64 },
    // a stand-in judge: long enough, and not the person's own address
    prepare: ({ secret, subject }) =>
      Effect.succeed(
        acceptable(standInChecks(secret, subject))
          ? { ok: true as const, credentialHash: `digest:${secret}` }
          : { ok: false as const, checks: standInChecks(secret, subject) },
      ),
    assess: ({ secret, subject }) => Effect.succeed(standInChecks(secret, subject)),
    verify: ({ secret, credentialHash }) => Effect.succeed(credentialHash === `digest:${secret}`),
  },
})

const PUBLIC_URL = 'https://qualy.example.edu'

const stack = (
  url: string,
  backend: ReturnType<typeof memoryMailBackend>['backend'],
  captcha: typeof captchaLayer = captchaLayer,
  demoAccounts: readonly { email: string; password: string; label: string }[] = [],
) => {
  const services = booted(
    authLayer.pipe(
      Layer.provideMerge(rbacLayer),
      Layer.provideMerge(
        auditLayer.pipe(
          Layer.provide(
            Layer.succeed(
              AuditActionCatalog,
              compileActionCatalog([{ owner: 'auth', actions: userActions }]),
            ),
          ),
        ),
      ),
      Layer.provideMerge(captcha),
      Layer.provideMerge(secretsLayer),
      Layer.provideMerge(
        Layer.mergeAll(
          databaseFor(url, { entities: authClosure }),
          passwordDoor.pipe(Layer.provideMerge(loginDriversLayer)),
          uiLayer,
          Layer.succeed(
            AuthConfig,
            AuthConfig.of({
              defaultTenantSlug: 'default',
              sessionTtlSeconds: 3600,
              secureCookies: false,
              sessionCookieName: 'qualy_session',
              publicUrl: PUBLIC_URL,
              demoAccounts,
            }),
          ),
        ),
      ),
    ),
    { catalog: compileCatalog([{ owner: 'auth', permissions: authPermissions }]) },
  )
  return emailFlowsLayer.pipe(
    Layer.provideMerge(services),
    Layer.provideMerge(mailerLayerWith(backend)),
  )
}

const ok = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isSuccess(exit)) return exit.value
  throw new Error(`expected success, got ${Cause.pretty(exit.cause)}`)
}

const tagOf = (result: { _tag: string; failure?: unknown }) =>
  result._tag === 'Failure' ? (result.failure as { _tag?: string })._tag : undefined

const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!

/**
 * Ada, whose address is proven and who has a password; Lin, whose address is
 * not proven and who has none; and the tenant's system account.
 */
const seed = (url: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const tenant = one<{ id: string }>(
        yield* runSql(sql`insert into tenants (slug, name) values ('default','D') returning id`),
      ).id
      const orgType = one<{ id: string }>(
        yield* runSql(
          sql`insert into org_types (tenant_id, name) values (${tenant}, 'U') returning id`,
        ),
      ).id
      const root = one<{ id: string }>(
        yield* runSql(sql`
          insert into org_nodes (tenant_id, org_type_id, name, path, depth)
          values (${tenant}, ${orgType}, 'Root', 'r', 0) returning id`),
      ).id
      const system = one<{ id: string }>(
        yield* runSql(sql`
          insert into user_types (tenant_id, code, name, placement_mode, is_system)
          values (${tenant}, ${SYSTEM_ACCOUNT_USER_TYPE}, 'System', 'unrestricted', true)
          returning id`),
      ).id
      const staff = one<{ id: string }>(
        yield* runSql(sql`
          insert into user_types (tenant_id, code, name, placement_mode)
          values (${tenant}, 'staff', 'Staff', 'unrestricted') returning id`),
      ).id
      const person = (name: string, email: string, type: string, verified: boolean) =>
        Effect.map(
          runSql(sql`
            insert into users (tenant_id, display_name, user_type_id, primary_org_node_id, email, email_verified_at)
            values (${tenant}, ${name}, ${type}, ${root}, ${email}, ${verified ? sql`now()` : null})
            returning id`),
          (result) => one<{ id: string }>(result).id,
        )
      const admin = yield* person('Admin', 'root@school.edu', system, true)
      const ada = yield* person('Ada', 'ada@school.edu', staff, true)
      const lin = yield* person('Lin', 'lin@school.edu', staff, false)
      const local = one<{ id: string }>(
        yield* runSql(sql`
          insert into auth_providers (tenant_id, code, type, name, is_system, sort_order)
          values (${tenant}, 'local', 'local', 'Local', true, 0) returning id`),
      ).id
      for (const [userId, secret] of [
        [admin, 'admin-password'],
        [ada, 'ada-password'],
      ] as const) {
        yield* runSql(sql`
          insert into user_auth_bindings (tenant_id, user_id, auth_provider_id, subject, credential_hash)
          values (${tenant}, ${userId}, ${local}, null, ${`digest:${secret}`})`)
      }
      const session = (userId: string, mark: string) =>
        Effect.map(
          runSql(sql`
            insert into sessions (tenant_id, user_id, auth_provider_id, token_hash, expires_at)
            values (${tenant}, ${userId}, ${local}, repeat(${mark}, 64), now() + interval '1 day')
            returning id`),
          (result) => one<{ id: string }>(result).id,
        )
      const adaHere = yield* session(ada, 'a')
      const adaElsewhere = yield* session(ada, 'b')
      const linHere = yield* session(lin, 'c')
      const adminHere = yield* session(admin, 'd')
      return {
        tenant,
        admin,
        ada,
        lin,
        local,
        adaHere,
        adaElsewhere,
        linHere,
        adminHere,
        as: (userId: string, sessionId: string): Principal => ({
          tenantId: tenant,
          userId,
          sessionId,
        }),
      }
    }).pipe(Effect.provide(databaseFor(url, { migrations: 'off', entities: authClosure }))),
  )

type Mailbox = ReturnType<typeof memoryMailBackend>

/** the token of the last link sent to an address, read out of the message */
const tokenFrom = async (mail: Mailbox, to: string) => {
  const sent = await vi.waitFor(
    () => {
      const found = mail.outbox.filter((message) => message.to === to).at(-1)
      if (found === undefined) throw new Error(`nothing sent to ${to} yet`)
      return found
    },
    { timeout: 3_000 },
  )
  const link = /https:\/\/\S+/.exec(sent.text)?.[0]
  if (link === undefined) throw new Error(`no link in ${sent.text}`)
  const url = new URL(link)
  return { url, token: new URLSearchParams(url.hash.slice(1)).get('token')!, subject: sent.subject }
}

describe.runIf(postgresAvailable)('a forgotten password', () => {
  it('is set again through a link to a proven address, once, and signs out everywhere', async () => {
    const db = await createTestContext('email-reset')
    const mail = memoryMailBackend()
    try {
      const f = await seed(db.url)
      const run = <A, E>(effect: Effect.Effect<A, E, EmailFlows | Iam | Orm>) =>
        Effect.runPromiseExit(Effect.provide(effect, stack(db.url, mail.backend)))
      // one scope for the request and the mail it sends after answering
      const answer = ok(
        await run(
          Effect.gen(function* () {
            const flows = yield* EmailFlows
            yield* flows.requestReset({ email: ' ADA@school.edu ', locale: 'en' })
            // a stranger's and an unproven address answer exactly the same
            yield* flows.requestReset({ email: 'nobody@school.edu', locale: 'en' })
            yield* flows.requestReset({ email: 'lin@school.edu', locale: 'zh-CN' })
            const link = yield* Effect.promise(() => tokenFrom(mail, 'ada@school.edu'))
            const kept = yield* runSql<{
              purpose: string
              target_email: string | null
              token_hash: string
            }>(sql`select purpose, target_email, token_hash from user_email_challenges`)
            yield* flows.redeemReset({ token: link.token, password: 'a new password' })
            const again = yield* Effect.result(
              flows.redeemReset({ token: link.token, password: 'another password' }),
            )
            const credential = yield* runSql<{ credential_hash: string }>(
              sql`select credential_hash from user_auth_bindings where user_id = ${f.ada} and revoked_at is null`,
            )
            const sessions = yield* runSql<{ count: number }>(
              sql`select count(*)::int as count from sessions where user_id = ${f.ada}`,
            )
            return {
              link,
              kept: kept.rows,
              again,
              credential: credential.rows[0]!,
              sessions: sessions.rows[0]!.count,
            }
          }),
        ),
      )
      expect(answer.link.url.origin + answer.link.url.pathname).toBe(`${PUBLIC_URL}/reset-password`)
      expect(answer.link.subject).toBe('Reset your password')
      // one link, for Ada; only its digest is kept
      expect(answer.kept).toHaveLength(1)
      expect(answer.kept[0]).toMatchObject({ purpose: 'reset', target_email: null })
      expect(answer.kept[0]!.token_hash).not.toBe(answer.link.token)
      expect(mail.outbox.map((message) => message.to)).toEqual(['ada@school.edu'])
      expect(tagOf(answer.again)).toBe('AUTH_CHALLENGE_INVALID')
      expect(answer.credential.credential_hash).toBe('digest:a new password')
      expect(answer.sessions).toBe(0)
    } finally {
      await db.dispose()
    }
  })

  it('is looked at before it is used, and judges a password for its person without taking it', async () => {
    const db = await createTestContext('email-reset-look')
    const mail = memoryMailBackend()
    try {
      await seed(db.url)
      const answer = ok(
        await Effect.runPromiseExit(
          Effect.gen(function* () {
            const flows = yield* EmailFlows
            yield* runSql(sql`update tenants set name = 'Lighthouse'`)
            yield* flows.requestReset({ email: 'ada@school.edu', locale: 'en' })
            const link = yield* Effect.promise(() => tokenFrom(mail, 'ada@school.edu'))
            yield* flows.inspectReset({ token: link.token })
            const fine = yield* flows.assessReset({
              token: link.token,
              password: 'quiet river stones',
            })
            // the workspace's own name is the kind of word a password must not carry
            const personal = yield* flows.assessReset({
              token: link.token,
              password: 'lighthouse keeper',
            })
            const refused = yield* Effect.result(
              flows.redeemReset({ token: link.token, password: 'lighthouse keeper' }),
            )
            // looking and judging took nothing: the link still sets the password
            yield* flows.inspectReset({ token: link.token })
            yield* flows.redeemReset({ token: link.token, password: 'quiet river stones' })
            const spent = yield* Effect.result(flows.inspectReset({ token: link.token }))
            const judgedSpent = yield* Effect.result(
              flows.assessReset({ token: link.token, password: 'quiet river stones' }),
            )
            const unknown = yield* Effect.result(flows.inspectReset({ token: 'not-a-token' }))
            return { fine, personal, refused, spent, judgedSpent, unknown }
          }).pipe(Effect.provide(stack(db.url, mail.backend))),
        ),
      )
      expect(answer.fine).toEqual({ length: true, impersonal: true, unguessable: true })
      expect(answer.personal).toEqual({ length: true, impersonal: false, unguessable: true })
      // the refusal says which check failed, as the form lists them
      expect(answer.refused._tag === 'Failure' && answer.refused.failure).toMatchObject({
        _tag: 'AUTH_BINDING_CREDENTIAL_INVALID',
        checks: { length: true, impersonal: false, unguessable: true },
      })
      expect(tagOf(answer.spent)).toBe('AUTH_CHALLENGE_INVALID')
      expect(tagOf(answer.judgedSpent)).toBe('AUTH_CHALLENGE_INVALID')
      expect(tagOf(answer.unknown)).toBe('AUTH_CHALLENGE_INVALID')
    } finally {
      await db.dispose()
    }
  })

  it('refuses a password the door would not take, and sends one address only so much mail', async () => {
    const db = await createTestContext('email-reset-limits')
    const mail = memoryMailBackend()
    try {
      await seed(db.url)
      const answer = ok(
        await Effect.runPromiseExit(
          Effect.gen(function* () {
            const flows = yield* EmailFlows
            yield* flows.requestReset({ email: 'ada@school.edu', locale: 'en' })
            const link = yield* Effect.promise(() => tokenFrom(mail, 'ada@school.edu'))
            const short = yield* Effect.result(
              flows.redeemReset({ token: link.token, password: 'short' }),
            )
            yield* flows.requestReset({ email: 'ada@school.edu', locale: 'en' })
            yield* flows.requestReset({ email: 'ada@school.edu', locale: 'en' })
            const fourth = yield* Effect.result(
              flows.requestReset({ email: 'ada@school.edu', locale: 'en' }),
            )
            const open = yield* runSql<{ count: number }>(
              sql`select count(*)::int as count from user_email_challenges where consumed_at is null`,
            )
            return { short, fourth, open: open.rows[0]!.count }
          }).pipe(Effect.provide(stack(db.url, mail.backend))),
        ),
      )
      expect(tagOf(answer.short)).toBe('AUTH_BINDING_CREDENTIAL_INVALID')
      // no provider here, so nothing is challenged; the fourth within the
      // hour is refused and sends nothing
      expect(tagOf(answer.fourth)).toBe('TOO_MANY_ATTEMPTS')
      expect(mail.outbox.filter((message) => message.to === 'ada@school.edu')).toHaveLength(3)
      // a newer link does not retire the older: all three still work
      expect(answer.open).toBe(3)
    } finally {
      await db.dispose()
    }
  })
})

describe.runIf(postgresAvailable)('reset links', () => {
  it('stay good side by side until one of them sets the password', async () => {
    const db = await createTestContext('email-reset-links')
    const mail = memoryMailBackend()
    try {
      await seed(db.url)
      const answer = ok(
        await Effect.runPromiseExit(
          Effect.gen(function* () {
            const flows = yield* EmailFlows
            const links: string[] = []
            for (let asked = 0; asked < 3; asked += 1) {
              yield* flows.requestReset({ email: 'ada@school.edu', locale: 'en' })
              yield* Effect.promise(() =>
                vi.waitFor(
                  () => {
                    if (mail.outbox.length < asked + 1) throw new Error('not yet')
                  },
                  { timeout: 3_000 },
                ),
              )
              links.push((yield* Effect.promise(() => tokenFrom(mail, 'ada@school.edu'))).token)
            }
            const openBefore = yield* runSql<{ count: number }>(
              sql`select count(*)::int as count from user_email_challenges
                   where purpose = 'reset' and consumed_at is null`,
            )
            // the first one sent, used last of all would have been the old
            // behaviour's casualty; it works
            yield* flows.redeemReset({ token: links[0]!, password: 'a new password' })
            const second = yield* Effect.result(
              flows.redeemReset({ token: links[1]!, password: 'another password' }),
            )
            const third = yield* Effect.result(
              flows.redeemReset({ token: links[2]!, password: 'yet another one' }),
            )
            return { openBefore: openBefore.rows[0]!.count, second, third }
          }).pipe(Effect.provide(stack(db.url, mail.backend))),
        ),
      )
      expect(answer.openBefore).toBe(3)
      expect(tagOf(answer.second)).toBe('AUTH_CHALLENGE_INVALID')
      expect(tagOf(answer.third)).toBe('AUTH_CHALLENGE_INVALID')
    } finally {
      await db.dispose()
    }
  })
})

describe.runIf(postgresAvailable)('asking for a reset where a challenge can be asked for', () => {
  // a stand-in provider whose proof is the binding it was issued for
  const fake: CaptchaProvider = {
    code: 'fake',
    issue: (context) => Effect.succeed({ binding: context.bindingHash }),
    verify: (context, response) =>
      Effect.succeed(response === `solved:${context.bindingHash}` ? 'verified' : 'rejected'),
  }
  /** from one address, as the request pipeline would have read it */
  const fromAddress =
    (clientIp: string) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.provideService(RequestContext, {
          requestId: 'test',
          clientIp,
          userAgent: undefined,
          traceId: undefined,
          sessionId: undefined,
          bindSession: () => Effect.void,
          publicHost: undefined,
          endpoint: undefined,
          bindEndpoint: () => Effect.void,
        }),
      )

  it('asks from the second request on, takes a proof, and mails an address three times an hour', async () => {
    const db = await createTestContext('email-reset-captcha')
    const mail = memoryMailBackend()
    try {
      await seed(db.url)
      /** one address's run of requests, from its own network address */
      const run = (email: string, clientIp: string) =>
        fromAddress(clientIp)(
          Effect.gen(function* () {
            const flows = yield* EmailFlows
            const ask = (captcha?: { provider: string; response: string }) =>
              Effect.result(
                flows.requestReset({
                  email,
                  locale: 'en',
                  ...(captcha === undefined ? {} : { captcha }),
                }),
              )
            const outcome = (result: { _tag: string; failure?: unknown }) => tagOf(result) ?? 'ok'
            const proofFor = (result: { _tag: string; failure?: unknown }) => ({
              provider: 'fake',
              response: `solved:${(result as { failure?: { challenge?: { binding?: string } } }).failure?.challenge?.binding ?? ''}`,
            })
            const outcomes: string[] = []
            // the first in the hour goes unchallenged
            outcomes.push(outcome(yield* ask()))
            // the second is asked for a challenge
            const challenged = yield* ask()
            outcomes.push(outcome(challenged))
            // a wrong proof is asked again, afresh
            outcomes.push(outcome(yield* ask({ provider: 'fake', response: 'solved:nothing' })))
            // the right proof is taken: the second mail
            outcomes.push(outcome(yield* ask(proofFor(challenged))))
            // challenged and met again: the third mail
            outcomes.push(outcome(yield* ask(proofFor(yield* ask()))))
            // and once more - past the challenge, the fourth is refused
            outcomes.push(outcome(yield* ask(proofFor(yield* ask()))))
            return outcomes
          }),
        )
      const answer = ok(
        await Effect.runPromiseExit(
          Effect.all({
            ada: run('ada@school.edu', '203.0.113.8'),
            nobody: run('nobody@school.edu', '203.0.113.9'),
          }).pipe(Effect.provide(stack(db.url, mail.backend, captchaLayerWith(fake)))),
        ),
      )
      // somebody and nobody meet the same answers, in the same order
      expect(answer.ada).toEqual(answer.nobody)
      expect(answer.ada).toEqual([
        'ok',
        'CAPTCHA_REQUIRED',
        'CAPTCHA_REQUIRED',
        'ok',
        'ok',
        'TOO_MANY_ATTEMPTS',
      ])
      await vi.waitFor(() => {
        expect(mail.outbox.filter((message) => message.to === 'ada@school.edu')).toHaveLength(3)
      })
      expect(mail.outbox.filter((message) => message.to === 'nobody@school.edu')).toHaveLength(0)
    } finally {
      await db.dispose()
    }
  })
})

describe.runIf(postgresAvailable)('an email address', () => {
  it('is proven by a link to it, and only while it is still the address on file', async () => {
    const db = await createTestContext('email-verify')
    const mail = memoryMailBackend()
    try {
      const f = await seed(db.url)
      const answer = ok(
        await Effect.runPromiseExit(
          Effect.gen(function* () {
            const flows = yield* EmailFlows
            const lin = f.as(f.lin, f.linHere)
            const first = yield* flows.requestVerification(lin, 'zh-CN')
            const link = yield* Effect.promise(() => tokenFrom(mail, 'lin@school.edu'))
            yield* flows.redeemVerification(link.token)
            const verified = yield* runSql<{ verified: boolean }>(
              sql`select email_verified_at is not null as verified from users where id = ${f.lin}`,
            )
            const again = yield* flows.requestVerification(lin, 'zh-CN')

            // a link to an address that has since been replaced proves nothing
            yield* runSql(sql`update users set email_verified_at = null where id = ${f.lin}`)
            yield* flows.requestVerification(lin, 'en')
            const stale = yield* Effect.promise(() => tokenFrom(mail, 'lin@school.edu'))
            yield* runSql(sql`update users set email = 'lin.moved@school.edu' where id = ${f.lin}`)
            const refused = yield* Effect.result(flows.redeemVerification(stale.token))
            return {
              first,
              link,
              verified: verified.rows[0]!.verified,
              again,
              refused,
            }
          }).pipe(Effect.provide(stack(db.url, mail.backend))),
        ),
      )
      expect(answer.first).toEqual({ sent: true })
      expect(answer.link.subject).toBe('验证您的邮箱')
      expect(answer.link.url.pathname).toBe('/confirm-email')
      expect(new URLSearchParams(answer.link.url.hash.slice(1)).get('purpose')).toBe('verify')
      expect(answer.verified).toBe(true)
      expect(answer.again).toEqual({ sent: false })
      expect(tagOf(answer.refused)).toBe('AUTH_CHALLENGE_INVALID')
    } finally {
      await db.dispose()
    }
  })

  it('changes only once the new one is proven, and never to an address somebody has', async () => {
    const db = await createTestContext('email-change')
    const mail = memoryMailBackend()
    try {
      const f = await seed(db.url)
      const answer = ok(
        await Effect.runPromiseExit(
          Effect.gen(function* () {
            const flows = yield* EmailFlows
            const ada = f.as(f.ada, f.adaHere)
            const taken = yield* Effect.result(
              flows.requestChange(ada, { newEmail: 'LIN@school.edu', locale: 'en' }),
            )
            const system = yield* Effect.result(
              flows.requestChange(f.as(f.admin, f.adminHere), {
                newEmail: 'root2@school.edu',
                locale: 'en',
              }),
            )
            // two reset links out to the old address, which is about to stop being hers
            yield* flows.requestReset({ email: 'ada@school.edu', locale: 'en' })
            yield* flows.requestReset({ email: 'ada@school.edu', locale: 'en' })
            yield* flows.requestChange(ada, { newEmail: 'Ada.New@school.edu', locale: 'en' })
            const link = yield* Effect.promise(() => tokenFrom(mail, 'ada.new@school.edu'))
            const before = yield* runSql<{ email: string }>(
              sql`select email from users where id = ${f.ada}`,
            )
            yield* flows.redeemChange(link.token)
            const resetsOpen = yield* runSql<{ count: number }>(
              sql`select count(*)::int as count from user_email_challenges
                   where user_id = ${f.ada} and purpose = 'reset' and consumed_at is null`,
            )
            const after = yield* runSql<{ email: string; verified: boolean }>(
              sql`select email, email_verified_at is not null as verified from users where id = ${f.ada}`,
            )
            const audited = yield* runSql<{ action_code: string; actor_user_id: string }>(
              sql`select action_code, actor_user_id from audit_events where target_id = ${f.ada}`,
            )
            return {
              taken,
              system,
              before: before.rows[0]!.email,
              after: after.rows[0]!,
              audited: audited.rows,
              resetsOpen: resetsOpen.rows[0]!.count,
            }
          }).pipe(Effect.provide(stack(db.url, mail.backend))),
        ),
      )
      expect(tagOf(answer.taken)).toBe('USER_EMAIL_CONFLICT')
      expect(tagOf(answer.system)).toBe('SYSTEM_ACCOUNT_PROTECTED')
      // the old address stood until the link was followed
      expect(answer.before).toBe('ada@school.edu')
      expect(answer.after).toEqual({ email: 'ada.new@school.edu', verified: true })
      // links to the old address are links to somebody else's inbox now
      expect(answer.resetsOpen).toBe(0)
      expect(answer.audited).toEqual([{ action_code: 'auth.user.update', actor_user_id: f.ada }])
    } finally {
      await db.dispose()
    }
  })

  it('does not change once the account has been taken back, however that was done', async () => {
    const db = await createTestContext('email-change-taken-back')
    const mail = memoryMailBackend()
    try {
      const f = await seed(db.url)
      const answer = ok(
        await Effect.runPromiseExit(
          Effect.gen(function* () {
            const flows = yield* EmailFlows
            const iam = yield* Iam
            // an administrator who may do what taking an account back takes
            const role = one<{ id: string }>(
              yield* runSql(sql`
                insert into roles (tenant_id, code, name, kind, status, permission_mode, system_key)
                values (${f.tenant}, 'admin', 'Admin', 'tenant', 'active', 'all-active', 'tenant-admin')
                returning id`),
            ).id
            yield* runSql(sql`
              insert into role_grants (tenant_id, user_id, role_id)
              values (${f.tenant}, ${f.admin}, ${role})`)
            const admin = f.as(f.admin, f.adminHere)
            // whoever holds one of Ada's sessions asks to move her address
            // somewhere of theirs, and then Ada or an administrator acts
            const stolen = f.as(f.ada, f.adaElsewhere)
            const version = () =>
              Effect.map(
                runSql<{ version: number }>(sql`select version from users where id = ${f.ada}`),
                (result) => result.rows[0]!.version,
              )
            const afterwards = Effect.fn('afterwards')(function* (
              takeBack: Effect.Effect<unknown, unknown, EmailFlows | Iam | Orm>,
            ) {
              yield* flows.requestChange(stolen, {
                newEmail: 'thief@elsewhere.example',
                locale: 'en',
              })
              const link = yield* Effect.promise(() => tokenFrom(mail, 'thief@elsewhere.example'))
              mail.outbox.length = 0
              yield* takeBack
              return tagOf(yield* Effect.result(flows.redeemChange(link.token)))
            })
            const ownPassword = yield* afterwards(
              flows.setPassword(f.as(f.ada, f.adaHere), {
                currentPassword: 'ada-password',
                newPassword: 'fresh password',
              }),
            )
            const replaced = yield* afterwards(
              iam.users.putBinding(f.tenant, f.ada, f.local, { secret: 'another password' }, admin),
            )
            const revoked = yield* afterwards(
              iam.users.revokeBinding(f.tenant, f.ada, f.local, admin),
            )
            const disabled = yield* afterwards(
              Effect.gen(function* () {
                yield* iam.users.setStatus(
                  f.tenant,
                  f.ada,
                  { status: 'disabled', expectedVersion: yield* version() },
                  admin,
                )
                yield* iam.users.setStatus(
                  f.tenant,
                  f.ada,
                  { status: 'active', expectedVersion: yield* version() },
                  admin,
                )
              }),
            )
            const email = yield* runSql<{ email: string }>(
              sql`select email from users where id = ${f.ada}`,
            )
            return { ownPassword, replaced, revoked, disabled, email: email.rows[0]!.email }
          }).pipe(Effect.provide(stack(db.url, mail.backend))),
        ),
      )
      expect(answer).toEqual({
        ownPassword: 'AUTH_CHALLENGE_INVALID',
        replaced: 'AUTH_CHALLENGE_INVALID',
        revoked: 'AUTH_CHALLENGE_INVALID',
        disabled: 'AUTH_CHALLENGE_INVALID',
        email: 'ada@school.edu',
      })
    } finally {
      await db.dispose()
    }
  })

  it('spends a link that could not be mailed, and says so', async () => {
    const db = await createTestContext('email-not-sent')
    const mail = memoryMailBackend()
    try {
      const f = await seed(db.url)
      mail.failWith('unavailable')
      const answer = ok(
        await Effect.runPromiseExit(
          Effect.gen(function* () {
            const flows = yield* EmailFlows
            const refused = yield* Effect.result(
              flows.requestVerification(f.as(f.lin, f.linHere), 'en'),
            )
            const open = yield* runSql<{ count: number }>(
              sql`select count(*)::int as count from user_email_challenges where consumed_at is null`,
            )
            return { refused, open: open.rows[0]!.count }
          }).pipe(Effect.provide(stack(db.url, mail.backend))),
        ),
      )
      expect(tagOf(answer.refused)).toBe('AUTH_MAIL_NOT_SENT')
      expect(answer.open).toBe(0)
    } finally {
      await db.dispose()
    }
  })
})

describe.runIf(postgresAvailable)('one’s own password', () => {
  it('is changed with the current one, and ends every other session', async () => {
    const db = await createTestContext('email-self-password')
    const mail = memoryMailBackend()
    try {
      const f = await seed(db.url)
      const answer = ok(
        await Effect.runPromiseExit(
          Effect.gen(function* () {
            const flows = yield* EmailFlows
            const ada = f.as(f.ada, f.adaHere)
            yield* runSql(sql`update tenants set name = 'Lighthouse'`)
            const judged = yield* flows.assessPassword(ada, { password: 'lighthouse keeper' })
            const wrong = yield* Effect.result(
              flows.setPassword(ada, { currentPassword: 'not it', newPassword: 'fresh password' }),
            )
            const none = yield* Effect.result(
              flows.setPassword(ada, { newPassword: 'fresh password' }),
            )
            yield* flows.setPassword(ada, {
              currentPassword: 'ada-password',
              newPassword: 'fresh password',
            })
            const sessions = yield* runSql<{ id: string }>(
              sql`select id from sessions where user_id = ${f.ada}`,
            )
            // Lin has no password, and an address nobody proved
            const lin = f.as(f.lin, f.linHere)
            const unproven = yield* Effect.result(
              flows.setPassword(lin, { newPassword: 'lin password' }),
            )
            yield* runSql(sql`update users set email_verified_at = now() where id = ${f.lin}`)
            yield* flows.setPassword(lin, { newPassword: 'lin password' })
            const credential = yield* runSql<{ user_id: string; credential_hash: string }>(
              sql`select user_id, credential_hash from user_auth_bindings where revoked_at is null order by user_id`,
            )
            return {
              judged,
              wrong,
              none,
              sessions: sessions.rows.map((row) => row.id),
              unproven,
              credential: credential.rows,
            }
          }).pipe(Effect.provide(stack(db.url, mail.backend))),
        ),
      )
      // judged against the reader's own workspace, while it is typed
      expect(answer.judged).toEqual({ length: true, impersonal: false, unguessable: true })
      expect(tagOf(answer.wrong)).toBe('AUTH_PASSWORD_INCORRECT')
      expect(tagOf(answer.none)).toBe('AUTH_PASSWORD_INCORRECT')
      expect(answer.sessions).toEqual([f.adaHere])
      expect(tagOf(answer.unproven)).toBe('AUTH_EMAIL_UNVERIFIED')
      expect(answer.credential).toEqual(
        expect.arrayContaining([
          { user_id: f.ada, credential_hash: 'digest:fresh password' },
          { user_id: f.lin, credential_hash: 'digest:lin password' },
        ]),
      )
    } finally {
      await db.dispose()
    }
  })
})

const MAILPIT = process.env['QUALY_TEST_MAILPIT_URL'] ?? 'http://127.0.0.1:8025'
const mailpitAvailable = await fetch(`${MAILPIT}/api/v1/info`, {
  signal: AbortSignal.timeout(5_000),
})
  .then((response) => response.ok)
  .catch(() => false)
if (!mailpitAvailable && process.env['QUALY_REQUIRE_MAILPIT_TESTS'] === '1') {
  throw new Error(`the reset-by-mail suite is required but Mailpit is unreachable at ${MAILPIT}`)
}

describe.runIf(postgresAvailable && mailpitAvailable)(
  'a forgotten password, through a real relay',
  () => {
    it('arrives at the address, and its link sets the password', async () => {
      const db = await createTestContext('email-reset-smtp')
      const relay = smtpBackend({
        host: '127.0.0.1',
        port: Number(process.env['QUALY_TEST_MAILPIT_SMTP_PORT'] ?? '1025'),
        tls: 'none',
        auth: undefined,
      })
      try {
        const f = await seed(db.url)
        // an address of this run's own, so the inbox holds nothing else for it
        const address = `ada-${Date.now().toString(36)}@school.edu`
        await Effect.runPromise(
          runSql(sql`update users set email = ${address} where id = ${f.ada}`).pipe(
            Effect.provide(databaseFor(db.url, { migrations: 'off', entities: authClosure })),
          ),
        )
        const answer = ok(
          await Effect.runPromiseExit(
            Effect.gen(function* () {
              const flows = yield* EmailFlows
              yield* flows.requestReset({ email: address, locale: 'zh-CN' })
              const message = yield* Effect.promise(() =>
                vi.waitFor(
                  async () => {
                    const search = (await (
                      await fetch(
                        `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`,
                      )
                    ).json()) as { messages: { ID: string }[] }
                    const first = search.messages[0]
                    if (first === undefined) throw new Error('nothing arrived yet')
                    return (await (
                      await fetch(`${MAILPIT}/api/v1/message/${first.ID}`)
                    ).json()) as {
                      Subject: string
                      Text: string
                    }
                  },
                  { timeout: 5_000, interval: 100 },
                ),
              )
              const link = new URL(/https:\/\/\S+/.exec(message.Text)![0])
              yield* flows.redeemReset({
                token: new URLSearchParams(link.hash.slice(1)).get('token')!,
                password: 'set through the relay',
              })
              const credential = yield* runSql<{ credential_hash: string }>(
                sql`select credential_hash from user_auth_bindings where user_id = ${f.ada} and revoked_at is null`,
              )
              return { subject: message.Subject, credential: credential.rows[0]!.credential_hash }
            }).pipe(Effect.provide(stack(db.url, relay.backend))),
          ),
        )
        expect(answer.subject).toBe('重置您的密码')
        expect(answer.credential).toBe('digest:set through the relay')
      } finally {
        relay.close()
        await db.dispose()
      }
    })
  },
)

describe.runIf(postgresAvailable)('a shared demo account', () => {
  it('keeps its password and address whoever asks, and is never sent a reset', async () => {
    const db = await createTestContext('email-demo-account')
    const mail = memoryMailBackend()
    try {
      const f = await seed(db.url)
      const demo = [{ email: 'ada@school.edu', password: 'ada-password', label: '学生' }]
      const answer = ok(
        await Effect.runPromiseExit(
          Effect.gen(function* () {
            const flows = yield* EmailFlows
            const ada = f.as(f.ada, f.adaHere)
            const password = yield* Effect.result(
              flows.setPassword(ada, {
                currentPassword: 'ada-password',
                newPassword: 'taken over',
              }),
            )
            const address = yield* Effect.result(
              flows.requestChange(ada, { newEmail: 'someone.else@school.edu', locale: 'en' }),
            )
            // answered like any other address, and nothing goes out
            yield* flows.requestReset({ email: 'ada@school.edu', locale: 'en' })
            const challenges = yield* runSql<{ count: number }>(
              sql`select count(*)::int as count from user_email_challenges`,
            )
            return { password, address, challenges: challenges.rows[0]!.count }
          }).pipe(Effect.provide(stack(db.url, mail.backend, captchaLayer, demo))),
        ),
      )
      expect(tagOf(answer.password)).toBe('AUTH_DEMO_ACCOUNT_LOCKED')
      expect(tagOf(answer.address)).toBe('AUTH_DEMO_ACCOUNT_LOCKED')
      expect(answer.challenges).toBe(0)
      expect(mail.outbox).toHaveLength(0)
    } finally {
      await db.dispose()
    }
  })
})
