import { Effect, Layer } from 'effect'
import { Plugin } from '@qualy/plugin-kit'
import { Browser } from '@qualy/plugin-kit/browser'
import { ShellPolicy } from '@qualy/api-kit/shell-policy'
import { Storage } from '@qualy/plugin-storage/plugin'
import { StorageBackends, StorageConfig } from '@qualy/plugin-storage/server'
import { bucketModeOf, cosBackend } from './server/backend.ts'
import { config, CosStorageConfig } from './server/config.ts'
import { cosDownloadOrigin, cosOrigin } from './server/policy.ts'
import { MAX_DURATION, MIN_DURATION } from './server/sts.ts'

// Keeping attachments in a tencent cloud bucket.
//
// Installing this plugin is a deployment decision and nothing more: no
// business plugin depends on it, no screen mentions it, and the attachments it
// wrote stay readable through it even after a deployment starts writing
// somewhere else - as long as the deployment still gives it its credentials.
// Without them it takes part unconfigured and touches no network (config.ts).

const registration: Layer.Layer<
  never,
  never,
  StorageBackends | CosStorageConfig | ShellPolicy | StorageConfig
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const configured = yield* CosStorageConfig
    const registry = yield* StorageBackends
    // A ticket this backend cannot honour is refused here rather than
    // quietly rewritten. The upload grant's lifetime is the product's
    // configuration; the credential's is cam's api, which accepts
    // [15 minutes, 2 hours] and used to be clamped in silence - so a
    // shorter grant left a credential outliving the ticket it was minted
    // for, and a longer one failed uploads near the end of a window the
    // browser had been promised.
    const { limits } = yield* StorageConfig
    const seconds = limits.uploadGrantTtlMinutes * 60
    if (seconds < MIN_DURATION || seconds > MAX_DURATION) {
      return yield* Effect.die(
        new Error(
          `storage.limits.uploadGrantTtlMinutes is ${limits.uploadGrantTtlMinutes}, which this backend cannot mint a credential for: cam accepts ${MIN_DURATION / 60} to ${MAX_DURATION / 60} minutes`,
        ),
      )
    }
    if ('refusal' in configured) return yield* registry.unconfigured('cos', configured.refusal)
    const settings = configured.settings
    // Read once, here. A bucket that keeps versions is safe only because every
    // attachment names the version it completed with; one that has never kept
    // them is safe only because a second write is refused. Switching a bucket
    // between the two while this process runs is a change it will not see, so
    // the order is: switch, then start.
    const mode = yield* bucketModeOf(settings).pipe(
      Effect.mapError(
        (cause) =>
          new Error(
            `could not read whether cos bucket ${settings.bucket} keeps versions (the storage credential needs cos:GetBucketVersioning): ${cause.message}`,
          ),
      ),
      Effect.orDie,
    )
    if (mode === 'suspended') {
      return yield* Effect.die(
        new Error(
          `cos bucket ${settings.bucket} had versioning switched on and then suspended: it neither refuses a second write to a key nor keeps the version an attachment completed with, so attachments there would not be immutable. Switch versioning back on, or use a bucket that never had it`,
        ),
      )
    }
    yield* registry.register(cosBackend(settings, mode))
    // the browser writes to the bucket itself, so the shell's content
    // security policy has to let it connect there; the origin is this
    // deployment's, known only once the configuration is read
    const policy = yield* ShellPolicy
    // Two origins and two directives. The browser WRITES to the bucket
    // endpoint, and it READS from wherever this deployment's download
    // urls point - the same host unless a download domain is named. A
    // redirect delivery is fetched, and an image among the evidence is
    // drawn, so both of those doors have to be open or the shell blocks
    // the product's own files.
    const writesTo = cosOrigin(settings)
    const readsFrom = cosDownloadOrigin(settings)
    yield* policy.register({
      owner: '@qualy/plugin-storage-cos',
      'connect-src': readsFrom === writesTo ? [writesTo] : [writesTo, readsFrom],
      'img-src': [readsFrom],
    })
    yield* Effect.logDebug(
      `cos storage writing to ${settings.bucket} in ${settings.region} (${mode === 'versioned' ? 'versions kept, reads pinned' : 'second writes refused'})`,
    )
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
