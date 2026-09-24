import { inspect } from 'node:util'
import ExcelJS from 'exceljs'
import { sql } from 'kysely'
import { Effect, Exit, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { booted } from '@qualy/rbac-contract/testkit'
import { compileCatalog } from '@qualy/rbac-contract/plugin'
import type { Principal } from '@qualy/rbac-contract'
import { AuditActionCatalog } from '@qualy/audit-contract/effect'
import { compileActionCatalog } from '@qualy/audit-contract/plugin'
import { loginDriversLayer } from '@qualy/auth-contract/login'
import { uiLayer } from '@qualy/plugin-ui-registry/server/registry'
import { serviceLayer as rbacLayer } from '@qualy/plugin-rbac/server'
import { serviceLayer as auditLayer } from '@qualy/plugin-audit/server'
import { serviceLayer as authLayer } from '@qualy/plugin-auth/server'
import { AuthConfig } from '@qualy/plugin-auth/server/sign-in'
import { serviceLayer as orgLayer } from '@qualy/plugin-org/server'
import { entities as orgEntities } from '@qualy/plugin-org/db'
import { entities as authEntities } from '@qualy/plugin-auth/db'
import { entities as rbacEntities } from '@qualy/plugin-rbac/db'
import { entities as auditEntities } from '@qualy/plugin-audit/db'
import { entities as storageEntities } from '@qualy/plugin-storage/db'
import { permissions as rbacPermissions } from '@qualy/plugin-rbac/permissions'
import { permissions as authPermissions } from '@qualy/plugin-auth/permissions'
import { permissions as orgPermissions } from '@qualy/plugin-org/permissions'
import { userActions } from '@qualy/plugin-auth/actions'
import { orgActions } from '@qualy/plugin-org/actions'
import { accessActions } from '@qualy/plugin-rbac/actions'
import { DEFAULT_LIMITS, Storage, StorageConfig } from '@qualy/plugin-storage/server'
import { registryLayer } from '@qualy/plugin-storage/server/registry'
import { serviceLayer as storageOnlyLayer } from '@qualy/plugin-storage/server/service'
import { backendLayer, memoryBackend } from '@qualy/plugin-storage/testkit'
import {
  createTestContext,
  databaseFor,
  postgresAvailable,
  runSql,
} from '@qualy/plugin-database/testkit'
import type { Orm } from '@qualy/plugin-database/server'
import { entities } from '../src/db/entities.ts'
import { directoryImportActions } from '../src/actions.ts'
import { DirectoryImport, serviceLayer } from '../src/server/index.ts'
import { entities as secretsEntities, secretsLayer } from '@qualy/plugin-secrets/testkit'
import { captchaLayer } from '@qualy/plugin-captcha/testkit'

// A whole spreadsheet of people, written or not written.
//
// The claims worth making are the ones a preview cannot: that the commit
// materialises the units the file implies and the people under them in one
// transaction, that the same file cannot be imported twice, that reversing
// takes the people away through the ordinary lifecycle and leaves the
// units, and that cleaning takes only the units nobody uses.

const closure = [
  ...orgEntities,
  ...authEntities,
  ...rbacEntities,
  ...auditEntities,
  ...storageEntities,
  ...entities,
  ...secretsEntities,
] as const

const catalog = compileCatalog([
  { owner: 'org', permissions: orgPermissions },
  { owner: 'auth', permissions: authPermissions },
  { owner: 'rbac', permissions: rbacPermissions },
])

const backend = memoryBackend()

const storage = storageOnlyLayer.pipe(
  Layer.provideMerge(backendLayer(backend)),
  Layer.provideMerge(registryLayer),
  Layer.provideMerge(
    Layer.succeed(StorageConfig, { defaultBackend: backend.code, limits: DEFAULT_LIMITS }),
  ),
)

const stack = (url: string) => {
  const base = booted(
    orgLayer.pipe(
      Layer.provideMerge(authLayer),
      Layer.provideMerge(rbacLayer),
      Layer.provideMerge(
        auditLayer.pipe(
          Layer.provide(
            Layer.succeed(
              AuditActionCatalog,
              compileActionCatalog([
                { owner: 'auth', actions: userActions },
                { owner: 'org', actions: orgActions },
                { owner: 'rbac', actions: accessActions },
                { owner: 'directory', actions: directoryImportActions },
              ]),
            ),
          ),
        ),
      ),
      Layer.provideMerge(captchaLayer),
      Layer.provideMerge(secretsLayer),
      Layer.provideMerge(
        Layer.mergeAll(
          databaseFor(url, { entities: closure }),
          loginDriversLayer,
          uiLayer,
          Layer.succeed(
            AuthConfig,
            AuthConfig.of({
              defaultTenantSlug: 'default',
              sessionTtlSeconds: 604_800,
              secureCookies: false,
              sessionCookieName: 'qualy_session',
            }),
          ),
        ),
      ),
    ),
    { catalog },
  )
  const withStorage = storage.pipe(Layer.provideMerge(base))
  return serviceLayer.pipe(Layer.provideMerge(withStorage))
}

const run = <A, E>(url: string, effect: Effect.Effect<A, E, DirectoryImport | Storage | Orm>) =>
  Effect.runPromiseExit(Effect.provide(effect, stack(url)))

const ok = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isSuccess(exit)) return exit.value
  throw new Error(`expected success, got ${inspect(exit.cause, { depth: 8 })}`)
}

