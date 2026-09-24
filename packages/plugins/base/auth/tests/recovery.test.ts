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
import { type Orm } from '@qualy/plugin-database/server'
import type { Principal } from '@qualy/rbac-contract'
import { serviceLayer as rbacLayer } from '@qualy/plugin-rbac/server'
import { serviceLayer as auditLayer } from '@qualy/plugin-audit/server'
import { AuditActionCatalog } from '@qualy/audit-contract/effect'
import { compileActionCatalog } from '@qualy/audit-contract/plugin'
import {
  driverContradiction,
  loginDriversLayer,
  registerLoginDriver,
  type LoginDriver,
} from '@qualy/auth-contract/login'
import { driver as localDriver } from '@qualy/plugin-auth-local'
import { userActions } from '../src/actions.ts'
import { AuthConfig } from '../src/server/auth-config.ts'
import { Iam, serviceLayer as authLayer } from '../src/server/index.ts'
import { recoveryBootCheck } from '../src/server/recovery.ts'
import { SYSTEM_ACCOUNT_USER_TYPE } from '../src/constants.ts'
import { authClosure } from './support/closure.ts'
import { secretsLayer } from '@qualy/plugin-secrets/testkit'
import { captchaLayer } from '@qualy/plugin-captcha/testkit'

// How a tenant gets back in: its system account keeps a working password
// door, provider administration cannot close it, and a process that finds a
// tenant in that state before serving says so - refusing in production.

const campus: LoginDriver = {
  type: 'campus',
  presentation: { mode: 'redirect', href: () => '/nowhere' },
  provisioning: {
    mode: 'tenant-managed',
    entrance: { label: { kind: 'literal', value: 'Campus' }, fields: [] },
  },
  resolution: { mode: 'user-field', field: 'businessNo' },
}

const stack = (url: string, strictBoot: boolean) =>
  booted(
    recoveryBootCheck.pipe(
      // the check stands on the services, which provide the resolver it reads
      Layer.provideMerge(authLayer),
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
          Layer.mergeAll(registerLoginDriver(localDriver), registerLoginDriver(campus)).pipe(
            Layer.provideMerge(loginDriversLayer),
          ),
          uiLayer,
          Layer.succeed(
            AuthConfig,
            AuthConfig.of({
              defaultTenantSlug: 'default',
              sessionTtlSeconds: 3600,
              secureCookies: false,
              sessionCookieName: 'qualy_session',
              strictBoot,
            }),
          ),
        ),
      ),
    ),
    { catalog: compileCatalog([{ owner: 'auth', permissions: authPermissions }]) },
  )

const run = <A, E>(url: string, effect: Effect.Effect<A, E, Iam | Orm>, strictBoot = false) =>
  Effect.runPromiseExit(Effect.provide(effect, stack(url, strictBoot)))

const ok = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isSuccess(exit)) return exit.value
  throw new Error(`expected success, got ${Cause.pretty(exit.cause)}`)
}

const tagOf = (result: { _tag: string; failure?: unknown }) =>
  result._tag === 'Failure' ? (result.failure as { _tag?: string })._tag : undefined

const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!

/** a tenant whose recovery account can sign in, before anybody touches it */
const seed = (url: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const tenant = one<{ id: string }>(
        yield* runSql(sql`insert into tenants (slug, name) values ('rescue','R') returning id`),
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
      const admin = one<{ id: string }>(
        yield* runSql(sql`
          insert into users (tenant_id, display_name, user_type_id, primary_org_node_id, email)
          values (${tenant}, 'Admin', ${system}, ${root}, 'root@rescue.example') returning id`),
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
      const other = one<{ id: string; version: number }>(
        yield* runSql(sql`
          insert into auth_providers (tenant_id, code, type, name, sort_order)
          values (${tenant}, 'campus', 'campus', 'Campus', 1) returning id, version`),
      )
      yield* runSql(sql`
        insert into user_auth_bindings (tenant_id, user_id, auth_provider_id, subject, credential_hash)
        values (${tenant}, ${admin}, ${local.id}, null, 'digest')`)
      const as: Principal = { tenantId: tenant, userId: admin, sessionId: 's' }
      return { tenant, system, admin, local, other, as }
    }).pipe(Effect.provide(databaseFor(url, { migrations: 'off', entities: authClosure }))),
  )

