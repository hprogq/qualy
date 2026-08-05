import { randomUUID } from 'node:crypto'
import { Pool, type PoolClient } from 'pg'
import { seed } from '/Users/hangqi/Workspace/Web/qualy/scripts/lib/seed.ts'
import { resolvePluginModuleUrl } from '/Users/hangqi/Workspace/Web/qualy/scripts/lib/packages.ts'

const baseUrl = process.env.DATABASE_URL ?? 'postgres://qualy:qualy@localhost:5432/qualy'
const admin = new Pool({ connectionString: baseUrl })
admin.on('error', () => {})
const dbName = `qualy_verify_${randomUUID().slice(0, 8)}`
await admin.query(`create database "${dbName}"`)
const url = new URL(baseUrl)
url.pathname = `/${dbName}`
const pool = new Pool({ connectionString: url.href })
pool.on('error', () => {})

const inTx = async <T>(fn: (c: PoolClient) => Promise<T>) => {
  const c = await pool.connect()
  try {
    await c.query('begin')
    const r = await fn(c)
    await c.query('commit')
    return r
  } catch (e) {
    await c.query('rollback')
    throw e
  } finally {
    c.release()
  }
}

const counts = async (tag: string) => {
  const q = async (sql: string) => Number((await pool.query(sql)).rows[0].count)
  const perms = await q(
    `select count(*) from role_permissions rp join roles r on r.id = rp.role_id where r.code = 'org-manager'`,
  )
  const anchors = await q(
    `select count(*) from role_allowed_org_types t join roles r on r.id = t.role_id where r.code = 'org-manager'`,
  )
  const eligible = await q(
    `select count(*) from role_allowed_user_types t join roles r on r.id = t.role_id where r.code = 'org-manager'`,
  )
  const grants = await q(
    `select count(*) from role_grants g join roles r on r.id = g.role_id where r.code = 'org-manager'`,
  )
  const version = (await pool.query(`select version from roles where code = 'org-manager'`)).rows[0]
    ?.version
  console.log(
    `${tag}: perms=${perms} anchors=${anchors} eligible=${eligible} grants=${grants} version=${version}`,
  )
  return { perms, anchors, eligible, grants, version }
}

const facultyPlacementRows = async () =>
  Number(
    (
      await pool.query(
        `select count(*) from user_type_allowed_org_types a join user_types u on u.id = a.user_type_id where u.code = 'faculty'`,
      )
    ).rows[0].count,
  )

try {
  const { runMigrations } = (await import(
    resolvePluginModuleUrl('@qualy/plugin-database/migrator')
  )) as typeof import('/Users/hangqi/Workspace/Web/qualy/packages/plugins/infra/database/src/migrator.ts')
  await runMigrations(pool)

  const opts = { adminPassword: 'verify-password-123', demo: true, demoPassword: 'verify-demo-1' }
  await inTx((c) => seed(c, opts))
  const initial = await counts('after first seed   ')

  // an administrator narrows the demo role and revokes the manager's grant
  await pool.query(
    `delete from role_permissions rp using roles r, permissions p
     where rp.role_id = r.id and rp.permission_id = p.id
       and r.code = 'org-manager' and p.code = 'org.tree.manage'`,
  )
  await pool.query(
    `delete from role_allowed_org_types t using roles r, org_types o
     where t.role_id = r.id and t.org_type_id = o.id
       and r.code = 'org-manager' and o.code = 'major'`,
  )
  await pool.query(
    `delete from role_allowed_user_types t using roles r, user_types u
     where t.role_id = r.id and t.user_type_id = u.id
       and r.code = 'org-manager' and u.code = 'faculty'`,
  )
  await pool.query(
    `delete from role_grants g using roles r where g.role_id = r.id and r.code = 'org-manager'`,
  )
  // control: narrow a demo user type's placement, the case the file DOES guard
  await pool.query(
    `delete from user_type_allowed_org_types a using user_types u, org_types o
     where a.user_type_id = u.id and a.org_type_id = o.id
       and u.code = 'faculty' and o.code = 'class'`,
  )
  const facultyBefore = await facultyPlacementRows()
  const narrowed = await counts('after admin narrows')
  console.log(`after admin narrows: faculty placement rows=${facultyBefore}`)

  const report = await inTx((c) => seed(c, opts))
  console.log('re-seed report.created =', JSON.stringify(report.created))
  const after = await counts('after re-seed      ')
  const facultyAfter = await facultyPlacementRows()
  console.log(`after re-seed      : faculty placement rows=${facultyAfter}`)

  console.log('\n=== VERDICT ===')
  console.log(
    'role permission restored :',
    narrowed.perms < initial.perms && after.perms === initial.perms,
  )
  console.log(
    'org anchor restored      :',
    narrowed.anchors < initial.anchors && after.anchors === initial.anchors,
  )
  console.log(
    'user type elig restored  :',
    narrowed.eligible < initial.eligible && after.eligible === initial.eligible,
  )
  console.log(
    'grant restored           :',
    narrowed.grants < initial.grants && after.grants === initial.grants,
  )
  console.log('roles.version bumped     :', after.version !== initial.version)
  console.log(
    'user_type placement kept :',
    facultyAfter === facultyBefore,
    '(control: the guarded case)',
  )
} finally {
  await pool.end().catch(() => {})
  await admin.query(`drop database if exists "${dbName}" with (force)`)
  await admin.end().catch(() => {})
}
