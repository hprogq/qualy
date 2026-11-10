import { booted } from '@qualy/rbac-contract/testkit'
import { compileCatalog } from '@qualy/rbac-contract/plugin'
import { permissions as authPermissions } from '@qualy/plugin-auth/permissions'
import { uiLayer } from '@qualy/plugin-ui-registry/server/registry'
import { sql } from 'kysely'
import { Cause, Effect, Exit, Layer, Scope } from 'effect'
import { HttpRouter } from 'effect/http'
import { HttpApiBuilder } from 'effect/http-api'
import { NodeHttpServer } from '@effect/platform-node'
import { createServer } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { Api } from '@qualy/api-kit/plugin'
import { QUALY_API_PREFIX } from '@qualy/api-kit'
import { Authenticated, CurrentUser } from '@qualy/auth-contract/session'
import {
  createTestContext,
  databaseFor,
  postgresAvailable,
  runSql,
} from '@qualy/plugin-database/testkit'
import { secretsLayer } from '@qualy/plugin-secrets/testkit'
import { captchaLayer } from '@qualy/plugin-captcha/testkit'
import type { Orm } from '@qualy/plugin-database/server'
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
import { DEFAULT_LIMITS, StorageConfig } from '@qualy/plugin-storage/server'
import { backendFailure } from '@qualy/plugin-storage/errors'
import { registryLayer } from '@qualy/plugin-storage/server/registry'
import { serviceLayer as storageOnlyLayer } from '@qualy/plugin-storage/server/service'
import { backendLayer, memoryBackend, type MemoryBackend } from '@qualy/plugin-storage/testkit'
import { entities as storageEntities } from '@qualy/plugin-storage/db'
import { userActions } from '../src/actions.ts'
import { AuthConfig } from '../src/server/auth-config.ts'
import { serviceLayer as authLayer } from '../src/server/index.ts'
import { LoginIcons, loginIconsLayer, loginIconApiHandlers } from '../src/server/icons.ts'
import { loginIconApiGroup } from '../src/api.ts'
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
      Layer.provideMerge(captchaLayer),
      Layer.provideMerge(secretsLayer),
      Layer.provideMerge(
        Layer.mergeAll(
          databaseFor(url, { entities: [...authClosure, ...storageEntities] }),
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
  effect: Effect.Effect<A, E, LoginIcons | Orm | Scope.Scope>,
) => Effect.runPromiseExit(Effect.provide(Effect.scoped(effect), stack(url, backend)))

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
    }).pipe(
      Effect.provide(
        databaseFor(url, { migrations: 'off', entities: [...authClosure, ...storageEntities] }),
      ),
    ),
  )

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const bytesOf = async (body: AsyncIterable<Uint8Array>) => {
  const parts: number[] = []
  for await (const part of body) parts.push(...part)
  return new Uint8Array(parts)
}

