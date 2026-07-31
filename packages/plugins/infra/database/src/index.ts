import fs from 'node:fs'
import { Context, Service } from 'cordis'
import type { AnyRelations } from 'drizzle-orm'
import { getTableName, is } from 'drizzle-orm'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { PgTable } from 'drizzle-orm/pg-core'
import { Pool, type PoolClient } from 'pg'
import { z } from 'zod'

declare module 'cordis' {
  interface Context {
    db: Database
  }
}

const localFallback = 'postgres://qualy:qualy@localhost:5432/qualy'
const metaSchema = 'cordis_meta'
const migrationsTable = 'schema_migrations'
const advisoryKey = 'qualy:migrations'

function redact(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.hostname}:${parsed.port || '5432'}${parsed.pathname}`
  } catch {
    return 'invalid connection string'
  }
}

function readAssemblySha(): string | null {
  try {
    const lock = JSON.parse(fs.readFileSync('assembly.lock.json', 'utf8'))
    return typeof lock.assemblySha256 === 'string' ? lock.assemblySha256 : null
  } catch {
    return null
  }
}

export interface RegisterMeta {
  onRemove?: 'keep' | 'drop'
}

interface RegisteredObject {
  objectKind: string
  schemaName: string
  objectName: string
  identityArguments: string
  parentRelation: string
  onRemove: 'keep' | 'drop'
}

export default class Database extends Service {
  static Config = z
    .object({
      url: z.string().default(() => process.env.DATABASE_URL ?? localFallback),
      autoMigrate: z.boolean().default(true),
      migrationsFolder: z.string().default('db/migrations'),
      logQueries: z.boolean().default(false),
    })
    .prefault({})

  private pool!: Pool
  private views = new WeakMap<AnyRelations, unknown>()
  private registrations = new Map<string, RegisteredObject[]>()

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

    // advisory locks are session-scoped: hold one dedicated client for the
    // whole verify-and-migrate section so concurrent hosts serialize
    const client = await pool.connect()
    try {
      await client.query('select pg_advisory_lock(hashtext($1)::bigint)', [advisoryKey])
      await this.verifyAndMigrate(pool, client)
    } finally {
      await client
        .query('select pg_advisory_unlock(hashtext($1)::bigint)', [advisoryKey])
        .catch(() => {})
      client.release()
    }

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

  private async verifyAndMigrate(pool: Pool, client: PoolClient): Promise<void> {
    const metas = readMigrationFiles({ migrationsFolder: this.config.migrationsFolder })

    const ledgerExists = await client.query('select to_regclass($1) as rel', [
      `${metaSchema}.${migrationsTable}`,
    ])
    const applied = new Map<string, string>()
    if (ledgerExists.rows[0]?.rel) {
      const ledger = await client.query(
        `select name, hash from "${metaSchema}"."${migrationsTable}"`,
      )
      for (const row of ledger.rows) applied.set(row.name, row.hash)
    }

    // an applied migration must still exist locally, byte for byte: the
    // ledger hash is sha256 over the whole migration.sql
    for (const [name, hash] of applied) {
      const meta = metas.find((candidate) => candidate.name === name)
      if (!meta) {
        throw new Error(`applied migration ${name} is missing locally, history must not be rewritten`)
      }
      if (meta.hash !== hash) {
        throw new Error(`applied migration ${name} was modified after being applied, refusing to start`)
      }
    }

    const pending = metas.filter((meta) => !applied.has(meta.name))
    if (pending.length > 0) {
      if (!this.config.autoMigrate) {
        throw new Error(
          `${pending.length} pending migration(s) and autoMigrate is disabled, run 'pnpm db:migrate' first`,
        )
      }
      await migrate(drizzle({ client: pool }), {
        migrationsFolder: this.config.migrationsFolder,
        migrationsSchema: metaSchema,
        migrationsTable,
      })
      this.ctx.logger.info('applied %d migration(s)', pending.length)
    }

    await this.bootstrapMeta(client)
    const assemblySha = readAssemblySha()
    for (const meta of pending) {
      await client.query(
        `insert into "${metaSchema}"."migration_audit" (name, hash, assembly_sha256, applied_by)
         values ($1, $2, $3, $4) on conflict (name) do nothing`,
        [meta.name, meta.hash, assemblySha, `qualy-database/node ${process.version}`],
      )
    }
  }

  // platform metadata tables live outside the migration lineage on purpose,
  // same class of infrastructure as the migration ledger itself
  private async bootstrapMeta(client: PoolClient): Promise<void> {
    await client.query(`create schema if not exists "${metaSchema}"`)
    await client.query(`
      create table if not exists "${metaSchema}"."migration_audit" (
        name text primary key,
        hash text not null,
        assembly_sha256 text,
        applied_by text not null,
        applied_at timestamptz not null default now()
      )`)
    await client.query(`
      create table if not exists "${metaSchema}"."plugin_objects" (
        plugin_id text not null,
        object_kind text not null,
        schema_name text not null,
        object_name text not null,
        identity_arguments text not null default '',
        parent_relation text not null default '',
        source_hash text,
        installed_migration text,
        on_remove text not null default 'keep',
        registered_at timestamptz not null default now(),
        primary key (plugin_id, object_kind, schema_name, object_name, identity_arguments, parent_relation)
      )`)
  }

  // ownership registry: rows persist as the installed-object record (consumed
  // by the purge flow), the effect only manages the in-memory registration
  register(ns: string, schema: Record<string, unknown>, meta: RegisterMeta = {}) {
    return this.ctx.effect(async () => {
      const objects: RegisteredObject[] = Object.values(schema)
        .filter((value): value is PgTable => is(value, PgTable))
        .map((table) => ({
          objectKind: 'table',
          schemaName: 'public',
          objectName: getTableName(table),
          identityArguments: '',
          parentRelation: '',
          onRemove: meta.onRemove ?? 'keep',
        }))
      for (const object of objects) {
        await this.pool.query(
          `insert into "${metaSchema}"."plugin_objects"
             (plugin_id, object_kind, schema_name, object_name, identity_arguments, parent_relation, on_remove)
           values ($1, $2, $3, $4, $5, $6, $7)
           on conflict (plugin_id, object_kind, schema_name, object_name, identity_arguments, parent_relation)
           do update set on_remove = excluded.on_remove`,
          [ns, object.objectKind, object.schemaName, object.objectName, object.identityArguments, object.parentRelation, object.onRemove],
        )
        const exists = await this.pool.query(
          'select 1 from information_schema.tables where table_schema = $1 and table_name = $2',
          [object.schemaName, object.objectName],
        )
        if (exists.rowCount === 0) {
          this.ctx.logger.warn(
            "%s registered %s.%s but it does not exist, run 'pnpm db:gen' and migrate",
            ns,
            object.schemaName,
            object.objectName,
          )
        }
      }
      this.registrations.set(ns, objects)
      return () => {
        this.registrations.delete(ns)
      }
    }, `db-register:${ns}`)
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
