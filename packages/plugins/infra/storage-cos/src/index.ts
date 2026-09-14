import { Effect, Layer } from 'effect'
import { Plugin } from '@qualy/plugin-kit'
import { Browser } from '@qualy/plugin-kit/browser'
import { ShellPolicy } from '@qualy/api-kit/shell-policy'
import { Storage } from '@qualy/plugin-storage/plugin'
import { Ui } from '@qualy/plugin-ui-registry/plugin'
import { StorageBackends } from '@qualy/plugin-storage/server'
import { cosBackend } from './server/backend.ts'
import { config, CosStorageConfig } from './server/config.ts'
import { cosOrigin } from './server/policy.ts'

// Keeping attachments in a tencent cloud bucket.
//
// Installing this plugin is a deployment decision and nothing more: no
// business plugin depends on it, no screen mentions it, and the attachments it
// wrote stay readable through it even after a deployment starts writing
// somewhere else.

const registration: Layer.Layer<never, never, StorageBackends | CosStorageConfig | ShellPolicy> =
  Layer.effectDiscard(
    Effect.gen(function* () {
      const settings = yield* CosStorageConfig
      const registry = yield* StorageBackends
      yield* registry.register(cosBackend(settings))
      // the browser writes to the bucket itself, so the shell's content
      // security policy has to let it connect there; the origin is this
      // deployment's, known only once the configuration is read
      const policy = yield* ShellPolicy
      yield* policy.register({
        owner: '@qualy/plugin-storage-cos',
        'connect-src': [cosOrigin(settings)],
      })
      yield* Effect.logDebug(`cos storage writing to ${settings.bucket} in ${settings.region}`)
    }),
  )

const plugin = Plugin.define(
  '@qualy/plugin-storage-cos',
  { dependsOn: ['@qualy/plugin-storage'], config },
  Storage.backend({ code: 'cos', uploadDriver: 'cos' }),
  // the browser half announces how to spend this provider's grants
  Browser.module('./client/upload'),
  Plugin.layer(registration),
)

export default plugin
