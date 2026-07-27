import { Context, Service } from 'cordis'
import type { AnyRelations } from 'drizzle-orm'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { z } from 'zod'

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

export default class Database extends Service {
  static Config = z
    .object({
      url: z.string().default(() => process.env.DATABASE_URL ?? localFallback),
      logQueries: z.boolean().default(false),
    })
    .prefault({})

  private pool!: Pool
  private views = new WeakMap<AnyRelations, unknown>()

  // relations-agnostic instance, column-level typing comes from the imported table objects
  drizzle!: NodePgDatabase

  constructor(
    ctx: Context,
    private config: z.infer<typeof Database.Config>,
  ) {
    super(ctx, 'db')
    if (!process.env.DATABASE_URL && config.url === localFallback) {
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
    // dependents activate only after init completes, so this await is a real gate
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
  withRelations<TRelations extends AnyRelations>(relations: TRelations): NodePgDatabase<TRelations> {
    let view = this.views.get(relations) as NodePgDatabase<TRelations> | undefined
    if (!view) {
      view = drizzle({ client: this.pool, relations, ...this.options })
      this.views.set(relations, view)
    }
    return view
  }
}
