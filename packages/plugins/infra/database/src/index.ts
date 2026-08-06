import { Plugin } from '@qualy/plugin-kit'
import { Cli } from '@qualy/plugin-kit/cli'
import { Postgres } from './plugin.ts'
import { layer as serviceLayer } from './server/index.ts'

// The database plugin, as a description: it owns the entities extension
// point and provides the connection. Peers reach the service helpers through
// ./server, the CLI reaches ./assembly and ./migrator - none of them through
// this file.

const plugin = Plugin.define(
  '@qualy/plugin-database',
  Postgres.provider,
  Plugin.layer(serviceLayer),
  Cli.command({
    namespace: 'database',
    aliases: ['db'],
    name: 'migrate',
    summary: 'apply the committed lineage to the configured database',
    context: 'capability',
    load: () => import('./assembly/migrate-command.ts'),
  }),
)

export default plugin

/** the manifest block channel; the assembler calls it with this plugin's block */
export { config } from './server/index.ts'
