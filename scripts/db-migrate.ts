// thin adapter over the database plugin's migrator, kept for deploy jobs and
// manual use; in normal boots the database plugin applies migrations itself
// during Service.init (migrations: 'apply')
import { Pool } from 'pg'
import { resolvePluginModuleUrl } from './lib/schema-entries.ts'

try {
  process.loadEnvFile()
} catch {}

const { runMigrations } = (await import(
  resolvePluginModuleUrl('@qualy/plugin-database/migrator')
)) as typeof import('../packages/plugins/infra/database/src/migrator.ts')

const url = process.env.DATABASE_URL ?? 'postgres://qualy:qualy@localhost:5432/qualy'
const pool = new Pool({ connectionString: url })
try {
  const { applied, elapsed } = await runMigrations(pool)
  console.log(
    applied > 0
      ? `applied ${applied} migration(s) (${elapsed}ms)`
      : `migrations up to date (${elapsed}ms)`,
  )
} finally {
  await pool.end()
}
