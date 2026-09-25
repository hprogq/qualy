import { booted } from '@qualy/rbac-contract/testkit'
import { compileCatalog } from '@qualy/rbac-contract/plugin'
import { permissions as authPermissions } from '@qualy/plugin-auth/permissions'
import { uiLayer } from '@qualy/plugin-ui-registry/server/registry'
import { sql } from 'kysely'
import { Cause, Effect, Exit, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  createTestContext,
  databaseFor,
  postgresAvailable,
  runSql,
} from '@qualy/plugin-database/testkit'
import { secretsLayer } from '@qualy/plugin-secrets/testkit'
import { captchaLayer } from '@qualy/plugin-captcha/testkit'
import { type Orm } from '@qualy/plugin-database/server'
import type { Principal } from '@qualy/rbac-contract'
import { serviceLayer as rbacLayer } from '@qualy/plugin-rbac/server'
import { serviceLayer as auditLayer } from '@qualy/plugin-audit/server'
import { AuditActionCatalog } from '@qualy/audit-contract/effect'
import { compileActionCatalog } from '@qualy/audit-contract/plugin'
import {
  loginDriversLayer,
  registerLoginDriver,
  type LoginDriver,
} from '@qualy/auth-contract/login'
import { driver as localDriver } from '@qualy/plugin-auth-local'
import { driver as casDriver } from '@qualy/plugin-auth-cas'
import { userActions } from '../src/actions.ts'
import { AuthConfig } from '../src/server/auth-config.ts'
import { Iam, serviceLayer as authLayer } from '../src/server/index.ts'
import { SignIn } from '../src/server/sign-in.ts'
import { SYSTEM_ACCOUNT_USER_TYPE } from '../src/constants.ts'
import { authClosure } from './support/closure.ts'

// An entrance a tenant adds for itself, from empty shell to gone.
//
// Three rules carry the whole of it: a shell is saved in pieces and stays out
// of service until it has everything its kind needs; an entrance in service
// keeps what it needs, so nothing here may take it away; and what says whose
// accounts it speaks for is fixed the moment somebody's account is bound
// through it.

const literal = (value: string) => ({ kind: 'literal' as const, value })

const campus: LoginDriver = {
  type: 'campus',
  presentation: { mode: 'redirect', href: ({ code }) => `/auth/campus/${code}/start` },
  provisioning: {
    mode: 'tenant-managed',
    entrance: {
      label: literal('Campus'),
      fields: [
        { key: 'server', label: literal('Server'), kind: 'url', required: true },
        { key: 'realm', label: literal('Realm'), kind: 'text', required: false },
        { key: 'clientSecret', label: literal('Secret'), kind: 'secret', required: true },
      ],
      identityNamespaceKeys: ['server'],
    },
  },
  resolution: { mode: 'binding-subject' },
  binding: { mode: 'self' },
}

// a door that binds nothing: it takes the number another server names as
// the whole proof, which is what makes that server's address matter
const badge: LoginDriver = {
  type: 'badge',
  presentation: { mode: 'redirect', href: ({ code }) => `/auth/badge/${code}/start` },
  provisioning: {
    mode: 'tenant-managed',
    entrance: {
      label: literal('Badge'),
      fields: [
        { key: 'server', label: literal('Server'), kind: 'url', required: true },
        { key: 'label', label: literal('Label'), kind: 'text', required: false },
      ],
      identityNamespaceKeys: ['server'],
    },
  },
  resolution: { mode: 'user-field', field: 'businessNo' },
}

// a kind whose boxes depend on each other: a choice that reveals a required
// box, a number and a toggle folded under advanced, and settings the driver
// works out from what was typed
const shaped: LoginDriver = {
  type: 'shaped',
  presentation: { mode: 'redirect', href: ({ code }) => `/auth/shaped/${code}/start` },
  provisioning: {
    mode: 'tenant-managed',
    entrance: {
      label: literal('Shaped'),
      fields: [
        {
          key: 'mode',
          label: literal('Mode'),
          kind: 'choice',
          required: true,
          options: [
            { value: 'standard', label: literal('Standard') },
            { value: 'custom', label: literal('Custom') },
          ],
          defaultValue: 'standard',
        },
        {
          key: 'target',
          label: literal('Target'),
          kind: 'url',
          required: true,
          visibleWhen: { field: 'mode', equals: 'custom' },
        },
        {
          key: 'retries',
          label: literal('Retries'),
          kind: 'number',
          required: false,
          section: 'advanced',
          min: 0,
          max: 5,
          step: 1,
          defaultValue: 2,
        },
        {
          key: 'strict',
          label: literal('Strict'),
          kind: 'toggle',
          required: false,
          section: 'advanced',
          defaultValue: false,
        },
      ],
      prepareConfig: ({ values }) =>
        Effect.succeed(
          values['retries'] === 4
            ? { ok: false as const, invalid: 'retries' }
            : {
                ok: true as const,
                derived: {
                  endpoint:
                    values['mode'] === 'custom' ? values['target'] : 'https://fixed.example',
                  strict: values['strict'],
                },
              },
        ),
    },
  },
  resolution: { mode: 'binding-subject' },
  binding: { mode: 'self' },
}

