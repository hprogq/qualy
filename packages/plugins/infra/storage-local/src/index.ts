import { Effect, Layer } from 'effect'
import { Plugin } from '@qualy/plugin-kit'
import { Storage } from '@qualy/plugin-storage/plugin'
import { StorageBackends } from '@qualy/plugin-storage/server'
import { localBackend } from './server/backend.ts'
import { config, LocalStorageConfig } from './server/config.ts'

// Keeping attachments on the machine that serves them.
//
// Declared to the assembly as the backend named "local", registered into the
// registry when this layer builds - which is after core storage's, because
// this plugin depends on it. Nothing here knows what an attachment is; core
// storage does, and it is the same story whichever provider answers.

const registration: Layer.Layer<never, never, StorageBackends | LocalStorageConfig> =
  Layer.effectDiscard(
    Effect.gen(function* () {
      const settings = yield* LocalStorageConfig
      const registry = yield* StorageBackends
      yield* registry.register(localBackend(settings.root))
      yield* Effect.logDebug(`local storage keeping files under ${settings.root}`)
    }),
  )

const plugin = Plugin.define(
  '@qualy/plugin-storage-local',
  { dependsOn: ['@qualy/plugin-storage'], config },
  Storage.backend({ code: 'local', uploadDriver: 'local' }),
  Plugin.layer(registration),
)

export default plugin
