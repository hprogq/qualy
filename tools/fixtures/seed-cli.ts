// bootstrap runner over scripts/lib/seed.ts; the whole seed executes in one
// transaction, so any failure aborts without partial writes. Credentials come
// only from environment variables and are never logged.
import { Pool } from 'pg'
import { seed } from './seed.ts'

try {
  process.loadEnvFile()
} catch {}

const url = process.env.DATABASE_URL ?? 'postgres://qualy:qualy@localhost:5432/qualy'
const pool = new Pool({ connectionString: url })
const client = await pool.connect()
try {
  await client.query('begin')
  const report = await seed(client, {
    demo: process.env.QUALY_SEED_DEMO === '1',
    adminUsername: process.env.QUALY_ADMIN_USERNAME,
    adminPassword: process.env.QUALY_ADMIN_PASSWORD,
    resetAdminPassword: process.env.QUALY_RESET_ADMIN_PASSWORD === '1',
    demoPassword: process.env.QUALY_DEMO_PASSWORD,
  })
  await client.query('commit')
  const c = report.created
  console.log(
    `seed complete: tenant +${c.tenant}, org types +${c.orgTypes}, rules +${c.rules}, ` +
      `root +${c.root}, user types +${c.userTypes}, provider +${c.provider}, ` +
      `permissions +${c.permissions}, roles +${c.roles}, grants +${c.rolePermissions + c.userTypeGrants}, ` +
      `assignments +${c.assignments}, admin ${report.admin}, demo ${report.demo}` +
      (report.demo === 'created' ? ` (+${c.demoNodes} nodes, +${c.demoUsers} users)` : ''),
  )
} catch (error) {
  await client.query('rollback')
  throw error
} finally {
  client.release()
  await pool.end()
}
