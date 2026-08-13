import { Effect, Layer } from 'effect'
import { Plugin } from '@qualy/plugin-kit'
import { Api } from '@qualy/api-kit/plugin'
import { Storage } from '@qualy/plugin-storage/plugin'
import { Ui } from '@qualy/plugin-ui-registry/plugin'
import { StorageBackends } from '@qualy/plugin-storage/server'
import { localBackend } from './server/backend.ts'
import { config, LocalStorageConfig } from './server/config.ts'
import { routes } from './server/routes.ts'

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
  // the browser half announces how to spend this provider's grants
  Ui.browser('./client/upload.ts'),
  Plugin.layer(registration),
  // the door the grants point at; a grant is the credential, not a session
  Api.routes(routes),
)

export default plugin
