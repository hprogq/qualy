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
import type { Orm } from '@qualy/plugin-database/server'
import type { Principal } from '@qualy/rbac-contract'
import { serviceLayer as rbacLayer } from '@qualy/plugin-rbac/server'
import { serviceLayer as auditLayer } from '@qualy/plugin-audit/server'
import { AuditActionCatalog } from '@qualy/audit-contract/effect'
import { compileActionCatalog } from '@qualy/audit-contract/plugin'
import { loginDriversLayer, registerLoginDriver, type LoginDriver } from '@qualy/auth-contract/login'
import { driver as localDriver } from '@qualy/plugin-auth-local'
import { DEFAULT_LIMITS, StorageConfig } from '@qualy/plugin-storage/server'
import { registryLayer } from '@qualy/plugin-storage/server/registry'
import { serviceLayer as storageOnlyLayer } from '@qualy/plugin-storage/server/service'
import { backendLayer, memoryBackend, type MemoryBackend } from '@qualy/plugin-storage/testkit'
import { entities as storageEntities } from '@qualy/plugin-storage/db'
import { userActions } from '../src/actions.ts'
import { AuthConfig } from '../src/server/auth-config.ts'
import { serviceLayer as authLayer } from '../src/server/index.ts'
import { LoginIcons, loginIconsLayer } from '../src/server/icons.ts'
import { SYSTEM_ACCOUNT_USER_TYPE } from '../src/constants.ts'
import { authClosure } from './support/closure.ts'

// A door's own image: uploaded, chosen, read back by anybody, replaced, and
// put back to its kind's own. What the store holds decides what an image is,
// not what the browser said it would send.

const literal = (value: string) => ({ kind: 'literal' as const, value })

const campus: LoginDriver = {
  type: 'campus',
  icon: 'campus',
  presentation: { mode: 'redirect', href: ({ code }) => `/auth/campus/${code}/start` },
  provisioning: {
    mode: 'tenant-managed',
    entrance: { label: literal('Campus'), fields: [], identityNamespaceKeys: [] },
  },
  resolution: { mode: 'binding-subject' },
  binding: { mode: 'self' },
}

/** storage as a suite provides it: the service over a memory backend */
const storageForTest = (backend: MemoryBackend) =>
  storageOnlyLayer.pipe(
    Layer.provideMerge(backendLayer(backend)),
    Layer.provideMerge(registryLayer),
    Layer.provideMerge(
      Layer.succeed(StorageConfig, { defaultBackend: backend.code, limits: DEFAULT_LIMITS }),
    ),
  )

const stack = (url: string, backend: MemoryBackend) =>
  booted(
    loginIconsLayer.pipe(
      Layer.provideMerge(authLayer),
      Layer.provideMerge(storageForTest(backend)),
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
      Layer.provideMerge(secretsLayer),
      Layer.provideMerge(
        Layer.mergeAll(
          databaseFor(url, { entities: [...authClosure, ...storageEntities] }),
          Layer.mergeAll(
            registerLoginDriver(localDriver),
            registerLoginDriver(campus),
          ).pipe(
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
            }),
          ),
        ),
      ),
    ),
    { catalog: compileCatalog([{ owner: 'auth', permissions: authPermissions }]) },
  )

const run = <A, E>(
  url: string,
  backend: MemoryBackend,
  effect: Effect.Effect<A, E, LoginIcons | Orm>,
) =>
  Effect.runPromiseExit(Effect.provide(effect, stack(url, backend)))

const ok = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isSuccess(exit)) return exit.value
  throw new Error(`expected success, got ${Cause.pretty(exit.cause)}`)
}

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
    }).pipe(Effect.provide(databaseFor(url, { migrations: 'off', entities: [...authClosure, ...storageEntities] }))),
  )

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const bytesOf = async (body: AsyncIterable<Uint8Array>) => {
  const parts: number[] = []
  for await (const part of body) parts.push(...part)
  return new Uint8Array(parts)
}

