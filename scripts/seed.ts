// bootstrap runner over scripts/lib/seed.ts; the whole seed executes in one
// transaction, so drift detection aborts without partial writes
import { Pool } from 'pg'
import { seed } from './lib/seed.ts'

try {
  process.loadEnvFile()
} catch {}

const url = process.env.DATABASE_URL ?? 'postgres://qualy:qualy@localhost:5432/qualy'
// QUALY_SEED_DEMO=1 forces the sample org tree (with strict verification);
// by default it is only created into a tenant without org data
const demo = process.env.QUALY_SEED_DEMO === '1' ? true : undefined
const pool = new Pool({ connectionString: url })
const client = await pool.connect()
try {
  await client.query('begin')
  const created = await seed(client, { demo })
  await client.query('commit')
  console.log(
    `seed complete: ${created.tenants} tenant(s), ${created.types} org type(s), ` +
      `${created.rules} rule(s), ${created.nodes} node(s) created, demo tree ${created.demo}`,
  )
} catch (error) {
  await client.query('rollback')
  throw error
} finally {
  client.release()
  await pool.end()
}
