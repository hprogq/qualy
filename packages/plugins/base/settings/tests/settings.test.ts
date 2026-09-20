import { sql } from 'kysely'
import { Effect, Exit, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import { literal } from '@qualy/i18n-contract'
import { booted, systemActor } from '@qualy/rbac-contract/testkit'
import { compileCatalog } from '@qualy/rbac-contract/plugin'
import type { Principal } from '@qualy/rbac-contract'
import { AccessDenied } from '@qualy/rbac-contract/effect'
import { AuditActionCatalog } from '@qualy/audit-contract/effect'
import { compileActionCatalog } from '@qualy/audit-contract/plugin'
import { SettingCatalog, TenantSettings } from '@qualy/settings-contract/effect'
import { compileSettingCatalog, defineSettingCategory, defineTerm, normalizeOverride } from '@qualy/settings-contract'
import { uiLayer } from '@qualy/plugin-ui-registry/server/registry'
import { serviceLayer as rbacLayer } from '@qualy/plugin-rbac/server'
import { serviceLayer as auditLayer } from '@qualy/plugin-audit/server'
import { entities as orgEntities } from '@qualy/plugin-org/db'
import { entities as authEntities } from '@qualy/plugin-auth/db'
import { entities as rbacEntities } from '@qualy/plugin-rbac/db'
import { entities as auditEntities } from '@qualy/plugin-audit/db'
import { permissions as rbacPermissions } from '@qualy/plugin-rbac/permissions'
import {
  createTestContext,
  databaseFor,
  postgresAvailable,
  runSql,
} from '@qualy/plugin-database/testkit'
import type { Orm } from '@qualy/plugin-database/server'
import { entities } from '../src/db/entities.ts'
import { permissions } from '../src/permissions.ts'
import { settingsActions } from '../src/actions.ts'
import { SettingsStore, serviceLayer } from '../src/server/index.ts'

// The store under its promises: the catalog refuses what would be
// ambiguous, a tenant's words stay its own, a blank follows the default,
// and two administrators cannot silently overwrite each other.

const category = defineSettingCategory({ id: 'probe/people', label: literal('People'), order: 10 })
const personId = defineTerm({
  id: 'probe/person-id',
  categoryId: category.id,
  label: literal('Person identifier'),
  defaults: { 'zh-CN': '学工号', 'en-US': 'Student or staff ID' },
  order: 10,
})

describe('compiling the setting catalog', () => {
  it('flattens declarations and stamps their plugins', () => {
    const catalog = compileSettingCatalog([
      { pluginId: '@qualy/plugin-probe', value: { categories: [category], settings: [personId] } },
    ])
    expect(catalog.categories.map((one) => one.id)).toEqual(['probe/people'])
    expect(catalog.settings[0]?.plugin).toBe('@qualy/plugin-probe')
  })

  it('refuses a setting declared twice, a category nobody declares, and a missing default', () => {
    expect(() =>
      compileSettingCatalog([
        { pluginId: 'a', value: { categories: [category], settings: [personId] } },
        { pluginId: 'b', value: { settings: [personId] } },
      ]),
    ).toThrow(/declared by both a and b/)
    expect(() =>
      compileSettingCatalog([{ pluginId: 'a', value: { settings: [personId] } }]),
    ).toThrow(/nobody declares/)
    expect(() =>
      compileSettingCatalog([
        {
          pluginId: 'a',
          value: {
            categories: [category],
            settings: [{ ...personId, defaults: { 'zh-CN': '学工号', 'en-US': ' ' } }],
          },
        },
      ]),
    ).toThrow(/no default for en-US/)
  })

  it('normalizes an override to the delta: trimmed, blanks and defaults dropped', () => {
    expect(normalizeOverride(personId, { 'zh-CN': '  工号 ', 'en-US': 'Student or staff ID' })).toEqual({
      ok: true,
      value: { 'zh-CN': '工号' },
    })
    expect(normalizeOverride(personId, { 'fr-FR': 'Matricule' })).toEqual({
      ok: false,
      reason: 'unknown-locale',
      locale: 'fr-FR',
    })
    expect(normalizeOverride(personId, { 'zh-CN': 'x'.repeat(65) })).toEqual({
      ok: false,
      reason: 'too-long',
      locale: 'zh-CN',
    })
  })
})

const closure = [...orgEntities, ...authEntities, ...rbacEntities, ...auditEntities, ...entities] as const

const stack = (url: string) =>
  booted(
    serviceLayer.pipe(
      Layer.provideMerge(rbacLayer),
      Layer.provideMerge(
        auditLayer.pipe(
          Layer.provide(
            Layer.succeed(
              AuditActionCatalog,
              compileActionCatalog([{ owner: 'settings', actions: settingsActions }]),
            ),
          ),
        ),
      ),
      Layer.provideMerge(
        Layer.mergeAll(
          databaseFor(url, { entities: closure }),
          uiLayer,
          Layer.succeed(
            SettingCatalog,
            compileSettingCatalog([
              { pluginId: '@qualy/plugin-probe', value: { categories: [category], settings: [personId] } },
            ]),
          ),
        ),
      ),
    ),
    {
      catalog: compileCatalog([
        { owner: 'rbac', permissions: rbacPermissions },
        { owner: 'settings', permissions },
      ]),
    },
  )

const run = <A, E>(url: string, effect: Effect.Effect<A, E, SettingsStore | TenantSettings | Orm>) =>
  Effect.runPromiseExit(Effect.provide(effect, stack(url)))

const ok = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isSuccess(exit)) return exit.value
  throw new Error(`expected success, got ${JSON.stringify(exit.cause)}`)
}

