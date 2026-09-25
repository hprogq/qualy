import { Clock, Effect, Layer, Schedule } from 'effect'
import { Plugin } from '@qualy/plugin-kit'
import { Browser } from '@qualy/plugin-kit/browser'
import { Api } from '@qualy/api-kit/plugin'
import { Assembled } from '@qualy/api-kit/assembled'
import { Storage } from '@qualy/plugin-storage/plugin'
import { StorageBackends } from '@qualy/plugin-storage/server'
import { localBackend, sweepStaging } from './server/backend.ts'
import { config, LocalStorageConfig } from './server/config.ts'
import { storageLocalApiHandlers } from './server/upload.ts'
import { storageLocalApiGroup } from './api.ts'

// Keeping attachments on the machine that serves them.
//
// Declared to the assembly as the backend named "local", registered into the
// registry when this layer builds - which is after core storage's, because
// this plugin depends on it. Nothing here knows what an attachment is; core
// storage does, and it is the same story whichever provider answers.

/** how often the half files a crashed upload left are looked for */
const STAGING_SWEEP_INTERVAL = '15 minutes'

const registration: Layer.Layer<never, never, StorageBackends | LocalStorageConfig | Assembled> =
  Layer.effectDiscard(
    Effect.gen(function* () {
      const settings = yield* LocalStorageConfig
      const registry = yield* StorageBackends
      yield* registry.register(localBackend(settings.root))
      yield* Effect.logDebug(`local storage keeping files under ${settings.root}`)
      // what an upload cut off by a crash left in the staging directory;
      // started at the barrier, so a headless command never sweeps
      const sweep = Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        const removed = yield* Effect.tryPromise(() => sweepStaging(settings.root, now))
        if (removed > 0) {
          yield* Effect.logInfo(`removed ${removed} staging file(s) left by interrupted uploads`)
        }
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning(
            'could not sweep upload staging files; retrying on the next tick',
            cause,
          ),
        ),
      )
      const scope = yield* Effect.scope
      const assembled = yield* Assembled
      yield* assembled.register({
        name: 'storage-local/staging-sweep',
        run: Effect.asVoid(
          Effect.forkIn(Effect.repeat(sweep, Schedule.fixed(STAGING_SWEEP_INTERVAL)), scope),
        ),
      })
    }),
  )

const plugin = Plugin.define(
  '@qualy/plugin-storage-local',
  { dependsOn: ['@qualy/plugin-storage'], config },
  Storage.backend({ code: 'local', uploadDriver: 'local' }),
  // the browser half announces how to spend this provider's grants
  Browser.module('./client/upload'),
  Plugin.layer(registration),
  // the door the grants point at; a grant is the credential, not a session
  Api.group(storageLocalApiGroup, storageLocalApiHandlers),
)

export default plugin