describe.runIf(postgresAvailable)('a door drawn by its own image', () => {
  it('is uploaded, chosen, read by anybody, replaced and put back', async () => {
    const db = await createTestContext('login-icons')
    const backend = memoryBackend()
    try {
      const f = await seed(db.url)
      const answer = ok(
        await run(
          db.url,
          backend,
          Effect.gen(function* () {
            const icons = yield* LoginIcons
            const door = one<{ id: string }>(
              yield* runSql(sql`
                insert into auth_providers (tenant_id, code, type, name)
                values (${f.tenant}, 'campus', 'campus', 'Campus') returning id`),
            ).id
            const upload = (mime: string, bytes: Uint8Array) =>
              Effect.gen(function* () {
                const ticket = yield* icons.prepareUpload(
                  f.tenant,
                  door,
                  { filename: 'logo.png', declaredMime: mime, size: BigInt(bytes.byteLength) },
                  f.as,
                )
                // what a browser does with the grant
                backend.put(`attachments/${f.tenant}/${ticket.attachmentId}`, bytes)
                return ticket
              })
            const first = yield* upload('image/png', PNG)
            const chosen = yield* icons.choose(
              f.tenant,
              door,
              { kind: 'upload', reservationId: first.reservationId },
              f.as,
            )
            const opened = yield* icons.open('campus')
            const target = opened.target
            const served =
              target.kind === 'stream' ? yield* Effect.promise(() => bytesOf(target.body)) : null
            // one of the page's own instead: the image leaves circulation
            const builtin = yield* icons.choose(
              f.tenant,
              door,
              { kind: 'builtin', key: 'github' },
              f.as,
            )
            const retired = one<{ status: string }>(
              yield* runSql(sql`select status from storage_attachments where id = ${first.attachmentId}`),
            ).status
            const gone = yield* Effect.result(icons.open('campus'))
            const reset = yield* icons.choose(f.tenant, door, { kind: 'default' }, f.as)
            // what the store holds is what counts: a type a browser runs is not an icon
            const svg = yield* upload('image/svg+xml', PNG)
            const scripted = yield* Effect.result(
              icons.choose(f.tenant, door, { kind: 'upload', reservationId: svg.reservationId }, f.as),
            )
            const heavy = yield* Effect.result(
              icons.prepareUpload(
                f.tenant,
                door,
                { filename: 'big.png', declaredMime: 'image/png', size: BigInt(300 * 1024) },
                f.as,
              ),
            )
            const audited = yield* runSql<{ details: { icon: string } }>(
              sql`select details from audit_events where action_code = 'auth.provider.icon'
                   order by occurred_at, id`,
            )
            return {
              first,
              chosen,
              opened: { mime: opened.meta.declaredMime, id: opened.meta.id },
              served,
              builtin,
              retired,
              gone,
              reset,
              scripted,
              heavy,
              audited: audited.rows.map((row) => row.details.icon),
            }
          }),
        ),
      )
      expect(answer.chosen).toEqual({
        icon: { kind: 'image', version: answer.first.attachmentId },
        iconChosen: true,
      })
      expect(answer.opened).toEqual({ mime: 'image/png', id: answer.first.attachmentId })
      expect(answer.served).toEqual(PNG)
      expect(answer.builtin).toEqual({ icon: { kind: 'builtin', key: 'github' }, iconChosen: true })
      expect(answer.retired).toBe('retired')
      expect(failureOf(answer.gone)).toMatchObject({ _tag: 'AUTH_LOGIN_METHOD_ICON_UNAVAILABLE' })
      // back to its kind's own
      expect(answer.reset).toEqual({ icon: { kind: 'builtin', key: 'campus' }, iconChosen: false })
      expect(failureOf(answer.scripted)).toMatchObject({ reason: 'type' })
      expect(failureOf(answer.heavy)).toMatchObject({ reason: 'size' })
      expect(answer.audited).toEqual(['upload', 'builtin', 'default'])
    } finally {
      await db.dispose()
    }
  })
})