const tagOf = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) ? (exit.cause.toString().match(/[A-Z][A-Z_]{5,}/)?.[0] ?? null) : null

const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!

/** a school with a grammar, and an administrator who may do everything in it */
const seed = Effect.fn('seed')(function* (slug: string) {
  const tenant = one<{ id: string }>(
    yield* runSql(sql`insert into tenants (slug, name) values (${slug}, ${slug}) returning id`),
  ).id
  // the door the sign-in predicate looks for: without one enabled provider,
  // no administrator counts as able to sign in, and no retirement may pass
  yield* runSql(sql`
    insert into auth_providers (tenant_id, code, type, name)
    values (${tenant}, 'local', 'local', 'Local')`)
  const type = (name: string) =>
    Effect.map(
      runSql(sql`insert into org_types (tenant_id, name) values (${tenant}, ${name}) returning id`),
      (result) => one<{ id: string }>(result).id,
    )
  const school = yield* type('学校')
  const college = yield* type('学院')
  const grade = yield* type('年级')
  const klass = yield* type('班级')
  for (const [parent, child] of [
    [school, college],
    [college, grade],
    [grade, klass],
    [college, klass],
  ]) {
    yield* runSql(sql`
      insert into org_type_rules (tenant_id, parent_type_id, child_type_id)
      values (${tenant}, ${parent}, ${child})`)
  }
  const root = one<{ id: string }>(
    yield* runSql(sql`
      insert into org_nodes (tenant_id, parent_id, org_type_id, name, path, depth)
      values (${tenant}, null, ${school}, '示例大学', 'r'::ltree, 0) returning id`),
  ).id
  const software = one<{ id: string }>(
    yield* runSql(sql`
      insert into org_nodes (tenant_id, parent_id, org_type_id, name, path, depth)
      values (${tenant}, ${root}, ${college}, '软件学院', 'r.s'::ltree, 1) returning id`),
  ).id
  const staff = one<{ id: string }>(
    yield* runSql(sql`
      insert into user_types (tenant_id, code, name, placement_mode)
      values (${tenant}, 'staff', '教职工', 'unrestricted') returning id`),
  ).id
  const student = one<{ id: string }>(
    yield* runSql(sql`
      insert into user_types (tenant_id, code, name, placement_mode)
      values (${tenant}, 'student', '学生', 'unrestricted') returning id`),
  ).id
  const admin = one<{ id: string }>(
    yield* runSql(sql`
      insert into users (tenant_id, display_name, user_type_id, primary_org_node_id, business_no)
      values (${tenant}, '管理员', ${staff}, ${root}, 'admin') returning id`),
  ).id
  // the tenant's canonical administrator, which every retirement checks is
  // still standing afterwards
  const adminRole = one<{ id: string }>(
    yield* runSql(sql`
      insert into roles (tenant_id, code, name, kind, status, permission_mode, system_key)
      values (${tenant}, 'admin', 'Admin', 'tenant', 'active', 'all-active', 'tenant-admin')
      returning id`),
  ).id
  yield* runSql(sql`
    insert into role_grants (tenant_id, user_id, role_id) values (${tenant}, ${admin}, ${adminRole})`)
  const role = one<{ id: string }>(
    yield* runSql(sql`
      insert into roles (tenant_id, code, name, kind, status, permission_mode, anchor_mode)
      values (${tenant}, 'dir', 'Directory', 'org', 'active', 'explicit', 'allow-list') returning id`),
  ).id
  for (const code of [
    'auth.user.manage',
    'auth.user.delete',
    'auth.user.read',
    'org.tree.manage',
    'org.tree.read',
  ]) {
    const permission = one<{ id: string }>(
      yield* runSql(sql`
        insert into permissions (code, plugin, name, target_kind)
        values (${code}, ${code.split('.')[0]!}, ${code}, 'org-node')
        on conflict (code) do update set code = excluded.code returning id`),
    ).id
    yield* runSql(sql`
      insert into role_permissions (tenant_id, role_id, permission_id)
      values (${tenant}, ${role}, ${permission})`)
  }
  yield* runSql(sql`
    insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
    values (${tenant}, ${admin}, ${role}, ${root}, 'subtree')`)
  const principal: Principal = { tenantId: tenant, userId: admin, sessionId: admin }
  return {
    tenant,
    root,
    software,
    types: { school, college, grade, klass },
    student,
    admin: principal,
  }
})

