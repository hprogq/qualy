import { Context, Redacted } from 'effect'

/**
 * What the database needs to know, provided by whoever assembles the
 * application rather than read from the environment here.
 *
 * The plugin does not know where the assembly keeps its migrations, and
 * guessing from the working directory is how a process behaves differently
 * depending on where it was started.
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
  }
>()('@qualy/plugin-database/DatabaseConfig') {}