describe.runIf(postgresAvailable)('a door drawn by its own image', () => {
  it('serves versioned backend bytes from the origin and releases interrupted reads', async () => {
    const db = await createTestContext('login-icon-origin')
    const backend = memoryBackend('cos-like', { versioned: true })
    const scope = await Effect.runPromise(Scope.make())
    const server = createServer()
    try {
      const f = await seed(db.url)
      const ticket = ok(
        await run(
          db.url,
          backend,
          Effect.gen(function* () {
            const icons = yield* LoginIcons
            const ticket = yield* icons.prepareUpload(
              f.tenant,
              f.local.id,
              {
                filename: 'logo.png',
                declaredMime: 'image/png',
                size: BigInt(PNG.length),
              },
              f.as,
            )
            backend.put(`attachments/${f.tenant}/${ticket.attachmentId}`, PNG)
            yield* icons.choose(
              f.tenant,
              f.local.id,
              {
                kind: 'upload',
                reservationId: ticket.reservationId,
                surface: 'light',
              },
              f.as,
            )
            return ticket
          }),
        ),
      )
      backend.put(
        `attachments/${f.tenant}/${ticket.attachmentId}`,
        new Uint8Array(PNG.length).fill(7),
      )
      const open = vi.spyOn(backend, 'open').mockReturnValue(
        Effect.succeed({
          kind: 'redirect',
          url: 'https://example.invalid/signed',
          expiresInSeconds: 60,
        }),
      )
      let slow = false
      let broken = false
      let released = 0
      let unblock: () => void = () => {}
      const read = backend.read.bind(backend)
      const readSpy = vi.spyOn(backend, 'read').mockImplementation((ref) =>
        Effect.flatMap(read(ref), (body) =>
          Effect.acquireRelease(
            Effect.sync(() =>
              broken
                ? (async function* () {
                    yield PNG.subarray(0, 1)
                    throw new Error('stream failed')
                  })()
                : slow
                  ? (async function* () {
                      yield PNG.subarray(0, 1)
                      await new Promise<void>((resolve) => {
                        unblock = resolve
                      })
                    })()
                  : body,
            ),
            () =>
              Effect.sync(() => {
                released++
                unblock()
              }),
          ),
        ),
      )
      const auth = Layer.succeed(
        Authenticated,
        Authenticated.of((effect) => Effect.provideService(effect, CurrentUser, f.as)),
      )
      const api = Api.local(loginIconApiGroup)
      const application = HttpRouter.serve(
        HttpApiBuilder.layer(api).pipe(
          Layer.provide(loginIconApiHandlers.pipe(Layer.provide(auth))),
        ),
      ).pipe(
        Layer.provide(stack(db.url, backend)),
        Layer.provide(NodeHttpServer.layer(() => server, { port: 0 })),
      )
      await Effect.runPromise(Layer.buildWithScope(application, scope))
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('server did not listen')
      const url = `http://127.0.0.1:${address.port}${QUALY_API_PREFIX}/auth/login-methods/local/icon`
      const response = await fetch(`${url}?v=${ticket.attachmentId}`, { redirect: 'manual' })
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
      expect(response.headers.get('content-type')).toBe('image/png')
      expect(response.headers.get('content-length')).toBe(String(PNG.length))
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
      expect(response.headers.get('content-security-policy')).toContain('sandbox')
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG)
      expect(backend.openedRevision()).toBe('r1')
      expect(open).not.toHaveBeenCalled()
      const stale = await fetch(`${url}?v=wrong`, { redirect: 'manual' })
      expect(stale.headers.get('cache-control')).toBe('no-cache')
      await stale.arrayBuffer()
      const unversioned = await fetch(url)
      expect(unversioned.headers.get('cache-control')).toBe('no-cache')
      await unversioned.arrayBuffer()
      const missing = await fetch(url.replace('/local/icon', '/missing/icon'))
      expect(missing.status).toBe(404)
      expect(released).toBe(3)
      slow = true
      const abort = new AbortController()
      const pending = await fetch(url, { signal: abort.signal })
      const reader = pending.body!.getReader()
      expect((await reader.read()).value).toEqual(PNG.subarray(0, 1))
      abort.abort()
      await vi.waitFor(() => expect(released).toBe(4))
      slow = false
      broken = true
      await expect(fetch(url).then((response) => response.arrayBuffer())).rejects.toThrow()
      await vi.waitFor(() => expect(released).toBe(5))
      readSpy.mockReturnValue(Effect.fail(backendFailure('read', new Error('unavailable'))))
      const failed = await fetch(url)
      expect(failed.status).toBe(500)
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void))
      await db.dispose()
      vi.restoreAllMocks()
    }
  })
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
              { kind: 'upload', reservationId: first.reservationId, surface: 'light' },
              f.as,
            )
            const answer = yield* icons.open('campus', 'light')
            if (answer.kind !== 'stored') throw new Error('expected a stored image')
            const opened = answer.opened
            const served = yield* Effect.promise(() => bytesOf(opened.body))
            // one of the page's own instead: the image leaves circulation
            const builtin = yield* icons.choose(
              f.tenant,
              door,
              { kind: 'builtin', key: 'github' },
              f.as,
            )
            const retired = one<{ status: string }>(
              yield* runSql(
                sql`select status from storage_attachments where id = ${first.attachmentId}`,
              ),
            ).status
            const gone = yield* Effect.result(icons.open('campus', 'light'))
            const reset = yield* icons.choose(f.tenant, door, { kind: 'default' }, f.as)
            // what the store holds is what counts: a type a browser runs is not an icon
            const svg = yield* upload('image/svg+xml', PNG)
            const scripted = yield* Effect.result(
              icons.choose(
                f.tenant,
                door,
                { kind: 'upload', reservationId: svg.reservationId, surface: 'light' },
                f.as,
              ),
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
        icon: { kind: 'image', version: answer.first.attachmentId, onDark: null },
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

  it('is chosen only by somebody who may still arrange doors when the tenant is locked', async () => {
    const db = await createTestContext('login-icons-reasked')
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
            // somebody whose grant was withdrawn after the handler let them by
            const withdrawn: Principal = { tenantId: f.tenant, userId: f.person, sessionId: 's' }
            const refused = yield* Effect.result(
              icons.choose(f.tenant, door, { kind: 'builtin', key: 'github' }, withdrawn),
            )
            const icon = one<{ icon: unknown }>(
              yield* runSql(sql`select icon from auth_providers where id = ${door}`),
            ).icon
            return { refused: failureOf(refused)?.['_tag'], icon }
          }),
        ),
      )
      expect(answer).toEqual({ refused: 'ACCESS_DENIED', icon: null })
    } finally {
      await db.dispose()
    }
  })

  it('stands on a dark surface with an image of its own, or with its only one', async () => {
    const db = await createTestContext('login-icons-surfaces')
    const backend = memoryBackend()
    try {
      const f = await seed(db.url)
      const drawing = (fill: string) =>
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="${fill}" d="M0 0h24v24H0z"/></svg>`
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
            const served = (surface: 'light' | 'dark') =>
              icons
                .open('campus', surface)
                .pipe(Effect.map((opened) => (opened.kind === 'svg' ? opened.markup : 'stored')))
            // nothing to stand a dark version beside yet
            const early = yield* Effect.result(
              icons.choose(
                f.tenant,
                door,
                { kind: 'svg', markup: drawing('#fff'), surface: 'dark' },
                f.as,
              ),
            )
            const light = yield* icons.choose(
              f.tenant,
              door,
              { kind: 'svg', markup: drawing('#000'), surface: 'light' },
              f.as,
            )
            const darkBefore = yield* served('dark')
            const both = yield* icons.choose(
              f.tenant,
              door,
              { kind: 'svg', markup: drawing('#fff'), surface: 'dark' },
              f.as,
            )
            const onLight = yield* served('light')
            const onDark = yield* served('dark')
            // a new light image keeps the dark one beside it
            const ticket = yield* icons.prepareUpload(
              f.tenant,
              door,
              { filename: 'logo.png', declaredMime: 'image/png', size: BigInt(PNG.byteLength) },
              f.as,
            )
            backend.put(`attachments/${f.tenant}/${ticket.attachmentId}`, PNG)
            const replaced = yield* icons.choose(
              f.tenant,
              door,
              { kind: 'upload', reservationId: ticket.reservationId, surface: 'light' },
              f.as,
            )
            const stillDark = yield* served('dark')
            const cleared = yield* icons.choose(
              f.tenant,
              door,
              { kind: 'clear', surface: 'dark' },
              f.as,
            )
            const scripted = yield* Effect.result(
              icons.choose(
                f.tenant,
                door,
                {
                  kind: 'svg',
                  markup: '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
                  surface: 'dark',
                },
                f.as,
              ),
            )
            const reset = yield* icons.choose(f.tenant, door, { kind: 'default' }, f.as)
            const retired = one<{ status: string }>(
              yield* runSql(
                sql`select status from storage_attachments where id = ${ticket.attachmentId}`,
              ),
            ).status
            const audited = yield* runSql<{ details: Record<string, unknown> }>(
              sql`select details from audit_events where action_code = 'auth.provider.icon'
                   order by occurred_at, id`,
            )
            return {
              early,
              light,
              darkBefore,
              both,
              onLight,
              onDark,
              replaced,
              stillDark,
              cleared,
              scripted,
              reset,
              retired,
              audited: audited.rows.map((row) => row.details),
              ticket,
            }
          }),
        ),
      )
      expect(failureOf(answer.early)).toMatchObject({ reason: 'light-first' })
      expect(answer.light.icon).toMatchObject({ kind: 'image', onDark: null })
      // with no dark version, the one image stands on both
      expect(answer.darkBefore).toBe(drawing('#000'))
      expect(answer.both.icon).toMatchObject({ kind: 'image', onDark: expect.any(String) })
      expect([answer.onLight, answer.onDark]).toEqual([drawing('#000'), drawing('#fff')])
      expect(answer.replaced.icon).toEqual({
        kind: 'image',
        version: answer.ticket.attachmentId,
        onDark: (answer.both.icon as { onDark: string }).onDark,
      })
      expect(answer.stillDark).toBe(drawing('#fff'))
      expect(answer.cleared.icon).toMatchObject({ onDark: null })
      expect(failureOf(answer.scripted)).toMatchObject({ reason: 'svg' })
      expect(answer.reset).toEqual({ icon: { kind: 'builtin', key: 'campus' }, iconChosen: false })
      expect(answer.retired).toBe('retired')
      // what was chosen and for which surface, never the drawing
      expect(answer.audited.map((row) => [row['icon'], row['surface']])).toEqual([
        ['svg', 'light'],
        ['svg', 'dark'],
        ['upload', 'light'],
        ['clear', 'dark'],
        ['default', undefined],
      ])
      expect(JSON.stringify(answer.audited)).not.toContain('<svg')
    } finally {
      await db.dispose()
    }
  })
})