/** a spreadsheet staged the way a browser stages one */
const staged = (tenant: string, who: string, rows: readonly (readonly string[])[]) =>
  Effect.gen(function* () {
    const storageService = yield* Storage
    const book = new ExcelJS.Workbook()
    const sheet = book.addWorksheet('名单')
    for (const row of rows) sheet.addRow([...row])
    const bytes = Buffer.from(yield* Effect.promise(() => book.xlsx.writeBuffer()))
    const ticket = yield* storageService.prepareUpload({
      tenantId: tenant,
      ownerUserId: who,
      filename: 'students.xlsx',
      declaredMime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size: BigInt(bytes.byteLength),
    })
    backend.put(`attachments/${tenant}/${ticket.attachmentId}`, bytes)
    const meta = yield* storageService.completeUpload({
      tenantId: tenant,
      ownerUserId: who,
      reservationId: ticket.reservationId,
    })
    return meta.id
  })

const HEADER = ['学号', '姓名', '年级', '班级'] as const

describe.runIf(postgresAvailable)('importing people from a spreadsheet', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>
  beforeAll(async () => {
    db = await createTestContext('directory-import')
  }, 120_000)
  afterAll(async () => {
    await db.dispose()
  })

  it('materialises the units the file implies and the people under them, once', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('a')
          const service = yield* DirectoryImport
          const attachmentId = yield* staged(f.tenant, f.admin.userId, [
            HEADER,
            ['230101', '张三', '2023级', '1班'],
            ['230102', '李四', '2023级', '1班'],
            ['230103', '王五', '2023级', '2班'],
          ])
          const request = {
            attachmentId,
            sheet: '名单',
            headerRow: 1,
            userTypeId: f.student,
            mapping: {
              displayName: { column: 'B' },
              businessNo: { column: 'A' },
              organization: {
                anchorNodeId: f.software,
                levels: [
                  { orgTypeId: f.types.klass, column: 'D' },
                  { orgTypeId: f.types.grade, column: 'C' },
                ],
              },
            },
          }
          const inspected = yield* service.inspect(f.tenant, attachmentId, {}, f.admin)
          const preview = yield* service.preview(f.tenant, request, f.admin)
          const done = yield* service.commit(
            f.tenant,
            { ...request, expectedPlanFingerprint: preview.planFingerprint },
            f.admin,
          )
          const again = yield* Effect.exit(
            service.commit(
              f.tenant,
              { ...request, expectedPlanFingerprint: preview.planFingerprint },
              f.admin,
            ),
          )
          const people = yield* runSql<{ display_name: string; path: string }>(sql`
            select u.display_name, n.path::text as path
              from users u join org_nodes n on n.id = u.primary_org_node_id
             where u.tenant_id = ${f.tenant} and u.user_type_id = ${f.student}
             order by u.business_no`)
          const nodes = yield* runSql<{ name: string; depth: number }>(sql`
            select name, depth from org_nodes where tenant_id = ${f.tenant} order by depth, name`)
          const detail = yield* service.detail(f.tenant, done.importId, f.admin)
          const rows = yield* service.rows(f.tenant, done.importId, {}, f.admin)
          const listed = yield* service.list(f.tenant, {}, f.admin)
          return {
            inspected,
            preview,
            done,
            again: tagOf(again),
            people: people.rows,
            nodes: nodes.rows,
            detail,
            rows,
            listed,
          }
        }),
      ),
    )
    expect(result.inspected.table.headers.map((header) => header.text)).toEqual([...HEADER])
    expect(result.inspected.table.rowCount).toBe(3)
    // the levels came in the file's order and left in the grammar's
    expect(result.preview.chain.map((level) => [level.orgTypeName, level.source])).toEqual([
      ['学校', 'root'],
      ['学院', 'fixed-node'],
      ['年级', 'column'],
      ['班级', 'column'],
    ])
    expect(result.preview.nodes).toEqual({ reused: 0, created: 3, conflicts: 0 })
    expect(result.preview.users).toEqual({ create: 3, existing: 0, warnings: 0, errors: 0 })
    expect(result.preview.createdNodes).toEqual([
      '示例大学 / 软件学院 / 2023级',
      '示例大学 / 软件学院 / 2023级 / 1班',
      '示例大学 / 软件学院 / 2023级 / 2班',
    ])
    expect(result.done).toMatchObject({
      createdUsers: 3,
      existingUsers: 0,
      createdNodes: 3,
      reusedNodes: 0,
    })
    // one upload, one import
    expect(result.again).toBe('USER_IMPORT_SOURCE_USED')
    expect(result.nodes.map((node) => node.name)).toEqual([
      '示例大学',
      '软件学院',
      '2023级',
      '1班',
      '2班',
    ])
    expect(result.people.map((person) => person.display_name)).toEqual(['张三', '李四', '王五'])
    expect(result.detail.import.standing).toEqual({ living: 3, deleted: 0 })
    expect(result.detail.nodes.map((node) => [node.disposition, node.present])).toEqual([
      ['created', true],
      ['created', true],
      ['created', true],
    ])
    expect(result.rows.items.map((row) => [row.businessNo, row.disposition, row.standing])).toEqual(
      [
        ['230101', 'created', 'active'],
        ['230102', 'created', 'active'],
        ['230103', 'created', 'active'],
      ],
    )
    expect(result.listed.items.map((item) => item.id)).toEqual([result.done.importId])
  }, 120_000)

  it('refuses a file with a wrong row whole, and reads a person already on the books as present', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('b')
          const service = yield* DirectoryImport
          // somebody already standing where the file puts them, and somebody
          // else already standing elsewhere under the same identifier
          yield* runSql(sql`
            insert into users (tenant_id, display_name, user_type_id, primary_org_node_id, business_no)
            values (${f.tenant}, '已在', ${f.student}, ${f.software}, '230201'),
                   (${f.tenant}, '别处', ${f.student}, ${f.root}, '230202')`)
          const mapping = {
            displayName: { column: 'B' },
            businessNo: { column: 'A' },
            organization: { anchorNodeId: f.software, levels: [] },
          }
          const wrong = yield* staged(f.tenant, f.admin.userId, [
            ['学号', '姓名'],
            ['230201', '已在'],
            ['230202', '别处'],
            ['', '无号'],
          ])
          const preview = yield* service.preview(
            f.tenant,
            { attachmentId: wrong, sheet: '名单', headerRow: 1, userTypeId: f.student, mapping },
            f.admin,
          )
          const refused = yield* Effect.exit(
            service.commit(
              f.tenant,
              {
                attachmentId: wrong,
                sheet: '名单',
                headerRow: 1,
                userTypeId: f.student,
                mapping,
                expectedPlanFingerprint: preview.planFingerprint,
              },
              f.admin,
            ),
          )
          const count = one<{ n: string }>(
            yield* runSql(sql`select count(*) as n from users where tenant_id = ${f.tenant}`),
          ).n
          return { preview, refused: tagOf(refused), count: Number(count) }
        }),
      ),
    )
    expect(result.preview.users).toEqual({ create: 0, existing: 1, warnings: 0, errors: 2 })
    expect(result.preview.issues.map((issue) => [issue.rowNo, issue.reason, issue.detail])).toEqual(
      [
        [4, 'business-no-required', undefined],
        [3, 'user-conflict', 'organization'],
      ],
    )
    expect(result.refused).toBe('USER_IMPORT_INVALID')
    // the administrator and the two already there: nothing else was written
    expect(result.count).toBe(3)
  }, 120_000)

  it('reverses the people through the ordinary lifecycle, cleans only the units nobody uses, and lets the list come in again', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('c')
          const service = yield* DirectoryImport
          const attachmentId = yield* staged(f.tenant, f.admin.userId, [
            HEADER,
            ['230301', '张三', '2023级', '1班'],
            ['230302', '李四', '2023级', '2班'],
          ])
          const request = {
            attachmentId,
            sheet: '名单',
            headerRow: 1,
            userTypeId: f.student,
            mapping: {
              displayName: { column: 'B' },
              businessNo: { column: 'A' },
              organization: {
                anchorNodeId: f.software,
                levels: [
                  { orgTypeId: f.types.grade, column: 'C' },
                  { orgTypeId: f.types.klass, column: 'D' },
                ],
              },
            },
          }
          const preview = yield* service.preview(f.tenant, request, f.admin)
          const done = yield* service.commit(
            f.tenant,
            { ...request, expectedPlanFingerprint: preview.planFingerprint },
            f.admin,
          )
          // somebody else moves into one of the new classes by hand
          const twoBan = one<{ id: string }>(
            yield* runSql(
              sql`select id from org_nodes where tenant_id = ${f.tenant} and name = '2班'`,
            ),
          ).id
          yield* runSql(sql`
            insert into users (tenant_id, display_name, user_type_id, primary_org_node_id, business_no)
            values (${f.tenant}, '手工', ${f.student}, ${twoBan}, 'manual')`)
          const before = yield* service.reversalPreview(f.tenant, done.importId, f.admin)
          const reversed = yield* service.reverse(
            f.tenant,
            done.importId,
            { reason: '名单用错了' },
            f.admin,
          )
          const cleaned = yield* service.cleanNodes(f.tenant, done.importId, f.admin)
          const detail = yield* service.detail(f.tenant, done.importId, f.admin)
          const gone = yield* runSql<{
            display_name: string
            deleted: boolean
            enabled: boolean
          }>(sql`
            select display_name, deleted_at is not null as deleted, enabled
              from users where tenant_id = ${f.tenant} and user_type_id = ${f.student}
             order by business_no`)
          const nodes = yield* runSql<{ name: string }>(sql`
            select name from org_nodes where tenant_id = ${f.tenant} order by depth, name`)
          // deletion is final and frees the numbers: the same list is new people
          const resent = yield* staged(f.tenant, f.admin.userId, [
            HEADER,
            ['230301', '张三', '2023级', '1班'],
            ['230302', '李四', '2023级', '2班'],
          ])
          const again = yield* service.preview(
            f.tenant,
            { ...request, attachmentId: resent },
            f.admin,
          )
          return {
            before,
            reversed,
            cleaned,
            detail,
            gone: gone.rows,
            nodes: nodes.rows.map((row) => row.name),
            again,
          }
        }),
      ),
    )
    expect(result.before).toMatchObject({ toRetire: 2, alreadyGone: 0 })
    expect(result.reversed).toEqual({ retired: 2, skipped: 0 })
    // the import's people are gone; the one added by hand is not
    expect(result.gone.map((row) => [row.display_name, row.deleted, row.enabled])).toEqual([
      ['张三', true, false],
      ['李四', true, false],
      ['手工', false, true],
    ])
    // 1班 had nobody left and went; 2班 keeps its manual person, so it and
    // the grade above it stay
    expect(result.cleaned.deleted).toBe(1)
    expect(
      result.cleaned.retained.map((node) => [node.path.split(' / ').at(-1), node.reason]),
    ).toEqual([
      ['2班', 'in-use'],
      ['2023级', 'has-children'],
    ])
    expect(result.nodes).toEqual(['示例大学', '软件学院', '2023级', '2班'])
    expect(result.detail.import.standing).toEqual({ living: 0, deleted: 2 })
    expect(result.detail.events.map((event) => event.kind)).toEqual(['nodes-cleaned', 'reversed'])
    expect(
      result.detail.nodes.map((node) => [node.path.split(' / ').at(-1), node.present]),
    ).toEqual([
      ['2023级', true],
      ['1班', false],
      ['2班', true],
    ])
    expect(result.again.users).toMatchObject({ create: 2, existing: 0, errors: 0 })
  }, 120_000)
})
