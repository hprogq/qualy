import { randomUUID } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// The lineage replay in database.test.ts starts from an empty database, where
// every data step of the access-model migrations touches zero rows. These
// tests populate a database in the shape the model had before those two
// migrations and then run them, so the conversion itself is under test:
// what it preserves, what it removes, and where it refuses to guess.

const baseUrl = process.env.DATABASE_URL ?? 'postgres://qualy:qualy@localhost:5432/qualy'
const migrationsFolder = fileURLToPath(new URL('../../../../../db/migrations', import.meta.url))

// the migration that replaces user-type authority with explicit grants; the
// legacy fixtures below are written against the shape of the lineage
// immediately before it
const ACCESS_MODEL = '20260803201110_access-model'

const available = await (async () => {
  const probe = new Pool({ connectionString: baseUrl, connectionTimeoutMillis: 1500 })
  try {
    await probe.query('select 1')
    return true
  } catch {
    return false
  } finally {
    await probe.end().catch(() => {})
  }
})()

if (!available && process.env.QUALY_REQUIRE_POSTGRES_TESTS === '1') {
  throw new Error('postgres-backed tests are required but the server is unreachable')
}
if (!available) console.warn('postgres unreachable, migration upgrade tests skipped')

// drop database ... with (force) races graceful client teardown: a killed
// backend's fatal 57P01 lands on a closing socket and would surface as an
// unhandled error without a listener
const quietPool = (connectionString: string) => {
  const pool = new Pool({ connectionString })
  pool.on('error', () => {})
  return pool
}