const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!

/** a tenant, and an administrator holding the manage permission tenant-wide */
const seed = Effect.fn('seed')(function* (slug: string) {
  const tenant = one<{ id: string }>(
    yield* runSql(sql`insert into tenants (slug, name) values (${slug}, ${slug}) returning id`),
  ).id
  const orgType = one<{ id: string }>(
    yield* runSql(sql`insert into org_types (tenant_id, name) values (${tenant}, 'U') returning id`),
  ).id
  const root = one<{ id: string }>(
    yield* runSql(sql`
      insert into org_nodes (tenant_id, parent_id, org_type_id, name, path, depth)
      values (${tenant}, null, ${orgType}, 'Root', 'r'::ltree, 0) returning id`),
  ).id
  const staff = one<{ id: string }>(
    yield* runSql(sql`
      insert into user_types (tenant_id, code, name, placement_mode)
      values (${tenant}, 'staff', 'Staff', 'unrestricted') returning id`),
  ).id
  const admin = one<{ id: string }>(
    yield* runSql(sql`
      insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
      values (${tenant}, 'Admin', ${staff}, ${root}) returning id`),
  ).id
  const reader = one<{ id: string }>(
    yield* runSql(sql`
      insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
      values (${tenant}, 'Reader', ${staff}, ${root}) returning id`),
  ).id
  const role = one<{ id: string }>(
    yield* runSql(sql`
      insert into roles (tenant_id, code, name, kind, status, permission_mode)
        values (${tenant}, 'words', 'Words', 'tenant', 'active', 'explicit') returning id`),
  ).id
  const permission = one<{ id: string }>(
    yield* runSql(sql`
      insert into permissions (code, plugin, name, target_kind)
      values ('settings.terminology.manage', 'settings', 'manage terminology', 'tenant')
      on conflict (code) do update set code = excluded.code returning id`),
  ).id
  yield* runSql(sql`
    insert into role_permissions (tenant_id, role_id, permission_id)
    values (${tenant}, ${role}, ${permission})`)
  yield* runSql(sql`
    insert into role_grants (tenant_id, user_id, role_id)
    values (${tenant}, ${admin}, ${role})`)
  const principal = (userId: string): Principal => ({ tenantId: tenant, userId, sessionId: userId })
  return { tenant, admin: principal(admin), reader: principal(reader) }
})

