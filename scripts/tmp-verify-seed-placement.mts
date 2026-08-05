import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { seed } from '/Users/hangqi/Workspace/Web/qualy/scripts/lib/seed.ts'
import { resolvePluginModuleUrl } from '/Users/hangqi/Workspace/Web/qualy/scripts/lib/packages.ts'

const baseUrl = process.env.DATABASE_URL ?? 'postgres://qualy:qualy@localhost:5432/qualy'
const admin = new Pool({ connectionString: baseUrl })
admin.on('error', () => {})
const dbName = `qualy_vrf_${randomUUID().slice(0, 8)}`
await admin.query(`create database "${dbName}"`)
const url = new URL(baseUrl)
url.pathname = `/${dbName}`
const pool = new Pool({ connectionString: url.href })
pool.on('error', () => {})

const LEGAL = `
  case
    when t.is_system then n.parent_id is null
    when t.placement_mode = 'unrestricted' then true
    else exists (select 1 from user_type_allowed_org_types a
                 where a.tenant_id = t.tenant_id and a.user_type_id = t.id
                   and a.org_type_id = n.org_type_id)
  end`

try {
  const { runMigrations } = (await import(
    resolvePluginModuleUrl('@qualy/plugin-database/migrator')
  )) as typeof import('/Users/hangqi/Workspace/Web/qualy/packages/plugins/infra/database/src/migrator.ts')
  await runMigrations(pool)

  const run = async (options: Parameters<typeof seed>[1]) => {
    const c = await pool.connect()
    try {
      await c.query('begin')
      const r = await seed(c, options)
      await c.query('commit')
      return r
    } catch (e) {
      await c.query('rollback')
      throw e
    } finally {
      c.release()
    }
  }

  await run({ adminPassword: 'repro-password-123' })

  const tenantId = (await pool.query(`select id from tenants where slug = 'default'`)).rows[0].id

  // The tenant already has a user type coded `student`, narrowed to `grade`.
  // Nothing in the seed reserves that code, and nothing about this row is
  // "drift" by the seed's own definition (is_system matches, and
  // allow_local_login is only compared for system types).
  const typeId = (
    await pool.query(
      `insert into user_types (tenant_id, code, name, sort_order, allow_local_login, is_system,
         enabled, placement_mode)
       values ($1, 'student', '学生', 10, true, false, true, 'allow-list') returning id`,
      [tenantId],
    )
  ).rows[0].id
  await pool.query(
    `insert into user_type_allowed_org_types (tenant_id, user_type_id, org_type_id)
     select $1, $2, id from org_types where tenant_id = $1 and code = 'grade'`,
    [tenantId, typeId],
  )

  const report = await run({
    adminPassword: 'repro-password-123',
    demo: true,
    demoPassword: 'repro-demo-1234',
  })
  console.log(
    `seed reported: demo ${report.demo} (+${report.created.demoNodes} nodes, +${report.created.demoUsers} users), user types +${report.created.userTypes}`,
  )

  const state = await pool.query(`
    select u.display_name, t.code as type_code, t.placement_mode, ot.code as node_type,
      ${LEGAL} as placement_legal
    from users u
    join user_types t on t.tenant_id = u.tenant_id and t.id = u.user_type_id
    join org_nodes n on n.tenant_id = u.tenant_id and n.id = u.primary_org_node_id
    join org_types ot on ot.id = n.org_type_id
    order by u.display_name`)
  console.table(state.rows)

  const stranded = await pool.query(`
    select count(*)::int as count
    from users u
    join user_types t on t.tenant_id = u.tenant_id and t.id = u.user_type_id
    join org_nodes n on n.tenant_id = u.tenant_id and n.id = u.primary_org_node_id
    where not ${LEGAL}`)
  console.log('stranded users after demo seed =', stranded.rows[0].count)
} finally {
  await pool.end().catch(() => {})
  await admin.query(`drop database if exists "${dbName}" with (force)`)
  await admin.end()
}
