import COS from 'cos-nodejs-sdk-v5'
import { Effect, Exit, Layer, Redacted } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import { shellPolicyLayer, type ShellPolicy } from '@qualy/api-kit/shell-policy'
import type { StorageBackend } from '@qualy/plugin-storage/backend'
import { DEFAULT_LIMITS, StorageBackends, StorageConfig } from '@qualy/plugin-storage/server'
import plugin from '../src/index.ts'
import { CosStorageConfig } from '../src/server/config.ts'

// What the deployment does with the bucket's versioning, read once as it
// starts. A bucket that never kept versions refuses a second write; one that
// keeps them has every read name a version; one that was switched on and
// then suspended does neither, and a deployment that wrote attachments into
// it would be serving whatever was written last.

type Prototype = Record<string, unknown>
const prototype = COS.prototype as unknown as Prototype
const asked = prototype['getBucketVersioning']
afterEach(() => {
  prototype['getBucketVersioning'] = asked
})

const answers = (answer: () => Promise<unknown>) => {
  prototype['getBucketVersioning'] = answer
}

const registration = plugin.features.find((feature) => feature._tag === 'Layer')!
  .layer as Layer.Layer<
  never,
  never,
  StorageBackends | CosStorageConfig | ShellPolicy | StorageConfig
>

/** the backend the registration hands the registry, or how it refused */
const registered = async () => {
  const seen: StorageBackend[] = []
  const exit = await Effect.runPromiseExit(
    Effect.void.pipe(
      Effect.provide(
        registration.pipe(
          Layer.provide(
            Layer.mergeAll(
              shellPolicyLayer,
              Layer.succeed(
                CosStorageConfig,
                CosStorageConfig.of({
                  region: 'ap-beijing',
                  bucket: 'qualy-files-1301296774',
                  secretId: Redacted.make('id'),
                  secretKey: Redacted.make('key'),
                }),
              ),
              Layer.succeed(
                StorageConfig,
                StorageConfig.of({ defaultBackend: 'cos', limits: DEFAULT_LIMITS }),
              ),
              Layer.succeed(
                StorageBackends,
                StorageBackends.of({
                  register: (backend) =>
                    Effect.sync(() => {
                      seen.push(backend)
                    }),
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
  return { exit, backend: seen[0] }
}

const said = (exit: Exit.Exit<unknown, unknown>) => (Exit.isFailure(exit) ? String(exit.cause) : '')

describe('the bucket a deployment starts against', () => {
  it('keeps no revisions for a bucket that never kept versions, and refuses second writes', async () => {
    answers(async () => ({ VersioningConfiguration: {} }))
    const { exit, backend } = await registered()
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(backend?.revisions).toBeUndefined()
  })

  it('names versions for a bucket that keeps them', async () => {
    answers(async () => ({ VersioningConfiguration: { Status: 'Enabled' } }))
    const { exit, backend } = await registered()
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(backend?.revisions).toBeDefined()
  })

  it('refuses a bucket whose versioning was suspended, and says what to do', async () => {
    answers(async () => ({ VersioningConfiguration: { Status: 'Suspended' } }))
    const { exit, backend } = await registered()
    expect(Exit.isFailure(exit)).toBe(true)
    expect(backend).toBeUndefined()
    expect(said(exit)).toContain('suspended')
    expect(said(exit)).toContain('qualy-files-1301296774')
  })

  it('refuses to start when the bucket will not say, naming the permission it needs', async () => {
    answers(async () => {
      throw Object.assign(new Error('AccessDenied'), { statusCode: 403 })
    })
    const { exit, backend } = await registered()
    expect(Exit.isFailure(exit)).toBe(true)
    expect(backend).toBeUndefined()
    expect(said(exit)).toContain('cos:GetBucketVersioning')
  })
})