describe.runIf(postgresAvailable)('tenant terminology', () => {
  it('keeps each tenant to its own words and falls back per locale', async () => {
    const db = await createTestContext('settings-words')
    try {
      const result = ok(
        await run(
          db.url,
          Effect.gen(function* () {
            const store = yield* SettingsStore
            const settings = yield* TenantSettings
            const a = yield* seed('a')
            const b = yield* seed('b')
            const written = yield* store.writeTerm(
              a.tenant,
              personId.id,
              { version: 0, override: { 'zh-CN': ' 统一编号 ' } },
              a.admin,
            )
            return {
              written,
              aZh: yield* settings.resolveTerm(a.tenant, personId, 'zh-CN'),
              aEn: yield* settings.resolveTerm(a.tenant, personId, 'en-US'),
              bZh: yield* settings.resolveTerm(b.tenant, personId, 'zh-CN'),
              read: yield* store.readTerminology(a.tenant),
              other: yield* store.readTerminology(b.tenant),
            }
          }),
        ),
      )
      expect(result.written).toEqual({ id: personId.id, override: { 'zh-CN': '统一编号' }, version: 1 })
      expect(result.aZh).toBe('统一编号')
      expect(result.aEn).toBe('Student or staff ID')
      expect(result.bZh).toBe('学工号')
      expect(result.read.terms[0]).toMatchObject({ override: { 'zh-CN': '统一编号' }, version: 1 })
      expect(result.other.terms[0]).toMatchObject({ override: {}, version: 0 })
    } finally {
      await db.dispose()
    }
  }, 120_000)

  it('moves only from the version that was read, and never deletes the row on reset', async () => {
    const db = await createTestContext('settings-version')
    try {
      const result = ok(
        await run(
          db.url,
          Effect.gen(function* () {
            const store = yield* SettingsStore
            const t = yield* seed('v')
            const first = yield* store.writeTerm(
              t.tenant,
              personId.id,
              { version: 0, override: { 'zh-CN': '工号' } },
              t.admin,
            )
            const stale = yield* Effect.exit(
              store.writeTerm(t.tenant, personId.id, { version: 0, override: { 'zh-CN': '编号' } }, t.admin),
            )
            const behind = yield* Effect.exit(
              store.writeTerm(t.tenant, personId.id, { version: 5, override: { 'zh-CN': '编号' } }, t.admin),
            )
            const reset = yield* store.writeTerm(
              t.tenant,
              personId.id,
              { version: first.version, override: { 'zh-CN': '' } },
              t.admin,
            )
            const rows = yield* runSql<{ version: number; value: unknown }>(
              sql`select version, value from tenant_setting_values where tenant_id = ${t.tenant}`,
            )
            const unknown = yield* Effect.exit(
              store.writeTerm(t.tenant, 'probe/nothing', { version: 0, override: {} }, t.admin),
            )
            const denied = yield* Effect.exit(
              store.writeTerm(t.tenant, personId.id, { version: 2, override: {} }, t.reader),
            )
            const tooLong = yield* Effect.exit(
              store.writeTerm(
                t.tenant,
                personId.id,
                { version: 2, override: { 'zh-CN': 'x'.repeat(65) } },
                t.admin,
              ),
            )
            return { first, stale, behind, reset, rows: rows.rows, unknown, denied, tooLong }
          }),
        ),
      )
      const tagOf = (exit: Exit.Exit<unknown, unknown>) =>
        Exit.isFailure(exit) ? (exit.cause.toString().match(/[A-Z_]{6,}/)?.[0] ?? null) : null
      expect(result.first.version).toBe(1)
      expect(tagOf(result.stale)).toBe('SETTING_VERSION_CONFLICT')
      expect(tagOf(result.behind)).toBe('SETTING_VERSION_CONFLICT')
      expect(result.reset).toEqual({ id: personId.id, override: {}, version: 2 })
      expect(result.rows).toEqual([{ version: 2, value: {} }])
      expect(tagOf(result.unknown)).toBe('SETTING_NOT_FOUND')
      expect(tagOf(result.denied)).toBe(AccessDenied.name === 'AccessDenied' ? 'ACCESS_DENIED' : 'ACCESS_DENIED')
      expect(tagOf(result.tooLong)).toBe('SETTING_VALUE_INVALID')
      void systemActor
    } finally {
      await db.dispose()
    }
  }, 120_000)
})
