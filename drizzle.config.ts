import { defineConfig } from 'drizzle-kit'
import { resolveSchemaEntries } from './scripts/lib/schema-entries.ts'

try {
  process.loadEnvFile()
} catch {}

const url = process.env.DATABASE_URL
if (!url) console.warn('drizzle-kit: DATABASE_URL is not set, falling back to the local default')

export default defineConfig({
  dialect: 'postgresql',
  schema: resolveSchemaEntries(),
  out: './db/migrations',
  migrations: {
    schema: 'cordis_meta',
    table: 'schema_migrations',
  },
  dbCredentials: {
    url: url ?? 'postgres://qualy:qualy@localhost:5432/qualy',
  },
})