describe.runIf(available)('access model upgrade', () => {
  const adminPool = quietPool(baseUrl)
  const scratch: { name: string; pool: Pool }[] = []
  let lineageNames: string[] = []

  beforeAll(async () => {
    const entries = await readdir(migrationsFolder, { withFileTypes: true })
    lineageNames = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
    expect(lineageNames).toContain(ACCESS_MODEL)
  })

  afterAll(async () => {
    for (const { pool } of scratch) await pool.end().catch(() => {})
    for (const { name } of scratch) {
      await adminPool.query(`drop database if exists "${name}" with (force)`).catch(() => {})
    }
    await adminPool.end().catch(() => {})
  })

  // the migrator runs every pending migration inside one transaction, so
  // a data step that raises rolls the whole batch back rather than leaving the
  // database half converted. Applying batches the same way here keeps the
  // failure scenarios honest about what an operator would find afterwards.
  const applyBatch = async (pool: Pool, names: string[]) => {
    if (!names.length) return
    const client = await pool.connect()
    try {
      await client.query('begin')
      for (const name of names) {
        const text = await readFile(join(migrationsFolder, name, 'migration.sql'), 'utf8')
        for (const statement of text.split('--> statement-breakpoint')) {
          const trimmed = statement.trim()
          if (trimmed) await client.query(trimmed)
        }
      }
      await client.query('commit')
    } catch (error) {
      await client.query('rollback').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }

  // one cursor per database: `before`/`through` stop at a named migration and
  // `rest` applies whatever the cursor has not reached yet
  const openDatabase = async (label: string) => {
    const name = `qualy_upgrade_${label}_${randomUUID().slice(0, 8)}`
    await adminPool.query(`create database "${name}"`)
    const url = new URL(baseUrl)
    url.pathname = `/${name}`
    const pool = quietPool(url.href)
    scratch.push({ name, pool })

    let cursor = 0
    const run = async (upTo: number) => {
      const batch = lineageNames.slice(cursor, upTo)
      cursor = upTo
      await applyBatch(pool, batch)
    }
    return {
      pool,
      before: (migration: string) => run(lineageNames.indexOf(migration)),
      through: (migration: string) => run(lineageNames.indexOf(migration) + 1),
      rest: () => run(lineageNames.length),
    }
  }

  const failureMessage = (promise: Promise<unknown>) =>
    promise.then(
      () => 'the migration succeeded',
      (error) => (error as Error).message,
    )

  const insertId = async (pool: Pool, text: string, params: unknown[] = []) =>
    (await pool.query(text, params)).rows[0].id as string

  const rowsOf = async (pool: Pool, text: string, params: unknown[] = []) =>
    (await pool.query(text, params)).rows as Record<string, unknown>[]

  const oneRow = async (pool: Pool, text: string, params: unknown[] = []) => {
    const rows = await rowsOf(pool, text, params)
    expect(rows).toHaveLength(1)
    return rows[0]!
  }

  const tableExists = async (pool: Pool, table: string) =>
    (await pool.query(`select to_regclass($1) as reg`, [table])).rows[0].reg !== null

  // Legacy fixture builders. They write the pre-access-model column sets
  // directly: user types carry permissions, roles carry enabled/is_system, and
  // every assignment is anchored at a node with a scope.

  interface LegacyTenant {
    tenantId: string
    orgTypeId: string
    rootId: string
  }

  const legacyTenant = async (pool: Pool, slug: string): Promise<LegacyTenant> => {
    const tenantId = await insertId(
      pool,
      `insert into tenants (slug, name) values ($1, $1) returning id`,
      [slug],
    )
    const orgTypeId = await insertId(
      pool,
      `insert into org_types (tenant_id, code, name) values ($1, 'university', 'University') returning id`,
      [tenantId],
    )
    // roots are written atomically with their own uuid as the single path label
    const rootId = await insertId(
      pool,
      `insert into org_nodes (id, tenant_id, org_type_id, name, path, depth)
       select v.id, $1, $2, 'Root', replace(v.id::text, '-', '')::ltree, 0
       from (select uuidv7() as id) v returning id`,
      [tenantId, orgTypeId],
    )
    return { tenantId, orgTypeId, rootId }
  }

  const legacyChild = (pool: Pool, tenant: LegacyTenant, name: string) =>
    insertId(
      pool,
      `insert into org_nodes (id, tenant_id, parent_id, org_type_id, name, path, depth)
       select v.id, $1, $2, $3, $4, p.path || replace(v.id::text, '-', '')::ltree, p.depth + 1
       from (select uuidv7() as id) v
       join org_nodes p on p.tenant_id = $1 and p.id = $2
       returning id`,
      [tenant.tenantId, tenant.rootId, tenant.orgTypeId, name],
    )

  const legacyPermission = (
    pool: Pool,
    code: string,
    options: { scope?: 'tenant' | 'org'; toUserType?: boolean } = {},
  ) => {
    const scope = options.scope ?? 'tenant'
    return insertId(
      pool,
      `insert into permissions
         (code, plugin, name, scope, grant_to_user_type, grant_to_role, default_tenant_admin)
       values ($1, 'test', $1, $2, $3, true, false) returning id`,
      [code, scope, options.toUserType ?? scope === 'tenant'],
    )
  }

  const legacyUserType = (
    pool: Pool,
    tenantId: string,
    code: string,
    name: string,
    isSystem = false,
  ) =>
    insertId(
      pool,
      `insert into user_types (tenant_id, code, name, is_system) values ($1, $2, $3, $4) returning id`,
      [tenantId, code, name, isSystem],
    )

  const legacyUser = (pool: Pool, tenantId: string, name: string, typeId: string, nodeId: string) =>
    insertId(
      pool,
      `insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
       values ($1, $2, $3, $4) returning id`,
      [tenantId, name, typeId, nodeId],
    )

  const legacyRole = (
    pool: Pool,
    tenantId: string,
    role: {
      code: string
      name: string
      kind?: 'tenant' | 'org'
      isSystem?: boolean
      assignable?: boolean
      enabled?: boolean
      description?: string | null
    },
  ) =>
    insertId(
      pool,
      `insert into roles (tenant_id, code, name, kind, is_system, assignable, enabled, description)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [
        tenantId,
        role.code,
        role.name,
        role.kind ?? 'tenant',
        role.isSystem ?? false,
        role.assignable ?? true,
        role.enabled ?? true,
        role.description ?? null,
      ],
    )

  const typePermission = (pool: Pool, tenantId: string, typeId: string, permissionId: string) =>
    pool.query(
      `insert into user_type_permissions (tenant_id, user_type_id, permission_id) values ($1, $2, $3)`,
      [tenantId, typeId, permissionId],
    )

  const rolePermission = (pool: Pool, tenantId: string, roleId: string, permissionId: string) =>
    pool.query(
      `insert into role_permissions (tenant_id, role_id, permission_id) values ($1, $2, $3)`,
      [tenantId, roleId, permissionId],
    )

  const legacyAssignment = (
    pool: Pool,
    assignment: {
      tenantId: string
      userId: string
      roleId: string
      nodeId: string
      scope: 'self' | 'subtree'
      createdAt?: string
    },
  ) =>
    insertId(
      pool,
      `insert into user_role_assignments (tenant_id, user_id, role_id, org_node_id, scope, created_at)
       values ($1, $2, $3, $4, $5, coalesce($6::timestamptz, now())) returning id`,
      [
        assignment.tenantId,
        assignment.userId,
        assignment.roleId,
        assignment.nodeId,
        assignment.scope,
        assignment.createdAt ?? null,
      ],
    )

  // the code of the compatibility role the conversion derives from a user type
  const compatibilityCode = (userTypeId: string) => `migrated-${userTypeId.replaceAll('-', '')}`

  // what a person can actually do after the upgrade, read the way the runtime
  // reads it: through grants and the permissions of the roles they name
  const effectivePermissions = (pool: Pool) =>
    rowsOf(
      pool,
      `select u.display_name as name,
              coalesce(array_agg(distinct p.code) filter (where p.code is not null), '{}') as codes
       from users u
       left join role_grants g on g.tenant_id = u.tenant_id and g.user_id = u.id
       left join role_permissions rp on rp.tenant_id = g.tenant_id and rp.role_id = g.role_id
       left join permissions p on p.id = rp.permission_id
       group by u.id, u.display_name
       order by u.display_name`,
    ) as Promise<{ name: string; codes: string[] }[]>

  describe('a tenant whose user types carried permissions', () => {
    let pool: Pool
    let tenant: LegacyTenant
    const f = {
      studentType: '',
      facultyType: '',
      staffType: '',
      collegeId: '',
      adminRole: '',
      managerRole: '',
      renamedPermission: '',
      ada: '',
    }

    beforeAll(async () => {
      const db = await openDatabase('carried')
      pool = db.pool
      await db.before(ACCESS_MODEL)

      tenant = await legacyTenant(pool, 'carried')
      f.collegeId = await legacyChild(pool, tenant, 'College')

      const selfRead = await legacyPermission(pool, 'app.self.read')
      const reviewManage = await legacyPermission(pool, 'app.review.manage')
      const treeRead = await legacyPermission(pool, 'org.tree.read')
      const treeManage = await legacyPermission(pool, 'org.tree.manage', { scope: 'org' })
      // a permission whose code moves domain in the same migration; the row
      // must keep its identity so the rows referencing it keep working
      f.renamedPermission = await legacyPermission(pool, 'rbac.role.manage')

      f.studentType = await legacyUserType(pool, tenant.tenantId, 'student', 'Student')
      f.facultyType = await legacyUserType(pool, tenant.tenantId, 'faculty', 'Faculty')
      f.staffType = await legacyUserType(pool, tenant.tenantId, 'staff', 'Staff')

      await typePermission(pool, tenant.tenantId, f.studentType, selfRead)
      await typePermission(pool, tenant.tenantId, f.facultyType, reviewManage)
      await typePermission(pool, tenant.tenantId, f.facultyType, treeRead)
      await typePermission(pool, tenant.tenantId, f.facultyType, f.renamedPermission)

      const alice = await legacyUser(pool, tenant.tenantId, 'Alice', f.studentType, tenant.rootId)
      const bob = await legacyUser(pool, tenant.tenantId, 'Bob', f.facultyType, f.collegeId)
      await legacyUser(pool, tenant.tenantId, 'Carol', f.facultyType, tenant.rootId)
      f.ada = await legacyUser(pool, tenant.tenantId, 'Ada', f.staffType, tenant.rootId)
      expect(alice).not.toBe(bob)

      f.adminRole = await legacyRole(pool, tenant.tenantId, {
        code: 'tenant-admin',
        name: 'Tenant Admin',
        isSystem: true,
        assignable: false,
      })
      f.managerRole = await legacyRole(pool, tenant.tenantId, {
        code: 'org-manager',
        name: 'Org Manager',
        kind: 'org',
      })
      await rolePermission(pool, tenant.tenantId, f.managerRole, treeManage)

      await legacyAssignment(pool, {
        tenantId: tenant.tenantId,
        userId: f.ada,
        roleId: f.adminRole,
        nodeId: tenant.rootId,
        scope: 'subtree',
      })
      await legacyAssignment(pool, {
        tenantId: tenant.tenantId,
        userId: bob,
        roleId: f.managerRole,
        nodeId: f.collegeId,
        scope: 'subtree',
      })

      await db.rest()
    })

    it('gives every member exactly the capabilities their type conferred', async () => {
      // Alice keeps the student permission and gains nothing from Faculty;
      // Bob and Carol keep the faculty set, Bob additionally holding the org
      // role he was assigned. Ada's authority is the canonical admin role,
      // which grants by mode rather than by rows.
      expect(await effectivePermissions(pool)).toEqual([
        { name: 'Ada', codes: [] },
        { name: 'Alice', codes: ['app.self.read'] },
        {
          name: 'Bob',
          codes: ['app.review.manage', 'iam.role.manage', 'org.tree.manage', 'org.tree.read'],
        },
        { name: 'Carol', codes: ['app.review.manage', 'iam.role.manage', 'org.tree.read'] },
      ])
    })

    it('keeps the identity of a permission whose code changed domain', async () => {
      const row = await oneRow(pool, `select code, target_kind from permissions where id = $1`, [
        f.renamedPermission,
      ])
      expect(row.code).toBe('iam.role.manage')
      expect(row.target_kind).toBe('tenant')
      expect(
        await rowsOf(pool, `select 1 from permissions where code = 'rbac.role.manage'`),
      ).toEqual([])
    })

    it('translates permission scope into the target a permission judges', async () => {
      const row = await oneRow(
        pool,
        `select target_kind from permissions where code = 'org.tree.manage'`,
      )
      expect(row.target_kind).toBe('org-node')
    })

    it('builds one compatibility role per user type, holding only that type', async () => {
      const student = await oneRow(
        pool,
        `select id, name, kind, status, permission_mode, assignable, description
         from roles where tenant_id = $1 and code = $2`,
        [tenant.tenantId, compatibilityCode(f.studentType)],
      )
      expect(student.kind).toBe('tenant')
      expect(student.status).toBe('active')
      expect(student.permission_mode).toBe('explicit')
      // a technical artefact, not something an administrator may hand out
      expect(student.assignable).toBe(false)
      expect(student.description).toBe('migrated compatibility role')
      expect(String(student.name).startsWith('Student ')).toBe(true)

      // the eligible set is the single type it came from, so the rule that
      // every role declares who may hold it holds without widening reach
      const eligible = await rowsOf(
        pool,
        `select user_type_id from role_allowed_user_types where role_id = $1`,
        [student.id],
      )
      expect(eligible.map((row) => row.user_type_id)).toEqual([f.studentType])

      // a type that conferred nothing gets no role at all
      expect(
        await rowsOf(pool, `select 1 from roles where tenant_id = $1 and code = $2`, [
          tenant.tenantId,
          compatibilityCode(f.staffType),
        ]),
      ).toEqual([])
    })

    it('anchors org grants and leaves tenant grants unanchored', async () => {
      const manager = await oneRow(
        pool,
        `select org_node_id, coverage from role_grants where role_id = $1`,
        [f.managerRole],
      )
      expect(manager.org_node_id).toBe(f.collegeId)
      expect(manager.coverage).toBe('subtree')

      // the assignment was written at the root with a scope; a tenant role
      // judges over the whole tenant, so both are dropped
      const admin = await oneRow(
        pool,
        `select user_id, org_node_id, coverage from role_grants where role_id = $1`,
        [f.adminRole],
      )
      expect(admin.user_id).toBe(f.ada)
      expect(admin.org_node_id).toBeNull()
      expect(admin.coverage).toBeNull()
    })

    it('gives the canonical administrator its shape', async () => {
      const row = await oneRow(
        pool,
        `select kind, status, permission_mode, system_key, assignable, version from roles where id = $1`,
        [f.adminRole],
      )
      expect(row.system_key).toBe('tenant-admin')
      expect(row.permission_mode).toBe('all-active')
      expect(row.kind).toBe('tenant')
      expect(row.status).toBe('active')
      // it was stored unassignable, which would leave the tenant unable to
      // appoint an administrator
      expect(row.assignable).toBe(true)
      expect(row.version).toBe(1)
    })

    it('translates the enabled flag into the role lifecycle', async () => {
      const row = await oneRow(pool, `select status from roles where id = $1`, [f.managerRole])
      expect(row.status).toBe('active')
    })

    it('leaves no table behind that the old model needed', async () => {
      expect(await tableExists(pool, 'user_role_assignments')).toBe(false)
      expect(await tableExists(pool, 'user_type_permissions')).toBe(false)
      expect(await tableExists(pool, 'role_grants')).toBe(true)
      expect(await tableExists(pool, 'user_type_allowed_org_types')).toBe(true)
    })
  })

  it('removes portal access and deletes the compatibility roles it empties', async () => {
    const db = await openDatabase('portal')
    const { pool } = db
    await db.before(ACCESS_MODEL)

    const tenant = await legacyTenant(pool, 'portal')
    const portalAccess = await legacyPermission(pool, 'auth.portal.access')
    const selfRead = await legacyPermission(pool, 'app.self.read')

    const guestType = await legacyUserType(pool, tenant.tenantId, 'guest', 'Guest')
    const studentType = await legacyUserType(pool, tenant.tenantId, 'student', 'Student')
    await typePermission(pool, tenant.tenantId, guestType, portalAccess)
    await typePermission(pool, tenant.tenantId, studentType, portalAccess)
    await typePermission(pool, tenant.tenantId, studentType, selfRead)

    const gina = await legacyUser(pool, tenant.tenantId, 'Gina', guestType, tenant.rootId)
    const sam = await legacyUser(pool, tenant.tenantId, 'Sam', studentType, tenant.rootId)

    await db.rest()

    // entering the portal is authentication state, not a capability
    expect(
      await rowsOf(pool, `select 1 from permissions where code = 'auth.portal.access'`),
    ).toEqual([])

    // the guest role was left holding nothing, so it and its grants go
    expect(
      await rowsOf(pool, `select 1 from roles where tenant_id = $1 and code = $2`, [
        tenant.tenantId,
        compatibilityCode(guestType),
      ]),
    ).toEqual([])
    expect(await rowsOf(pool, `select 1 from role_grants where user_id = $1`, [gina])).toEqual([])

    // the student role still confers something, so it survives with what is left
    const studentGrant = await oneRow(
      pool,
      `select r.code, array_agg(p.code) as codes
       from role_grants g
       join roles r on r.id = g.role_id
       join role_permissions rp on rp.role_id = r.id
       join permissions p on p.id = rp.permission_id
       where g.user_id = $1 group by r.code`,
      [sam],
    )
    expect(studentGrant.code).toBe(compatibilityCode(studentType))
    expect(studentGrant.codes).toEqual(['app.self.read'])
  })

  it('stops when removing portal access would strand an administrator-authored role', async () => {
    const db = await openDatabase('stranded')
    const { pool } = db
    await db.before(ACCESS_MODEL)

    const tenant = await legacyTenant(pool, 'stranded')
    const portalAccess = await legacyPermission(pool, 'auth.portal.access')
    const portalOnly = await legacyRole(pool, tenant.tenantId, {
      code: 'portal-only',
      name: 'Portal Only',
    })
    await rolePermission(pool, tenant.tenantId, portalOnly, portalAccess)

    const message = await failureMessage(db.rest())
    // naming the role is the point: deleting, disabling or refilling it is
    // the administrator's decision, and they cannot make it unnamed
    expect(message).toContain('active roles left with no permissions')
    expect(message).toContain('portal-only')

    // the batch rolled back rather than leaving a converted half
    expect(await tableExists(pool, 'role_grants')).toBe(false)
    expect(await tableExists(pool, 'user_role_assignments')).toBe(true)
  })

  // The generated name once carried only the first six hex digits of the
  // source type's id. Under uuidv7 those are the top bits of a millisecond
  // timestamp, so every id minted within the same few hours shares them, and
  // the remaining discriminator was the first 80 characters of a name that
  // may be 100 long. Two such types generated one name between them and the
  // upgrade died on a raw unique violation, which the preflight could not
  // catch because the clash is between two rows it was about to create.
  it('generates a distinct role name for types minted in the same instant', async () => {
    const db = await openDatabase('names')
    const { pool } = db
    await db.before(ACCESS_MODEL)

    const tenant = await legacyTenant(pool, 'names')
    const read = await legacyPermission(pool, 'app.self.read')
    // agreeing for their first 80 characters and differing only after
    const shared = 'A'.repeat(80)
    const first = await legacyUserType(pool, tenant.tenantId, 'type-a', `${shared}-one`)
    const second = await legacyUserType(pool, tenant.tenantId, 'type-b', `${shared}-two`)
    await typePermission(pool, tenant.tenantId, first, read)
    await typePermission(pool, tenant.tenantId, second, read)

    // the ids really do share their leading digits, so the test is exercising
    // the collision rather than getting lucky
    const prefixes = await pool.query(
      `select left(replace(id::text, '-', ''), 6) as head from user_types
       where tenant_id = $1 order by code`,
      [tenant.tenantId],
    )
    expect(prefixes.rows[0].head).toBe(prefixes.rows[1].head)

    await db.rest()

    const names = await pool.query(
      `select name from roles where code ~ '^migrated-[0-9a-f]{32}$' order by name`,
    )
    expect(names.rows).toHaveLength(2)
    expect(names.rows[0].name).not.toBe(names.rows[1].name)
    for (const row of names.rows) expect(row.name.length).toBeLessThanOrEqual(100)
  })

  it('leaves roles an administrator named after the compatibility prefix alone', async () => {
    const db = await openDatabase('prefix')
    const { pool } = db
    await db.before(ACCESS_MODEL)

    const tenant = await legacyTenant(pool, 'prefix')
    const auditRead = await legacyPermission(pool, 'app.audit.read')
    const facultyType = await legacyUserType(pool, tenant.tenantId, 'faculty', 'Faculty')
    await typePermission(pool, tenant.tenantId, facultyType, auditRead)
    const dave = await legacyUser(pool, tenant.tenantId, 'Dave', facultyType, tenant.rootId)

    // a perfectly ordinary code that happens to start the way the generated
    // ones do; only the generated ones carry the source type's id
    const auditor = await legacyRole(pool, tenant.tenantId, {
      code: 'migrated-auditor',
      name: 'Auditor',
      description: 'authored by an administrator',
    })
    await rolePermission(pool, tenant.tenantId, auditor, auditRead)

    // a draft an administrator has not filled in yet, disabled so it is not
    // stranded; matching by prefix would delete it and its grants
    const draft = await legacyRole(pool, tenant.tenantId, {
      code: 'migrated-legacy-import',
      name: 'Legacy Import',
      enabled: false,
    })

    const first = await legacyAssignment(pool, {
      tenantId: tenant.tenantId,
      userId: dave,
      roleId: auditor,
      nodeId: tenant.rootId,
      scope: 'self',
      createdAt: '2026-01-01T00:00:00Z',
    })
    const second = await legacyAssignment(pool, {
      tenantId: tenant.tenantId,
      userId: dave,
      roleId: auditor,
      nodeId: await legacyChild(pool, tenant, 'College'),
      scope: 'subtree',
      createdAt: '2026-02-01T00:00:00Z',
    })
    await legacyAssignment(pool, {
      tenantId: tenant.tenantId,
      userId: dave,
      roleId: draft,
      nodeId: tenant.rootId,
      scope: 'self',
    })

    await db.rest()

    const kept = await oneRow(
      pool,
      `select assignable, description, status from roles where tenant_id = $1 and code = 'migrated-auditor'`,
      [tenant.tenantId],
    )
    expect(kept.assignable).toBe(true)
    expect(kept.description).toBe('authored by an administrator')
    expect(kept.status).toBe('active')
    expect(
      await rowsOf(pool, `select 1 from role_permissions where role_id = $1`, [auditor]),
    ).toHaveLength(1)
    // eligibility is only written for the generated roles
    expect(
      await rowsOf(pool, `select 1 from role_allowed_user_types where role_id = $1`, [auditor]),
    ).toEqual([])

    const survivingDraft = await oneRow(
      pool,
      `select status from roles where tenant_id = $1 and code = 'migrated-legacy-import'`,
      [tenant.tenantId],
    )
    expect(survivingDraft.status).toBe('disabled')
    expect(
      await rowsOf(pool, `select 1 from role_grants where role_id = $1`, [draft]),
    ).toHaveLength(1)

    // two anchored assignments of one tenant role collapse onto the single
    // unanchored grant, keeping the earliest deterministically
    const collapsed = await oneRow(
      pool,
      `select id, org_node_id, coverage from role_grants where role_id = $1`,
      [auditor],
    )
    expect(collapsed.id).toBe(first)
    expect(collapsed.id).not.toBe(second)
    expect(collapsed.org_node_id).toBeNull()
    expect(collapsed.coverage).toBeNull()

    // the generated role is still recognised for what it is
    const generated = await oneRow(
      pool,
      `select assignable, description from roles where tenant_id = $1 and code = $2`,
      [tenant.tenantId, compatibilityCode(facultyType)],
    )
    expect(generated.assignable).toBe(false)
    expect(generated.description).toBe('migrated compatibility role')
  })

  describe('placement policy backfill', () => {
    let pool: Pool
    let tenant: LegacyTenant
    const f = { constrained: '', free: '' }

    beforeAll(async () => {
      const db = await openDatabase('placement')
      pool = db.pool
      await db.before(ACCESS_MODEL)

      tenant = await legacyTenant(pool, 'placement')
      f.constrained = await legacyUserType(pool, tenant.tenantId, 'student', 'Student')
      f.free = await legacyUserType(pool, tenant.tenantId, 'faculty', 'Faculty')

      // the allow list is created by the access-model migration, so a tenant
      // that narrowed its placements does so between the two migrations
      await db.through(ACCESS_MODEL)
      await pool.query(
        `insert into user_type_allowed_org_types (tenant_id, user_type_id, org_type_id)
         values ($1, $2, $3)`,
        [tenant.tenantId, f.constrained, tenant.orgTypeId],
      )
      await db.rest()
    })

    it('says out loud what an empty list used to mean', async () => {
      const rows = await rowsOf(
        pool,
        `select code, placement_mode from user_types where tenant_id = $1 order by code`,
        [tenant.tenantId],
      )
      expect(rows).toEqual([
        { code: 'faculty', placement_mode: 'unrestricted' },
        { code: 'student', placement_mode: 'allow-list' },
      ])
    })

    it('leaves no default, so every writer states its policy', async () => {
      const column = await oneRow(
        pool,
        `select column_default from information_schema.columns
         where table_name = 'user_types' and column_name = 'placement_mode'`,
      )
      expect(column.column_default).toBeNull()

      // seeds and import scripts never pass through the http contract; a
      // default would let them create an unconstrained type by omission
      const failure = await pool
        .query(
          `insert into user_types (tenant_id, code, name) values ($1, 'imported', 'Imported')`,
          [tenant.tenantId],
        )
        .then(
          () => undefined,
          (error: { code?: string }) => error.code,
        )
      expect(failure).toBe('23502')
    })
  })

  it('stops when a tenant holds both administrator and system-account types', async () => {
    const db = await openDatabase('mixed')
    const { pool } = db
    await db.before(ACCESS_MODEL)

    const tenant = await legacyTenant(pool, 'mixed')
    await legacyUserType(pool, tenant.tenantId, 'administrator', 'Administrator', true)
    await legacyUserType(pool, tenant.tenantId, 'system-account', 'Service Account')

    const message = await failureMessage(db.rest())
    expect(message).toContain('administrator and system-account')

    // nothing was renamed under the operator: the tenant is left exactly as
    // it was, for them to resolve
    const rows = await rowsOf(
      pool,
      `select code from user_types where tenant_id = $1 order by code`,
      [tenant.tenantId],
    )
    expect(rows.map((row) => row.code)).toEqual(['administrator', 'system-account'])
    expect(await tableExists(pool, 'role_grants')).toBe(false)
  })

  it('stops when a system-type user stands below the tenant root', async () => {
    const db = await openDatabase('misplaced')
    const { pool } = db
    await db.before(ACCESS_MODEL)

    const tenant = await legacyTenant(pool, 'misplaced')
    const college = await legacyChild(pool, tenant, 'College')
    const systemType = await legacyUserType(
      pool,
      tenant.tenantId,
      'administrator',
      'Administrator',
      true,
    )
    await legacyUser(pool, tenant.tenantId, 'Recovery', systemType, college)

    const message = await failureMessage(db.rest())
    // authority over a person is authority over the node they stand at, so
    // moving them would be a policy decision a migration cannot make
    expect(message).toContain('system-type users stand below the tenant root')
    expect(await tableExists(pool, 'role_grants')).toBe(false)
  })
})
