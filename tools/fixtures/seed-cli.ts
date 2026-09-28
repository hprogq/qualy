// bootstrap runner over scripts/lib/seed.ts; the whole seed executes in one
// transaction, so any failure aborts without partial writes. Credentials come
// only from environment variables and are never logged.
//
// It reads no file of its own. `pnpm seed` hands it this checkout's .env,
// which is what a development machine wants; a deployment runs this file
// directly with only what it is given (deploy/README.md), because a checkout
// on a developer's machine keeps that developer's .env - QUALY_SEED_DEMO=1
// among it - and a production seed must not pick any of it up.
import { Pool } from 'pg'
import { seed } from './seed.ts'

const url = process.env.DATABASE_URL ?? 'postgres://qualy:qualy@localhost:5432/qualy'
const pool = new Pool({ connectionString: url })
const client = await pool.connect()
try {
  await client.query('begin')
  const report = await seed(client, {
    demo: process.env.QUALY_SEED_DEMO === '1',
    adminEmail: process.env.QUALY_ADMIN_EMAIL,
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