describe('a driver declaration', () => {
  it('is refused when its door could never let anybody in', () => {
    const base = { ...campus }
    expect(driverContradiction(base)).toBeUndefined()
    expect(driverContradiction(localDriver)).toBeUndefined()
    // a managed credential for somebody the door does not find by a field
    expect(
      driverContradiction({
        ...base,
        resolution: { mode: 'binding-subject' },
        binding: localDriver.binding!,
      }),
    ).toMatch(/manages a credential/)
    // a self binding the door does not find people by
    expect(driverContradiction({ ...base, binding: { mode: 'self' } })).toMatch(/bind an account/)
    // a door that finds people by a binding nobody can make
    expect(driverContradiction({ ...base, resolution: { mode: 'binding-subject' } })).toMatch(
      /nobody can make/,
    )
  })
})

describe.runIf(postgresAvailable)('the way a tenant recovers itself', () => {
  it('cannot be closed by taking the password door out of service or narrowing it', async () => {
    const db = await createTestContext('recovery-writes')
    try {
      const f = await seed(db.url)
      const answer = ok(
        await run(
          db.url,
          Effect.gen(function* () {
            const iam = yield* Iam
            const closing = yield* Effect.result(
              iam.providers.setStatus(f.tenant, f.local.id, 'disabled', f.local.version, f.as),
            )
            const narrowing = yield* Effect.result(
              iam.providers.setAudience(
                f.tenant,
                f.local.id,
                { mode: 'allow-list', userTypeIds: [] },
                f.local.version,
                f.as,
              ),
            )
            // another door is the tenant's own business
            const other = yield* iam.providers.setStatus(
              f.tenant,
              f.other.id,
              'disabled',
              f.other.version,
              f.as,
            )
            const kinds = yield* iam.providers.kinds
            return { closing: tagOf(closing), narrowing: tagOf(narrowing), other, kinds }
          }),
        ),
      )
      expect(answer.closing).toBe('RECOVERY_CHANNEL_REQUIRED')
      expect(answer.narrowing).toBe('RECOVERY_CHANNEL_REQUIRED')
      expect(answer.other).toBe(f.other.version + 1)
      // the platform's door is provisioned, never offered to be added
      expect(answer.kinds.map((kind) => kind.type)).toEqual(['campus'])
    } finally {
      await db.dispose()
    }
  })

  it('is checked before serving: a warning in development, a refusal in production', async () => {
    const db = await createTestContext('recovery-boot')
    try {
      await seed(db.url)
      // the account an upgrade leaves behind: no address to sign in by yet
      await Effect.runPromise(
        runSql(sql`update users set email = null where display_name = 'Admin'`).pipe(
          Effect.provide(databaseFor(db.url, { migrations: 'off', entities: authClosure })),
        ),
      )
      const probe = Effect.map(Iam, () => 'served')
      const lenient = await run(db.url, probe)
      const strict = await run(db.url, probe, true)
      expect(ok(lenient)).toBe('served')
      expect(Exit.isFailure(strict)).toBe(true)
      expect(Cause.pretty((strict as Exit.Failure<unknown, unknown>).cause)).toMatch(
        /tenant rescue cannot be recovered.*QUALY_ADMIN_EMAIL/s,
      )
      // once the seed has given it an address, production serves
      await Effect.runPromise(
        runSql(
          sql`update users set email = 'root@rescue.example' where display_name = 'Admin'`,
        ).pipe(Effect.provide(databaseFor(db.url, { migrations: 'off', entities: authClosure }))),
      )
      expect(ok(await run(db.url, probe, true))).toBe('served')
    } finally {
      await db.dispose()
    }
  })
})