const stack = (url: string) =>
  booted(
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
      Layer.provideMerge(captchaLayer),
      Layer.provideMerge(secretsLayer),
      Layer.provideMerge(
        Layer.mergeAll(
          databaseFor(url, { entities: authClosure }),
          Layer.mergeAll(
            registerLoginDriver(localDriver),
            registerLoginDriver(campus),
            registerLoginDriver(badge),
            registerLoginDriver(casDriver),
            registerLoginDriver(shaped),
          ).pipe(Layer.provideMerge(loginDriversLayer)),
          uiLayer,
          Layer.succeed(
            AuthConfig,
            AuthConfig.of({
              defaultTenantSlug: 'default',
              sessionTtlSeconds: 3600,
              secureCookies: false,
              sessionCookieName: 'qualy_session',
            }),
          ),
        ),
      ),
    ),
    { catalog: compileCatalog([{ owner: 'auth', permissions: authPermissions }]) },
  )

const run = <A, E>(url: string, effect: Effect.Effect<A, E, Iam | SignIn | Orm>) =>
  Effect.runPromiseExit(Effect.provide(effect, stack(url)))

const ok = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isSuccess(exit)) return exit.value
  throw new Error(`expected success, got ${Cause.pretty(exit.cause)}`)
}

const tagOf = (result: { _tag: string; failure?: unknown }) =>
  result._tag === 'Failure' ? (result.failure as { _tag?: string })._tag : undefined

const failureOf = (result: { _tag: string; failure?: unknown }) =>
  result._tag === 'Failure' ? (result.failure as Record<string, unknown>) : undefined

const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!

/** a tenant that can recover itself, so provider writes are not refused for that */
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
      const admin = one<{ id: string }>(
        yield* runSql(sql`
          insert into users (tenant_id, display_name, user_type_id, primary_org_node_id, email)
          values (${tenant}, 'Admin', ${system}, ${root}, 'root@school.edu') returning id`),
      ).id
      const person = one<{ id: string }>(
        yield* runSql(sql`
          insert into users (tenant_id, display_name, user_type_id, primary_org_node_id, email)
          values (${tenant}, 'Ada', ${staff}, ${root}, 'ada@school.edu') returning id`),
      ).id
      const role = one<{ id: string }>(
        yield* runSql(sql`
          insert into roles (tenant_id, code, name, kind, status, permission_mode, system_key)
          values (${tenant}, 'admin', 'Admin', 'tenant', 'active', 'all-active', 'tenant-admin')
          returning id`),
      ).id
      yield* runSql(sql`
        insert into role_grants (tenant_id, user_id, role_id) values (${tenant}, ${admin}, ${role})`)
      const local = one<{ id: string; version: number }>(
        yield* runSql(sql`
          insert into auth_providers (tenant_id, code, type, name, is_system, sort_order)
          values (${tenant}, 'local', 'local', 'Local', true, 0) returning id, version`),
      )
      yield* runSql(sql`
        insert into user_auth_bindings (tenant_id, user_id, auth_provider_id, subject, credential_hash)
        values (${tenant}, ${admin}, ${local.id}, null, 'digest')`)
      const as: Principal = { tenantId: tenant, userId: admin, sessionId: 's' }
      return { tenant, admin, person, local, as }
    }).pipe(Effect.provide(databaseFor(url, { migrations: 'off', entities: authClosure }))),
  )

