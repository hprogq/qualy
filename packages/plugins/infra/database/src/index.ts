import { Plugin } from '@qualy/plugin-kit'
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
)

export default plugin

// legacy bridge until the descriptor assembler takes over the host: the
// layer and the config channel the generated runtime module composes
export { config, layer } from './server/index.ts'
