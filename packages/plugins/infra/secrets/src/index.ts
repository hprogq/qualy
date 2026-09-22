import { Plugin } from '@qualy/plugin-kit'
import { Db } from '@qualy/plugin-database/plugin'
import { entities } from './db/entities.ts'
import { config, serviceLayer } from './server/index.ts'

// Secrets as a description: one table of encrypted values, and the service
// that writes and reads them under the deployment's master key.

const plugin = Plugin.define(
  '@qualy/plugin-secrets',
  { dependsOn: ['@qualy/plugin-database'], config },
  Db.entities(entities),
  Plugin.layer(serviceLayer),
)

export default plugin