describe.runIf(postgresAvailable)('an entrance a tenant adds', () => {
  it('is set up in pieces, in service only once it has everything, and then keeps it', async () => {
    const db = await createTestContext('providers-setup')
    try {
      const f = await seed(db.url)
      const answer = ok(
        await run(
          db.url,
          Effect.gen(function* () {
            const iam = yield* Iam
            const signIn = yield* SignIn
            const id = yield* iam.providers.create(
              f.tenant,
              { type: 'campus', code: 'campus', name: 'Campus' },
              f.as,
            )
            const shell = yield* iam.providers.detail(f.tenant, id)
            const tooEarly = yield* Effect.result(
              iam.providers.setStatus(f.tenant, id, 'active', 1, f.as),
            )
            // one box at a time, and one that is not a web address at all
            const partial = yield* iam.providers.update(
              f.tenant,
              id,
              { expectedVersion: 1, values: { server: 'https://cas.example.edu/' } },
              f.as,
            )
            const half = yield* iam.providers.detail(f.tenant, id)
            const unchanged = yield* iam.providers.update(
              f.tenant,
              id,
              { expectedVersion: partial, values: { realm: '' } },
              f.as,
            )
            const nonsense = yield* Effect.result(
              iam.providers.update(
                f.tenant,
                id,
                { expectedVersion: partial, values: { server: 'not an address' } },
                f.as,
              ),
            )
            const stranger = yield* Effect.result(
              iam.providers.update(
                f.tenant,
                id,
                { expectedVersion: partial, values: { bogus: 'x' } },
                f.as,
              ),
            )
            const secreted = yield* iam.providers.update(
              f.tenant,
              id,
              { expectedVersion: partial, values: { clientSecret: 's3cret-value' } },
              f.as,
            )
            const kept = yield* iam.providers.update(
              f.tenant,
              id,
              { expectedVersion: secreted, values: { clientSecret: '' } },
              f.as,
            )
            const ready = yield* iam.providers.detail(f.tenant, id)
            const stored = yield* runSql<{ config: unknown; ciphertext: Buffer }>(sql`
              select p.config::text as config, s.ciphertext
                from auth_providers p
                join secrets s on s.owner_id = p.id and s.key = 'clientSecret'
               where p.id = ${id}`)
            const served = yield* iam.providers.setStatus(f.tenant, id, 'active', kept, f.as)
            const offered = yield* signIn.loginMethods()
            // in service, what it needs cannot be taken away
            const emptied = yield* Effect.result(
              iam.providers.update(
                f.tenant,
                id,
                { expectedVersion: served, values: { server: '' } },
                f.as,
              ),
            )
            const cleared = yield* Effect.result(
              iam.providers.clearSecret(f.tenant, id, 'clientSecret', served, f.as),
            )
            const intact = yield* iam.providers.detail(f.tenant, id)
            const rested = yield* iam.providers.setStatus(f.tenant, id, 'disabled', served, f.as)
            const gone = yield* iam.providers.clearSecret(
              f.tenant,
              id,
              'clientSecret',
              rested,
              f.as,
            )
            const after = yield* iam.providers.detail(f.tenant, id)
            return {
              shell,
              tooEarly,
              partial,
              half,
              unchanged,
              nonsense,
              stranger,
              secreted,
              kept,
              ready,
              stored,
              served,
              offered,
              emptied,
              cleared,
              intact,
              gone,
              after,
            }
          }),
        ),
      )
      // an empty shell, out of service, saying what it still needs
      expect(answer.shell.provider.status).toBe('disabled')
      expect(answer.shell.provider.setup).toBe('incomplete')
      expect(answer.shell.missing).toEqual([
        { kind: 'field', key: 'server' },
        { kind: 'field', key: 'clientSecret' },
      ])
      expect(answer.shell.config).toEqual({})
      expect(answer.shell.secrets).toEqual([{ key: 'clientSecret', stored: false }])
      expect(answer.shell.usage).toEqual({ bindings: 0, sessions: 0, sessionsByUserType: [] })
      expect(tagOf(answer.tooEarly)).toBe('AUTH_PROVIDER_CONFIG_INCOMPLETE')
      expect(failureOf(answer.tooEarly)?.['missing']).toEqual([
        { kind: 'field', key: 'server' },
        { kind: 'field', key: 'clientSecret' },
      ])

      // saved in pieces: what is there is kept, what is missing is named
      expect(answer.partial).toBe(2)
      expect(answer.half.config).toEqual({ server: 'https://cas.example.edu/' })
      expect(answer.half.missing).toEqual([{ kind: 'field', key: 'clientSecret' }])
      // an optional box that was empty and stays empty is not a change
      expect(answer.unchanged).toBe(2)
      expect(tagOf(answer.nonsense)).toBe('AUTH_PROVIDER_CONFIG_INVALID')
      expect(failureOf(answer.nonsense)?.['field']).toBe('server')
      expect(tagOf(answer.stranger)).toBe('AUTH_PROVIDER_CONFIG_INVALID')

      // a secret goes to the secrets capability, never into the config
      expect(answer.secreted).toBe(3)
      expect(answer.kept).toBe(3)
      expect(answer.ready.provider.setup).toBe('complete')
      expect(answer.ready.secrets).toEqual([{ key: 'clientSecret', stored: true }])
      expect(answer.ready.config).toEqual({ server: 'https://cas.example.edu/' })
      const row = answer.stored.rows[0]!
      expect(String(row.config)).not.toContain('s3cret-value')
      expect(Buffer.from(row.ciphertext).toString('utf8')).not.toContain('s3cret-value')

      // in service, and offered on the sign-in page
      expect(answer.served).toBe(4)
      expect(answer.offered.map((method) => method.code)).toContain('campus')
      expect(tagOf(answer.emptied)).toBe('AUTH_PROVIDER_CONFIG_INCOMPLETE')
      expect(tagOf(answer.cleared)).toBe('AUTH_PROVIDER_CONFIG_INCOMPLETE')
      expect(answer.intact.config).toEqual({ server: 'https://cas.example.edu/' })
      expect(answer.intact.secrets).toEqual([{ key: 'clientSecret', stored: true }])

      // out of service, the same secret may go
      expect(answer.gone).toBe(6)
      expect(answer.after.provider.setup).toBe('incomplete')
      expect(answer.after.secrets).toEqual([{ key: 'clientSecret', stored: false }])
    } finally {
      await db.dispose()
    }
  })

  it('stops saying whose accounts it speaks for once one has been bound through it', async () => {
    const db = await createTestContext('providers-namespace')
    try {
      const f = await seed(db.url)
      const answer = ok(
        await run(
          db.url,
          Effect.gen(function* () {
            const iam = yield* Iam
            const id = yield* iam.providers.create(
              f.tenant,
              { type: 'campus', code: 'campus', name: 'Campus' },
              f.as,
            )
            const set = yield* iam.providers.update(
              f.tenant,
              id,
              {
                expectedVersion: 1,
                values: { server: 'https://cas.example.edu/', clientSecret: 's3cret' },
              },
              f.as,
            )
            // nobody has bound an account yet, so where it points may change
            const moved = yield* iam.providers.update(
              f.tenant,
              id,
              { expectedVersion: set, values: { server: 'https://other.example.edu/' } },
              f.as,
            )
            // an account bound and then withdrawn is still an account it named
            yield* runSql(sql`
              insert into user_auth_bindings
                (tenant_id, user_id, auth_provider_id, subject, revoked_at)
              values (${f.tenant}, ${f.person}, ${id}, 'ada@campus', now())`)
            const pinned = yield* Effect.result(
              iam.providers.update(
                f.tenant,
                id,
                { expectedVersion: moved, values: { server: 'https://third.example.edu/' } },
                f.as,
              ),
            )
            // what does not say whose accounts they are is still editable
            const renamed = yield* iam.providers.update(
              f.tenant,
              id,
              { expectedVersion: moved, values: { realm: 'staff' } },
              f.as,
            )
            const now = yield* iam.providers.detail(f.tenant, id)
            return { moved, pinned, renamed, now }
          }),
        ),
      )
      expect(answer.moved).toBe(3)
      expect(tagOf(answer.pinned)).toBe('AUTH_PROVIDER_IDENTITY_NAMESPACE_IN_USE')
      expect(failureOf(answer.pinned)?.['field']).toBe('server')
      expect(answer.renamed).toBe(4)
      expect(answer.now.config).toEqual({ server: 'https://other.example.edu/', realm: 'staff' })
    } finally {
      await db.dispose()
    }
  })

  // A door that finds people by their own number binds nothing, so waiting
  // for a binding left its server movable forever: whoever ran the new one
  // could answer with any number the directory holds.
  it('stops saying whose number it trusts once anybody has come in through it', async () => {
    const db = await createTestContext('providers-namespace-signed-in')
    try {
      const f = await seed(db.url)
      const answer = ok(
        await run(
          db.url,
          Effect.gen(function* () {
            const iam = yield* Iam
            const id = yield* iam.providers.create(
              f.tenant,
              { type: 'badge', code: 'badge', name: 'Badge' },
              f.as,
            )
            const set = yield* iam.providers.update(
              f.tenant,
              id,
              { expectedVersion: 1, values: { server: 'https://cas.example.edu/' } },
              f.as,
            )
            const signIn = (outcome: 'success' | 'failure') =>
              runSql(sql`
                insert into sign_in_events
                  (tenant_id, provider_id, provider_type, provider_code, user_id, outcome)
                values (${f.tenant}, ${id}, 'badge', 'badge',
                  ${outcome === 'success' ? f.person : null}, ${outcome})`)
            // somebody tried and was refused: the door let nobody in yet
            yield* signIn('failure')
            const moved = yield* iam.providers.update(
              f.tenant,
              id,
              { expectedVersion: set, values: { server: 'https://other.example.edu/' } },
              f.as,
            )
            yield* signIn('success')
            const pinned = yield* Effect.result(
              iam.providers.update(
                f.tenant,
                id,
                { expectedVersion: moved, values: { server: 'https://third.example.edu/' } },
                f.as,
              ),
            )
            const relabelled = yield* iam.providers.update(
              f.tenant,
              id,
              { expectedVersion: moved, values: { label: 'Staff card' } },
              f.as,
            )
            return { moved, pinned, relabelled }
          }),
        ),
      )
      expect(answer.moved).toBe(3)
      expect(tagOf(answer.pinned)).toBe('AUTH_PROVIDER_IDENTITY_NAMESPACE_IN_USE')
      expect(failureOf(answer.pinned)?.['field']).toBe('server')
      expect(answer.relabelled).toBe(4)
    } finally {
      await db.dispose()
    }
  })

  it('keeps a CAS entrance’s server and the way it reads a person once anybody came in', async () => {
    const db = await createTestContext('providers-namespace-cas')
    try {
      const f = await seed(db.url)
      const answer = ok(
        await run(
          db.url,
          Effect.gen(function* () {
            const iam = yield* Iam
            const id = yield* iam.providers.create(
              f.tenant,
              { type: 'cas', code: 'school', name: 'School CAS' },
              f.as,
            )
            const set = yield* iam.providers.update(
              f.tenant,
              id,
              {
                expectedVersion: 1,
                values: {
                  serverUrl: 'https://cas.school.edu/cas',
                  identitySource: 'attribute',
                  identityAttribute: 'id_number',
                },
              },
              f.as,
            )
            yield* runSql(sql`
              insert into sign_in_events
                (tenant_id, provider_id, provider_type, provider_code, user_id, outcome)
              values (${f.tenant}, ${id}, 'cas', 'school', ${f.person}, 'success')`)
            const change = (values: Record<string, string>) =>
              Effect.map(
                Effect.result(
                  iam.providers.update(f.tenant, id, { expectedVersion: set, values }, f.as),
                ),
                (result) =>
                  result._tag === 'Success' ? 'Success' : String(failureOf(result)?.['field']),
              )
            return {
              server: yield* change({ serverUrl: 'https://evil.example/cas' }),
              protocol: yield* change({ protocol: 'cas2' }),
              custom: yield* change({ protocol: 'custom', validateUrl: 'https://evil.example/v' }),
              source: yield* change({ identitySource: 'principal' }),
              attribute: yield* change({ identityAttribute: 'nickname' }),
              fallback: yield* change({ identityFallback: 'true' }),
              // asking for the password every time names nobody differently
              renew: yield* change({ renew: 'true' }),
            }
          }),
        ),
      )
      expect(answer).toEqual({
        server: 'serverUrl',
        protocol: 'protocol',
        custom: 'protocol',
        source: 'identitySource',
        attribute: 'identityAttribute',
        fallback: 'identityFallback',
        renew: 'Success',
      })
    } finally {
      await db.dispose()
    }
  })

  it('is deleted with what it let people do, and the platform door is not the tenant to delete', async () => {
    const db = await createTestContext('providers-delete')
    try {
      const f = await seed(db.url)
      const answer = ok(
        await run(
          db.url,
          Effect.gen(function* () {
            const iam = yield* Iam
            const signIn = yield* SignIn
            const id = yield* iam.providers.create(
              f.tenant,
              { type: 'campus', code: 'campus', name: 'Campus' },
              f.as,
            )
            const set = yield* iam.providers.update(
              f.tenant,
              id,
              {
                expectedVersion: 1,
                values: { server: 'https://cas.example.edu/', clientSecret: 's3cret' },
              },
              f.as,
            )
            const served = yield* iam.providers.setStatus(f.tenant, id, 'active', set, f.as)
            yield* runSql(sql`
              insert into user_auth_bindings (tenant_id, user_id, auth_provider_id, subject)
              values (${f.tenant}, ${f.person}, ${id}, 'ada@campus')`)
            yield* runSql(sql`
              insert into sessions (tenant_id, user_id, auth_provider_id, token_hash, expires_at)
              values (${f.tenant}, ${f.person}, ${id}, repeat('a', 64), now() + interval '1 day')`)
            const busy = yield* iam.providers.detail(f.tenant, id)
            const platform = yield* Effect.result(
              iam.providers.remove(f.tenant, f.local.id, f.local.version, f.as),
            )
            const stale = yield* Effect.result(iam.providers.remove(f.tenant, id, 1, f.as))
            yield* iam.providers.remove(f.tenant, id, served, f.as)
            const listed = yield* iam.providers.list(f.tenant)
            const offered = yield* signIn.loginMethods()
            const missing = yield* Effect.result(iam.providers.detail(f.tenant, id))
            const left = yield* runSql<{
              bindings: number
              sessions: number
              secrets: number
            }>(sql`
              select
                (select count(*)::int from user_auth_bindings
                   where auth_provider_id = ${id} and revoked_at is null) as bindings,
                (select count(*)::int from sessions where auth_provider_id = ${id}) as sessions,
                (select count(*)::int from secrets where owner_id = ${id}) as secrets`)
            const recorded = yield* runSql<{ details: Record<string, unknown> }>(sql`
              select details from audit_events
               where tenant_id = ${f.tenant} and action_code = 'auth.provider.delete'`)
            // the address it answered at is free again
            const again = yield* iam.providers.create(
              f.tenant,
              { type: 'campus', code: 'campus', name: 'Campus again' },
              f.as,
            )
            const listedAgain = yield* iam.providers.list(f.tenant)
            return {
              busy,
              platform,
              stale,
              listed,
              listedAgain,
              offered,
              missing,
              left: left.rows[0]!,
              recorded: recorded.rows,
              again,
            }
          }),
        ),
      )
      expect(answer.busy.usage).toMatchObject({ bindings: 1, sessions: 1 })
      expect(answer.busy.usage.sessionsByUserType.map((row) => row.sessions)).toEqual([1])
      expect(tagOf(answer.platform)).toBe('AUTH_PROVIDER_IS_SYSTEM')
      expect(tagOf(answer.stale)).toBe('AUTH_PROVIDER_VERSION_CONFLICT')
      expect(answer.listed.map((row) => row.code)).toEqual(['local'])
      expect(answer.offered.map((method) => method.code)).toEqual(['local'])
      // its address is free again, and the row at it is the new shell
      expect(answer.listedAgain.map((row) => row.code)).toEqual(['local', 'campus'])
      expect(answer.listedAgain.find((row) => row.code === 'campus')?.id).toBe(answer.again)
      expect(tagOf(answer.missing)).toBe('AUTH_PROVIDER_NOT_FOUND')
      expect(answer.left).toEqual({ bindings: 0, sessions: 0, secrets: 0 })
      expect(answer.recorded).toHaveLength(1)
      expect(answer.recorded[0]!.details).toMatchObject({
        type: 'campus',
        code: 'campus',
        revokedBindings: 1,
        endedSessions: 1,
      })
    } finally {
      await db.dispose()
    }
  })

  it('signs out whoever it stops admitting, and ends what it opened when taken out of service, keeping what it is', async () => {
    const db = await createTestContext('providers-out-of-service')
    try {
      const f = await seed(db.url)
      const answer = ok(
        await run(
          db.url,
          Effect.gen(function* () {
            const iam = yield* Iam
            const id = yield* iam.providers.create(
              f.tenant,
              { type: 'campus', code: 'campus', name: 'Campus' },
              f.as,
            )
            const set = yield* iam.providers.update(
              f.tenant,
              id,
              {
                expectedVersion: 1,
                values: { server: 'https://cas.example.edu/', clientSecret: 's3cret' },
              },
              f.as,
            )
            const served = yield* iam.providers.setStatus(f.tenant, id, 'active', set, f.as)
            const student = one<{ id: string }>(
              yield* runSql(sql`
                insert into user_types (tenant_id, code, name, placement_mode)
                values (${f.tenant}, 'student', 'Student', 'unrestricted') returning id`),
            ).id
            const bo = one<{ id: string }>(
              yield* runSql(sql`
                insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
                select tenant_id, 'Bo', ${student}, primary_org_node_id
                  from users where id = ${f.person} returning id`),
            ).id
            const staff = one<{ id: string }>(
              yield* runSql(sql`select user_type_id as id from users where id = ${f.person}`),
            ).id
            for (const [userId, subject] of [
              [f.person, 'ada@campus'],
              [bo, 'bo@campus'],
            ] as const) {
              yield* runSql(sql`
                insert into user_auth_bindings (tenant_id, user_id, auth_provider_id, subject)
                values (${f.tenant}, ${userId}, ${id}, ${subject})`)
            }
            const open = (userId: string, providerId: string) =>
              runSql(sql`
                insert into sessions (tenant_id, user_id, auth_provider_id, token_hash, expires_at)
                values (${f.tenant}, ${userId}, ${providerId}, md5(random()::text) || md5(random()::text),
                        now() + interval '1 day')`)
            yield* open(f.person, id)
            yield* open(bo, id)
            // the same person through another door is none of this door's business
            yield* open(f.person, f.local.id)
            // somebody set out through it and has not come back
            yield* runSql(sql`
              insert into auth_flows (tenant_id, auth_provider_id, state_hash, purpose, expires_at)
              values (${f.tenant}, ${id}, repeat('f', 64), 'login', now() + interval '10 minutes')`)
            const before = yield* iam.providers.detail(f.tenant, id)
            const sessionsOf = (providerId: string) =>
              Effect.map(
                runSql<{ user_id: string }>(sql`
                  select user_id from sessions where auth_provider_id = ${providerId}
                   order by user_id`),
                (result) => result.rows.map((row) => row.user_id),
              )

            // staff only: Bo is signed out of what it opened for him
            const narrowed = yield* iam.providers.setAudience(
              f.tenant,
              id,
              { mode: 'allow-list', userTypeIds: [staff] },
              served,
              f.as,
            )
            const afterNarrowing = yield* sessionsOf(id)
            // out of service: what it opened ends, what it is stays
            const rested = yield* iam.providers.setStatus(f.tenant, id, 'disabled', narrowed, f.as)
            const afterRest = yield* sessionsOf(id)
            const elsewhere = yield* sessionsOf(f.local.id)
            const left = yield* runSql<{
              bindings: number
              secrets: number
              flows: number
              server: string
            }>(sql`
              select
                (select count(*)::int from user_auth_bindings
                   where auth_provider_id = ${id} and revoked_at is null) as bindings,
                (select count(*)::int from secrets where owner_id = ${id}) as secrets,
                (select count(*)::int from auth_flows
                   where auth_provider_id = ${id} and consumed_at is null) as flows,
                (select config->>'server' from auth_providers where id = ${id}) as server`)
            // and back into service with nothing to set up again
            const back = yield* Effect.result(
              iam.providers.setStatus(f.tenant, id, 'active', rested, f.as),
            )
            const recorded = yield* runSql<{
              action_code: string
              details: Record<string, unknown>
            }>(
              sql`
                select action_code, details from audit_events
                 where tenant_id = ${f.tenant}
                   and action_code in ('auth.provider.audience.update', 'auth.provider.status')
                 order by occurred_at, id`,
            )
            return {
              before: before.usage,
              staff,
              student,
              ada: f.person,
              afterNarrowing,
              afterRest,
              elsewhere,
              left: left.rows[0]!,
              back: back._tag,
              recorded: recorded.rows,
            }
          }),
        ),
      )
      expect(answer.before.sessions).toBe(2)
      expect(
        Object.fromEntries(
          answer.before.sessionsByUserType.map((row) => [row.userTypeId, row.sessions]),
        ),
      ).toEqual({ [answer.staff]: 1, [answer.student]: 1 })
      expect(answer.afterNarrowing).toEqual([answer.ada])
      expect(answer.afterRest).toEqual([])
      expect(answer.elsewhere).toEqual([answer.ada])
      expect(answer.left).toEqual({
        bindings: 2,
        secrets: 1,
        flows: 0,
        server: 'https://cas.example.edu/',
      })
      expect(answer.back).toBe('Success')
      expect(answer.recorded.map((row) => [row.action_code, row.details['endedSessions']])).toEqual(
        [
          ['auth.provider.status', 0],
          ['auth.provider.audience.update', 1],
          ['auth.provider.status', 1],
          ['auth.provider.status', 0],
        ],
      )
    } finally {
      await db.dispose()
    }
  })

  it('asks only for the boxes it shows, and keeps what its driver works out', async () => {
    const db = await createTestContext('providers-shaped')
    try {
      const f = await seed(db.url)
      const answer = ok(
        await run(
          db.url,
          Effect.gen(function* () {
            const iam = yield* Iam
            const kinds = yield* iam.providers.kinds
            const id = yield* iam.providers.create(
              f.tenant,
              { type: 'shaped', code: 'shaped', name: 'Shaped' },
              f.as,
            )
            const shell = yield* iam.providers.detail(f.tenant, id)
            const update = (expectedVersion: number, values: Record<string, string>) =>
              iam.providers.update(f.tenant, id, { expectedVersion, values }, f.as)
            const refused = []
            for (const values of <Record<string, string>[]>[
              { mode: 'elsewhere' },
              { retries: '9' },
              { retries: '2.5' },
              { retries: 'many' },
              { strict: 'yes' },
              // the driver's own say, over values each box accepts
              { retries: '4' },
            ]) {
              refused.push(failureOf(yield* Effect.result(update(1, values))))
            }
            const custom = yield* update(1, { mode: 'custom' })
            const asking = yield* iam.providers.detail(f.tenant, id)
            const targeted = yield* update(custom, {
              target: 'https://cas.school.edu/login',
              retries: '3',
              strict: 'true',
            })
            const set = yield* iam.providers.detail(f.tenant, id)
            const storedSet = yield* runSql<{ config: Record<string, unknown> }>(
              sql`select config from auth_providers where id = ${id}`,
            )
            // back to the standard mode: the box it hid is no longer asked
            // for, and emptying a number brings back its default
            const standard = yield* update(targeted, { mode: 'standard', retries: '' })
            const back = yield* iam.providers.detail(f.tenant, id)
            const storedBack = yield* runSql<{ config: Record<string, unknown> }>(
              sql`select config from auth_providers where id = ${id}`,
            )
            return {
              kind: kinds.find((one) => one.type === 'shaped'),
              shell,
              refused,
              asking,
              set,
              storedSet: storedSet.rows[0]!.config,
              standard,
              back,
              storedBack: storedBack.rows[0]!.config,
            }
          }),
        ),
      )
      // a screen reads every field the same way
      expect(
        answer.kind?.fields.map((field) => [field.key, field.section, field.visibleWhen]),
      ).toEqual([
        ['mode', 'basic', null],
        ['target', 'basic', { field: 'mode', equals: 'custom' }],
        ['retries', 'advanced', null],
        ['strict', 'advanced', null],
      ])
      expect(answer.kind?.fields[0]).toMatchObject({
        options: [
          { value: 'standard', label: literal('Standard') },
          { value: 'custom', label: literal('Custom') },
        ],
        defaultValue: 'standard',
      })
      expect(answer.kind?.fields[2]).toMatchObject({ min: 0, max: 5, step: 1, defaultValue: '2' })
      expect(answer.kind?.fields[3]).toMatchObject({ defaultValue: 'false', options: [] })

      // nothing typed, and nothing it shows is missing: its defaults stand
      expect(answer.shell.missing).toEqual([])
      expect(answer.shell.config).toEqual({ mode: 'standard', retries: '2', strict: 'false' })
      expect(answer.refused.map((failure) => [failure?.['_tag'], failure?.['field']])).toEqual([
        ['AUTH_PROVIDER_CONFIG_INVALID', 'mode'],
        ['AUTH_PROVIDER_CONFIG_INVALID', 'retries'],
        ['AUTH_PROVIDER_CONFIG_INVALID', 'retries'],
        ['AUTH_PROVIDER_CONFIG_INVALID', 'retries'],
        ['AUTH_PROVIDER_CONFIG_INVALID', 'strict'],
        ['AUTH_PROVIDER_CONFIG_INVALID', 'retries'],
      ])

      // the box a choice reveals is asked for once it shows
      expect(answer.asking.missing).toEqual([{ kind: 'field', key: 'target' }])
      expect(answer.set.missing).toEqual([])
      expect(answer.set.config).toEqual({
        mode: 'custom',
        target: 'https://cas.school.edu/login',
        retries: '3',
        strict: 'true',
      })
      // stored parsed to each kind, and what the driver worked out beside it
      expect(answer.storedSet).toEqual({
        mode: 'custom',
        target: 'https://cas.school.edu/login',
        retries: 3,
        strict: true,
        derived: { endpoint: 'https://cas.school.edu/login', strict: true },
      })

      expect(answer.back.missing).toEqual([])
      expect(answer.back.config).toMatchObject({ mode: 'standard', retries: '2' })
      expect(answer.storedBack).toMatchObject({
        mode: 'standard',
        derived: { endpoint: 'https://fixed.example', strict: true },
      })
      expect(answer.storedBack['retries']).toBeUndefined()
    } finally {
      await db.dispose()
    }
  })
})

