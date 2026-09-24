import { Pool } from 'pg'

// Which database the demonstration data goes into, and the refusals that keep
// it away from any other.
//
// The seeder never reads DATABASE_URL: that names the developer's own data.
// It takes QUALY_DEMO_DATABASE_URL, refuses one that points where
// DATABASE_URL does, and refuses a database holding anything beyond its
// migrations - so a mistyped variable can only ever meet an empty database.

export const DEMO_URL_VARIABLE = 'QUALY_DEMO_DATABASE_URL'

/** host, port and database name, which is what makes two urls the same database */
const identity = (url: string) => {
  const parsed = new URL(url)
  const host = parsed.hostname === '127.0.0.1' ? 'localhost' : parsed.hostname
  return `${host}:${parsed.port === '' ? '5432' : parsed.port}/${parsed.pathname.slice(1)}`
}

export const demoUrl = (env: NodeJS.ProcessEnv = process.env): string => {
  const url = env[DEMO_URL_VARIABLE]
  if (url === undefined || url === '') {
    throw new Error(
      `${DEMO_URL_VARIABLE} is not set. Point it at the demo database, for example postgres://qualy:qualy@localhost:5434/qualy_demo`,
    )
  }
  const own = env.DATABASE_URL
  if (own !== undefined && own !== '' && identity(own) === identity(url)) {
    throw new Error(
      `${DEMO_URL_VARIABLE} names the same database as DATABASE_URL (${identity(url)}); the demo data never goes into the development database`,
    )
  }
  return url
}

/**
 * The database must hold nothing but its schema: no tenant has been seeded
 * into it. A partly seeded database is refused too - the seeder starts over
 * on a fresh one rather than guessing what an earlier run left.
 */
export const requireEmpty = async (url: string): Promise<void> => {
  const pool = new Pool({ connectionString: url })
  try {
    const migrated = await pool.query<{ present: boolean }>(
      `select to_regclass('public.tenants') is not null as present`,
    )
    if (!migrated.rows[0]!.present) {
      throw new Error(`${identity(url)} has no schema yet; create it with pnpm demo:reset-db`)
    }
    const tenants = await pool.query<{ count: string }>(`select count(*)::text from tenants`)
    if (tenants.rows[0]!.count !== '0') {
      throw new Error(
        `${identity(url)} already holds ${tenants.rows[0]!.count} tenant(s); the seeder only fills an empty database. Recreate it (pnpm demo:reset-db) and run again`,
      )
    }
  } finally {
    await pool.end()
  }
}

export const describeTarget = (url: string) => identity(url)
