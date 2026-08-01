// applies pending migrations from db/migrations with a single summary line;
// drizzle-kit's own migrate command spills config/driver chatter into every
// dev start, which drowns the runtime logs
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'

try {
  process.loadEnvFile()
} catch {}

const url = process.env.DATABASE_URL ?? 'postgres://qualy:qualy@localhost:5432/qualy'
const pool = new Pool({ connectionString: url })

async function appliedCount() {
  try {
    const result = await pool.query('select count(*) from cordis_meta.schema_migrations')
    return Number(result.rows[0].count)
  } catch {
    return 0
  }
}

const started = performance.now()
try {
  const before = await appliedCount()
  await migrate(drizzle({ client: pool }), {
    migrationsFolder: 'db/migrations',
    migrationsSchema: 'cordis_meta',
    migrationsTable: 'schema_migrations',
  })
  const applied = (await appliedCount()) - before
  const elapsed = Math.round(performance.now() - started)
  console.log(
    applied > 0
      ? `applied ${applied} migration(s) (${elapsed}ms)`
      : `migrations up to date (${elapsed}ms)`,
  )
} finally {
  await pool.end()
}