// How the sign-in page presents its doors: at most three listed in full, in
// their order, the rest under them in theirs, and at most one recommended -
// always one of those listed in full.
describe.runIf(postgresAvailable)('the sign-in page arrangement', () => {
  it('lists at most three in full, keeps each group in its order, and recommends one of them', async () => {
    const db = await createTestContext('providers-arrangement')
    try {
      const f = await seed(db.url)
      const answer = ok(
        await run(
          db.url,
          Effect.gen(function* () {
            const iam = yield* Iam
            const door = (code: string, order: number) =>
              Effect.map(
                runSql(sql`
                  insert into auth_providers (tenant_id, code, type, name, sort_order)
                  values (${f.tenant}, ${code}, 'campus', ${code}, ${order}) returning id`),
                (result) => one<{ id: string }>(result).id,
              )
            const a = yield* door('a', 1)
            const b = yield* door('b', 2)
            const c = yield* door('c', 3)
            const d = yield* door('d', 4)
            const crowded = yield* Effect.result(
              iam.providers.reorder(
                f.tenant,
                { primary: [a, b, c, d], secondary: [f.local.id] },
                f.as,
              ),
            )
            yield* iam.providers.reorder(
              f.tenant,
              { primary: [a, f.local.id, b], secondary: [d, c] },
              f.as,
            )
            const arranged = yield* iam.providers.list(f.tenant)
            const tile = yield* Effect.result(iam.providers.recommend(f.tenant, c, f.as))
            yield* iam.providers.recommend(f.tenant, b, f.as)
            yield* iam.providers.recommend(f.tenant, a, f.as)
            const moved = yield* iam.providers.list(f.tenant)
            // the recommended door leaves the full list, and stops being recommended
            yield* iam.providers.reorder(
              f.tenant,
              { primary: [f.local.id, b], secondary: [a, d, c] },
              f.as,
            )
            const demoted = yield* iam.providers.list(f.tenant)
            const audited = yield* runSql<{ action_code: string }>(
              sql`select action_code from audit_events
                   where action_code in ('auth.provider.recommend', 'auth.provider.reorder')
                   order by occurred_at, id`,
            )
            return { crowded, arranged, tile, moved, demoted, audited: audited.rows }
          }),
        ),
      )
      const view = (rows: readonly { code: string; prominence: string; recommended: boolean }[]) =>
        rows.map((row) => `${row.code}:${row.prominence}${row.recommended ? ':*' : ''}`)
      expect(failureOf(answer.crowded)).toMatchObject({
        _tag: 'AUTH_PROVIDER_ARRANGEMENT_INVALID',
        reason: 'primary-full',
      })
      expect(view(answer.arranged)).toEqual([
        'a:primary',
        'local:primary',
        'b:primary',
        'd:secondary',
        'c:secondary',
      ])
      expect(failureOf(answer.tile)).toMatchObject({ reason: 'not-primary' })
      // one recommended at a time: choosing a takes it from b
      expect(view(answer.moved).filter((row) => row.endsWith(':*'))).toEqual(['a:primary:*'])
      expect(view(answer.demoted)).toEqual([
        'local:primary',
        'b:primary',
        'a:secondary',
        'd:secondary',
        'c:secondary',
      ])
      expect(answer.audited.map((row) => row.action_code)).toEqual([
        'auth.provider.reorder',
        'auth.provider.recommend',
        'auth.provider.recommend',
        'auth.provider.reorder',
      ])
    } finally {
      await db.dispose()
    }
  })
})

