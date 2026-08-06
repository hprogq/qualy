import { UnderscoreNamingStrategy } from '@mikro-orm/core'

/**
 * How this schema names its constraints.
 *
 * A composite primary key is `pk_<table>`; a single-column one takes the
 * postgres default. That is what the deployed schema does throughout, and it
 * has to be said here because the name comes from one assembly-wide strategy
 * with no per-entity override - so the alternative was a table of exceptions
 * naming tables from several plugins, which is knowledge this plugin has no
 * business holding, or renaming five live constraints to suit the tool.
 *
 * It sits outside the runtime module because the migration generator needs it
 * too, and that runs in the CLI: a schema fact should not drag a connection
 * pool and an effect runtime along with it.
 */
export class QualyNamingStrategy extends UnderscoreNamingStrategy {
  override indexName(
    tableName: string,
    columns: string[],
    type: 'primary' | 'foreign' | 'unique' | 'index' | 'sequence' | 'check' | 'default' | 'trigger',
  ): string {
    if (type === 'primary' && columns.length > 1) return `pk_${tableName}`
    return super.indexName(tableName, columns, type)
  }
}
