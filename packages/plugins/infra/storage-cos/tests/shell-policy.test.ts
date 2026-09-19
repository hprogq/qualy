import { Effect, Layer, Redacted } from 'effect'
import { describe, expect, it } from 'vitest'
import { ShellPolicy, shellPolicyLayer } from '@qualy/api-kit/shell-policy'
import { StorageBackends } from '@qualy/plugin-storage/server'
import plugin from '../src/index.ts'
import { CosStorageConfig } from '../src/server/config.ts'

// What this plugin tells the shell about itself: the origins a browser
// reaches on its behalf. Read off the descriptor's own layer, built over
// stubs - no bucket, no database - because the registration is a fact about
// configuration, not about the store.
//
// Two of them, and they are not the same question. The browser WRITES to the
// bucket endpoint, and it READS from wherever this deployment's download
// urls point: a signed redirect is fetched by the browser itself, and an
// image among the evidence is drawn. Registering only the first blocked the
// product's own files with its own policy.

const settings = CosStorageConfig.of({
  region: 'ap-beijing',
  bucket: 'qualy-files-1301296774',
  secretId: Redacted.make('id'),
  secretKey: Redacted.make('key'),
})

/** the bare layer the descriptor carries, which is where the registration lives */
const registration = plugin.features.find((feature) => feature._tag === 'Layer')!
  .layer as Layer.Layer<never, never, StorageBackends | CosStorageConfig | ShellPolicy>

const entriesFor = (config: typeof settings) =>
  Effect.runPromise(
      Effect.flatMap(ShellPolicy, (policy) => policy.entries).pipe(
        Effect.provide(
          registration.pipe(
            Layer.provideMerge(
              Layer.mergeAll(
                shellPolicyLayer,
                Layer.succeed(CosStorageConfig, config),
                Layer.succeed(
                  StorageBackends,
                  StorageBackends.of({
                    register: () => Effect.void,
                    resolve: () => Effect.die('not asked'),
                    forWrite: Effect.die('not asked'),
                    installed: Effect.succeed([]),
                  }),
                ),
              ),
            ),
          ),
        ),
      ),
  )

describe('the shell policy contribution', () => {
  const bucket = 'https://qualy-files-1301296774.cos.ap-beijing.myqcloud.com'

  it('names the bucket for both writing and reading when nothing else is set', async () => {
    expect(await entriesFor(settings)).toEqual([
      {
        owner: '@qualy/plugin-storage-cos',
        'connect-src': [bucket],
        // an image among the evidence is drawn, not fetched
        'img-src': [bucket],
      },
    ])
  })

  it('names the download domain as well, when a deployment has one', async () => {
    const entries = await entriesFor(
      CosStorageConfig.of({ ...settings, downloadDomain: 'files.qualy.example' }),
    )
    expect(entries).toEqual([
      {
        owner: '@qualy/plugin-storage-cos',
        'connect-src': [bucket, 'https://files.qualy.example'],
        'img-src': ['https://files.qualy.example'],
      },
    ])
  })
})
