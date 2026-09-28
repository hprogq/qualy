import { Cause, ConfigProvider, Effect, Exit, Layer, Redacted } from 'effect'
import { describe, expect, it } from 'vitest'
import { config, COS_CREDENTIALS_MISSING, CosStorageConfig } from '../src/server/config.ts'

// What a deployment has to say for the bucket. The two secrets decide: with
// neither, the store takes part unconfigured and a laptop or a CI job starts
// against a disk; with either, the rest must be there too.

const configured = (env: Record<string, string>, manifest: unknown = {}) =>
  Effect.runPromiseExit(
    Effect.flatMap(CosStorageConfig, (settings) => Effect.succeed(settings)).pipe(
      Effect.provide(
        config(manifest, { manifestDir: '/somewhere' }).pipe(
          Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
        ),
      ),
    ),
  )

const said = (exit: Awaited<ReturnType<typeof configured>>) =>
  Exit.isFailure(exit) ? Cause.pretty(exit.cause) : ''

const complete = {
  QUALY_STORAGE_COS_SECRET_ID: 'id',
  QUALY_STORAGE_COS_SECRET_KEY: 'key',
  QUALY_STORAGE_COS_BUCKET: 'qualy-files-1301296774',
  QUALY_STORAGE_COS_REGION: 'ap-beijing',
}

describe('the cos configuration', () => {
  it('takes part unconfigured when no credential is given, whatever else is', async () => {
    const exit = await configured({ QUALY_STORAGE_COS_BUCKET: 'qualy-files-1301296774' })
    expect(Exit.isSuccess(exit) && exit.value).toEqual({ refusal: COS_CREDENTIALS_MISSING })
  })

  it('reads blank credentials as none', async () => {
    const exit = await configured({
      QUALY_STORAGE_COS_SECRET_ID: '',
      QUALY_STORAGE_COS_SECRET_KEY: '',
    })
    expect(Exit.isSuccess(exit) && exit.value).toEqual({ refusal: COS_CREDENTIALS_MISSING })
  })

  it('reaches the bucket when everything is given', async () => {
    const exit = await configured(complete)
    if (!Exit.isSuccess(exit) || !('settings' in exit.value)) throw new Error(said(exit))
    expect(exit.value.settings.bucket).toBe('qualy-files-1301296774')
    expect(Redacted.value(exit.value.settings.secretKey)).toBe('key')
  })

  it('takes the bucket and region from the manifest when the environment does not name them', async () => {
    const exit = await configured(
      { QUALY_STORAGE_COS_SECRET_ID: 'id', QUALY_STORAGE_COS_SECRET_KEY: 'key' },
      { bucket: 'from-the-manifest-1301296774', region: 'ap-beijing' },
    )
    if (!Exit.isSuccess(exit) || !('settings' in exit.value)) throw new Error(said(exit))
    expect(exit.value.settings.bucket).toBe('from-the-manifest-1301296774')
  })

  it('refuses half a credential, naming the half that is missing', async () => {
    const { QUALY_STORAGE_COS_SECRET_KEY: _key, ...rest } = complete
    const exit = await configured(rest)
    expect(Exit.isFailure(exit)).toBe(true)
    expect(said(exit)).toContain('QUALY_STORAGE_COS_SECRET_KEY')
  })

  it('refuses credentials without a bucket', async () => {
    const { QUALY_STORAGE_COS_BUCKET: _bucket, ...rest } = complete
    const exit = await configured(rest)
    expect(Exit.isFailure(exit)).toBe(true)
    expect(said(exit)).toContain('QUALY_STORAGE_COS_BUCKET')
    expect(said(exit)).not.toContain('QUALY_STORAGE_COS_SECRET_ID')
  })
})
