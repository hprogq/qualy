import { Effect, Layer, Redacted } from 'effect'
import { describe, expect, it } from 'vitest'
import { ShellPolicy, shellPolicyLayer } from '@qualy/api-kit/shell-policy'
import { StorageBackends } from '@qualy/plugin-storage/server'
import plugin from '../src/index.ts'
import { CosStorageConfig } from '../src/server/config.ts'

// What this plugin tells the shell about itself: the one origin a browser
// reaches on its behalf. Read off the descriptor's own layer, built over
// stubs - no bucket, no database - because the registration is a fact about
// configuration, not about the store.

const settings = CosStorageConfig.of({
  region: 'ap-beijing',
  bucket: 'qualy-files-1301296774',
  secretId: Redacted.make('id'),
  secretKey: Redacted.make('key'),
})

/** the bare layer the descriptor carries, which is where the registration lives */
const registration = plugin.features.find((feature) => feature._tag === 'Layer')!
  .layer as Layer.Layer<never, never, StorageBackends | CosStorageConfig | ShellPolicy>

describe('the shell policy contribution', () => {
  it('registers the bucket endpoint under connect-src, and nothing else', async () => {
    const entries = await Effect.runPromise(
      Effect.flatMap(ShellPolicy, (policy) => policy.entries).pipe(
        Effect.provide(
          registration.pipe(
            Layer.provideMerge(
              Layer.mergeAll(
                shellPolicyLayer,
                Layer.succeed(CosStorageConfig, settings),
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
    expect(entries).toEqual([
      {
        owner: '@qualy/plugin-storage-cos',
        'connect-src': ['https://qualy-files-1301296774.cos.ap-beijing.myqcloud.com'],
      },
    ])
  })
})