describe.runIf(postgresAvailable)('who may change a door', () => {
  // Arranging the sign-in page and deciding what a door believes are two
  // grants: whoever may point a door at a server of their choosing may sign
  // in as anybody that server names.
  it('keeps adding a door and what it believes apart from arranging it, and asks under the lock', async () => {
    const db = await createTestContext('providers-trust')
    try {
      const f = await seed(db.url)
      const answer = ok(
        await run(
          db.url,
          Effect.gen(function* () {
            const iam = yield* Iam
            const holder = (name: string, codes: readonly string[]) =>
              Effect.gen(function* () {
                const user = one<{ id: string }>(
                  yield* runSql(sql`
                    insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
                    select tenant_id, ${name}, user_type_id, primary_org_node_id
                    from users where id = ${f.person} returning id`),
                ).id
                const role = one<{ id: string }>(
                  yield* runSql(sql`
                    insert into roles (tenant_id, code, name, kind, status, permission_mode)
                    values (${f.tenant}, ${name}, ${name}, 'tenant', 'active', 'explicit')
                    returning id`),
                ).id
                for (const code of codes) {
                  yield* runSql(sql`
                    insert into role_permissions (tenant_id, role_id, permission_id)
                    select ${f.tenant}, ${role}, id from permissions where code = ${code}`)
                }
                const grant = one<{ id: string }>(
                  yield* runSql(sql`
                    insert into role_grants (tenant_id, user_id, role_id)
                    values (${f.tenant}, ${user}, ${role}) returning id`),
                ).id
                const as: Principal = { tenantId: f.tenant, userId: user, sessionId: 's' }
                return { as, grant }
              })
            const arranger = yield* holder('arranger', ['auth.provider.manage'])
            const trustee = yield* holder('trustee', ['auth.provider.trust.manage'])
            const id = yield* iam.providers.create(
              f.tenant,
              { type: 'campus', code: 'campus', name: 'Campus' },
              f.as,
            )
            const tried = (write: Effect.Effect<unknown, unknown>) =>
              Effect.map(Effect.result(write), (result) => tagOf(result) ?? result._tag)
            const arranging = {
              add: yield* tried(
                iam.providers.create(
                  f.tenant,
                  { type: 'campus', code: 'second', name: 'Second' },
                  arranger.as,
                ),
              ),
              point: yield* tried(
                iam.providers.update(
                  f.tenant,
                  id,
                  { expectedVersion: 1, values: { server: 'https://evil.example/' } },
                  arranger.as,
                ),
              ),
              secret: yield* tried(
                iam.providers.clearSecret(f.tenant, id, 'clientSecret', 1, arranger.as),
              ),
              rename: yield* tried(
                iam.providers.update(
                  f.tenant,
                  id,
                  { expectedVersion: 1, name: 'Campus SSO' },
                  arranger.as,
                ),
              ),
            }
            const connecting = {
              add: yield* tried(
                iam.providers.create(
                  f.tenant,
                  { type: 'campus', code: 'third', name: 'Third' },
                  trustee.as,
                ),
              ),
              point: yield* tried(
                iam.providers.update(
                  f.tenant,
                  id,
                  { expectedVersion: 2, values: { server: 'https://cas.school.edu/' } },
                  trustee.as,
                ),
              ),
              rename: yield* tried(
                iam.providers.update(
                  f.tenant,
                  id,
                  { expectedVersion: 3, name: 'Late' },
                  trustee.as,
                ),
              ),
            }
            // the arranger's grant is withdrawn while a request waits for the lock
            yield* runSql(
              sql`update role_grants set revoked_at = now() where id = ${arranger.grant}`,
            )
            const withdrawn = yield* tried(
              iam.providers.update(f.tenant, id, { expectedVersion: 3, name: 'Late' }, arranger.as),
            )
            const row = one<{ name: string; config: string }>(
              yield* runSql(
                sql`select name, config::text as config, id from auth_providers where id = ${id}`,
              ),
            )
            return {
              arranging,
              connecting,
              withdrawn,
              name: row.name,
              config: JSON.parse(row.config) as unknown,
            }
          }),
        ),
      )
      expect(answer.arranging).toEqual({
        add: 'ACCESS_DENIED',
        point: 'ACCESS_DENIED',
        secret: 'ACCESS_DENIED',
        rename: 'Success',
      })
      expect(answer.connecting).toEqual({
        add: 'Success',
        point: 'Success',
        rename: 'ACCESS_DENIED',
      })
      expect(answer.withdrawn).toBe('ACCESS_DENIED')
      expect(answer.name).toBe('Campus SSO')
      expect(answer.config).toEqual({ server: 'https://cas.school.edu/' })
    } finally {
      await db.dispose()
    }
  })
})
