import path from 'node:path'
import { Config, Context, Effect, Layer, Option, Redacted } from 'effect'
import { LOCAL_FALLBACK, MIGRATIONS_FOLDER, type DatabaseTimeouts } from '../defaults.ts'

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
    /**
     * How long this process waits on the database before a wait is a
     * failure; `DATABASE_TIMEOUTS` unless a caller - a suite asserting what
     * happens past one - says otherwise.
     */
    readonly timeouts?: DatabaseTimeouts | undefined
  }
>()('@qualy/plugin-database/DatabaseConfig') {}

/**
 * What this plugin accepts in `qualy.yml`: nothing.
 *
 * The lineage is the product's, committed at `db/migrations` beside the
 * manifest (the manifest sits at the product root), and there is one product:
 * a key that moved it would let one lock and one image deploy a different
 * history depending on a line of configuration. The connection string is a
 * credential, and a manifest is committed, so it comes from the environment.
 * Everything else this plugin reads comes from there too.
 *
 * Refused by hand rather than by an empty schema: `Schema.Struct({})` lets any
 * object through even with excess properties set to error (docs/notes/effect.md).
 */
const refuseManifestBlock = (manifest: unknown, manifestDir: string): string | undefined => {
  if (manifest === undefined || manifest === null) return undefined
  const keys = typeof manifest === 'object' ? Object.keys(manifest) : [String(manifest)]
  if (keys.length === 0) return undefined
  const hint = keys.includes('url')
    ? ' Set DATABASE_URL in the environment: a manifest is committed, so a connection string in it is a credential in version control.'
    : keys.includes('migrationsFolder')
      ? ` The lineage is always ${path.join(manifestDir, MIGRATIONS_FOLDER)}, the product's own committed history.`
      : ' It reads everything from the environment.'
  return `@qualy/plugin-database takes no configuration in the manifest, and was given config.${keys.join(', config.')}.${hint}`
}

/**
 * The configuration layer the generated runtime module builds.
 *
 * The host used to assemble this, which is why the composition root had to
 * name this plugin. It reads its own environment now, and finds the lineage
 * beside the manifest it was configured from.
 */
export const config = (
  // the block as the manifest parses it, which has to be empty
  manifest: unknown,
  context: { readonly manifestDir: string },
): Layer.Layer<DatabaseConfig, Config.ConfigError> =>
  Layer.effect(
    DatabaseConfig,
    Effect.gen(function* () {
      // a key this plugin does not read is a setting that looks applied and is
      // not, which is the failure the whole config channel exists to prevent
      const refused = refuseManifestBlock(manifest, context.manifestDir)
      if (refused !== undefined) return yield* Effect.die(new Error(refused))
      const environment = yield* Config.String('NODE_ENV').pipe(Config.withDefault('development'))
      // asking whether it was set, rather than comparing the value: the local
      // default is a real connection string somebody may well have configured
      // on purpose, and warning about their own setting is noise
      const configured = yield* Config.option(Config.String('DATABASE_URL'))
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
      return DatabaseConfig.of({
        url: Redacted.make(Option.getOrElse(configured, () => LOCAL_FALLBACK)),
        // 'off' leaves the lineage to a deployment job; the layer then refuses
        // to build if the database is behind
        migrations: yield* Config.Literals(['apply', 'off'], 'QUALY_MIGRATIONS').pipe(
          Config.withDefault('apply' as const),
        ),
        // beside the manifest, never relative to the working directory: the
        // CLI finds it the same way, and the two must mean one folder
        migrationsFolder: path.resolve(context.manifestDir, MIGRATIONS_FOLDER),
      })
    }),
  )
