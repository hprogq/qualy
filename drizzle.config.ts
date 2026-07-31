import { defineConfig } from 'drizzle-kit'
import { schemaEntries } from './generated/db/assembly.gen.ts'

try {
  process.loadEnvFile()
} catch {}

const url = process.env.DATABASE_URL
if (!url) console.warn('drizzle-kit: DATABASE_URL is not set, falling back to the local default')

export default defineConfig({
  dialect: 'postgresql',
  schema: schemaEntries,
  out: './db/migrations',
  migrations: {
    schema: 'cordis_meta',
    table: 'schema_migrations',
  },
  dbCredentials: {
    url: url ?? 'postgres://qualy:qualy@localhost:5432/qualy',
  },
})
