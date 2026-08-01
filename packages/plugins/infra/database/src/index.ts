import { Context, Service } from 'cordis'
import type { AnyRelations } from 'drizzle-orm'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { z } from 'zod'
import { runMigrations } from './migrator.ts'

declare module 'cordis' {
  interface Context {
    db: Database
  }
}

const localFallback = 'postgres://qualy:qualy@localhost:5432/qualy'

function redact(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.hostname}:${parsed.port || '5432'}${parsed.pathname}`
  } catch {
    return 'invalid connection string'
  }
}

const Config = z
  .object({
    url: z.string().default(() => process.env.DATABASE_URL ?? localFallback),
    logQueries: z.boolean().default(false),
    // 'apply' runs committed migrations during init (dev, single-instance
    // deployments); 'off' leaves them to an external `pnpm db:migrate` job.
    // Generation never happens here regardless of mode.
    migrations: z.enum(['apply', 'off']).default('apply'),
    // resolved against the working directory; boots are anchored at the repo
    // root by the dev script and deployment WORKDIR
    migrationsFolder: z.string().default('db/migrations'),
  })
  .prefault({})

export default class Database extends Service {
  static Config = Config

  private pool!: Pool
  private views = new WeakMap<AnyRelations, unknown>()

  // relations-agnostic instance, column-level typing comes from the imported table objects
  drizzle!: NodePgDatabase

  // input shape for callers; cordis validates through static Config first,
  // so the runtime value is always the parsed output
  private config: z.output<typeof Config>

  constructor(ctx: Context, config: z.input<typeof Config>) {
    super(ctx, 'db')
    this.config = config as z.output<typeof Config>
    if (!process.env.DATABASE_URL && this.config.url === localFallback) {
      ctx.logger.warn('DATABASE_URL is not set, falling back to %s', localFallback)
    }
  }

  private get options() {
    return {
      logger: this.config.logQueries
        ? { logQuery: (query: string) => this.ctx.logger.debug('query: %s', query) }
        : undefined,
    }
  }

  async *[Service.init]() {
    const target = redact(this.config.url)
    const started = performance.now()
    const pool = new Pool({ connectionString: this.config.url })
    // an unhandled 'error' event from an idle client would crash the process
    pool.on('error', (error) => this.ctx.logger.error(error))
    // dependents activate only after init completes, so migrations and the
    // liveness probe are a real gate; runMigrations is idempotent, so an hmr
    // reload of this plugin re-checks the ledger in a few milliseconds
    if (this.config.migrations === 'apply') {
      const { applied, elapsed } = await runMigrations(pool, {
        folder: this.config.migrationsFolder,
      })
      if (applied > 0) {
        this.ctx.logger.info('applied %d migration(s) (%dms)', applied, elapsed)
      } else {
        this.ctx.logger.info('migrations up to date (%dms)', elapsed)
      }
    }
    await pool.query('select 1')
    this.pool = pool
    this.drizzle = drizzle({ client: pool, ...this.options })
    this.ctx.logger.info('connected to %s (%dms)', target, Math.round(performance.now() - started))
    yield async () => {
      // cached views wrap the old pool, drop them together with it
      this.views = new WeakMap()
      await pool.end()
      this.ctx.logger.info('pool closed')
    }
  }

  // per-relations view over the shared pool, for plugins that want the db.query relational API
  withRelations<TRelations extends AnyRelations>(
    relations: TRelations,
  ): NodePgDatabase<TRelations> {
    let view = this.views.get(relations) as NodePgDatabase<TRelations> | undefined
    if (!view) {
      view = drizzle({ client: this.pool, relations, ...this.options })
      this.views.set(relations, view)
    }
    return view
  }
}
