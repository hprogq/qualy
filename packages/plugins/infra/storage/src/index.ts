import { Plugin } from '@qualy/plugin-kit'
import { Db } from '@qualy/plugin-database/plugin'
import { entities } from './db/entities.ts'
import { Storage } from './plugin.ts'
import { config, serviceLayer } from './server/index.ts'

// Storage as a description: two tables, the channel providers declare
// themselves through, and the service that decides what an attachment is.
//
// Where the bytes actually go is not here and must not become here. A
// deployment installs a provider plugin - a disk, a bucket - and this plugin
// never learns what either of them is beyond the code it was told to write to.

const plugin = Plugin.define(
  '@qualy/plugin-storage',
  { dependsOn: ['@qualy/plugin-database'], config },
  Db.entities(entities),
  Storage.provider,
  Plugin.layer(serviceLayer),
)

export default plugin
