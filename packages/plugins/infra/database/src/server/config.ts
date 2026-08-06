import path from 'node:path'
import { Config, Context, Effect, Layer, Option, Redacted, Schema } from 'effect'
import { LOCAL_FALLBACK, MIGRATIONS_FOLDER } from '../defaults.ts'

/**
 * What the database needs to know.
 *
 * Its own module because both the connection and the ORM built on top of it
 * need it, and importing one from the other to reach it would make the two a
 * cycle.
 */
export class DatabaseConfig extends Context.Service<
  DatabaseConfig,
  {
    readonly url: Redacted.Redacted
    /** 'apply' runs the committed lineage during startup; 'off' refuses to start behind it */
    readonly migrations: 'apply' | 'off'
    /** absolute path to the lineage this assembly deploys */
    readonly migrationsFolder: string
    /**
     * How many connections this process may hold.
     *
     * Stated by the caller because the answer is about the deployment, not
     * about the plugin: one server process wants a pool, and a suite running
     * fourteen of them against one postgres wants each to want very little.
     * Left to a library default, the second exhausts max_connections and the
     * failure lands on whichever unrelated test connected last.
     */
    readonly poolSize?: number | undefined
  }
>()('@qualy/plugin-database/DatabaseConfig') {}

/**
 * What this plugin accepts in `qualy.yml`.
 *
 * Where the lineage lives, and nothing else. It belongs in the manifest rather
 * than the environment because `qualy generate` and `qualy deploy` read the
 * same key: a second copy in an environment variable is how a CLI comes to
 * write one lineage while the process applies another. The connection string
 * is the opposite - a credential, and a manifest is committed - so it is
 * refused here and read from the environment below.
 */
export const DatabaseManifestConfig = Schema.Struct({
  migrationsFolder: Schema.optional(Schema.String),
})
export type DatabaseManifestConfig = typeof DatabaseManifestConfig.Type

/**
 * The configuration layer the generated runtime module builds.
 *
 * The host used to assemble this, which is why the composition root had to
 * name this plugin. It reads its own environment now, and resolves its own
 * relative path against the manifest it was configured from.
 */
export const config = (
  manifest: DatabaseManifestConfig,
  context: { readonly manifestDir: string },
): Layer.Layer<DatabaseConfig, Schema.SchemaError | Config.ConfigError> =>
  Layer.effect(
    DatabaseConfig,
    Effect.gen(function* () {
      // `error` rather than the default `ignore`: a key this plugin does not
      // read is a setting that looks applied and is not, which is the failure
      // the whole channel exists to prevent. `url` is the one that would hurt
      // - a manifest is committed, so a connection string in it is a
      // credential in version control, and it is read from the environment.
      const declared = yield* Schema.decodeUnknownEffect(DatabaseManifestConfig)(manifest, {
        onExcessProperty: 'error',
      })
      const environment = yield* Config.string('NODE_ENV').pipe(Config.withDefault('development'))
      // asking whether it was set, rather than comparing the value: the local
      // default is a real connection string somebody may well have configured
      // on purpose, and warning about their own setting is noise
      const configured = yield* Config.option(Config.string('DATABASE_URL'))
      if (Option.isNone(configured)) {
        // A production instance that falls back connects to whatever postgres
        // happens to be on localhost and, with migrations on, applies the
        // lineage to it. That is a deployment writing to a database nobody
        // meant to give it, and it starts with a warning nobody reads.
        if (environment === 'production') {
          return yield* Effect.die(
            new Error('DATABASE_URL is not set; a production instance will not assume one'),
          )
        }
        yield* Effect.logWarning(`DATABASE_URL is not set, falling back to ${LOCAL_FALLBACK}`)
      }
      const folder = declared.migrationsFolder ?? MIGRATIONS_FOLDER
      return DatabaseConfig.of({
        url: Redacted.make(Option.getOrElse(configured, () => LOCAL_FALLBACK)),
        // 'off' leaves the lineage to a deployment job; the layer then refuses
        // to build if the database is behind
        migrations: yield* Config.literals(['apply', 'off'], 'QUALY_MIGRATIONS').pipe(
          Config.withDefault('apply' as const),
        ),
        // relative to the manifest, never to the working directory: the CLI
        // resolves it the same way, and the two must mean one folder
        migrationsFolder: path.isAbsolute(folder)
          ? folder
          : path.resolve(context.manifestDir, folder),
      })
    }),
  )
