import { Effect, Layer } from 'effect'
import { Plugin } from '@qualy/plugin-kit'
import { Storage } from '@qualy/plugin-storage/plugin'
import { StorageBackends } from '@qualy/plugin-storage/server'
import { cosBackend } from './server/backend.ts'
import { config, CosStorageConfig } from './server/config.ts'

// Keeping attachments in a tencent cloud bucket.
//
// Installing this plugin is a deployment decision and nothing more: no
// business plugin depends on it, no screen mentions it, and the attachments it
// wrote stay readable through it even after a deployment starts writing
// somewhere else.

const registration: Layer.Layer<never, never, StorageBackends | CosStorageConfig> =
  Layer.effectDiscard(
    Effect.gen(function* () {
      const settings = yield* CosStorageConfig
      const registry = yield* StorageBackends
      yield* registry.register(cosBackend(settings))
      yield* Effect.logDebug(`cos storage writing to ${settings.bucket} in ${settings.region}`)
    }),
  )

const plugin = Plugin.define(
  '@qualy/plugin-storage-cos',
  { dependsOn: ['@qualy/plugin-storage'], config },
  Storage.backend({ code: 'cos', uploadDriver: 'cos' }),
  Plugin.layer(registration),
)

export default plugin
