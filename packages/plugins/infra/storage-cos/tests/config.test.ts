import { Cause, ConfigProvider, Effect, Exit, Layer, Redacted } from 'effect'
import { exportJWK, generateKeyPair } from 'jose'
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

// How readers reach the bytes. Direct unless the deployment says otherwise;
// EdgeOne only when the whole of it is there, because half of it would send
// readers straight to the bucket, which is what choosing EdgeOne rules out.
const { privateKey: signingPrivate } = await generateKeyPair('ES256', { extractable: true })
const signingKey = JSON.stringify({ ...(await exportJWK(signingPrivate)), kid: 'download-test' })
const { publicKey: someoneElsesPublic } = await generateKeyPair('ES256', { extractable: true })
const publicHalf = JSON.stringify({ ...(await exportJWK(someoneElsesPublic)), kid: 'k' })

describe('the delivery a deployment chooses', () => {
  const edgeone = {
    ...complete,
    QUALY_STORAGE_COS_DELIVERY: 'edgeone',
    QUALY_STORAGE_COS_EDGEONE_ORIGIN: 'https://files.qualy.example.cn',
    QUALY_STORAGE_COS_EDGEONE_ISSUER: 'https://qualy.example.cn',
    QUALY_STORAGE_COS_EDGEONE_SIGNING_KEY: signingKey,
  }

  it('is direct when nothing says otherwise', async () => {
    const exit = await configured(complete)
    if (!Exit.isSuccess(exit) || !('settings' in exit.value)) throw new Error(said(exit))
    expect(exit.value.settings.delivery).toEqual({ kind: 'direct' })
  })

  it('is EdgeOne, signing with the key it was given, when all of it is there', async () => {
    const exit = await configured(edgeone)
    if (!Exit.isSuccess(exit) || !('settings' in exit.value)) throw new Error(said(exit))
    const delivery = exit.value.settings.delivery
    if (delivery?.kind !== 'edgeone') throw new Error('not edgeone')
    expect(delivery.origin).toBe('https://files.qualy.example.cn')
    expect(delivery.issuer).toBe('https://qualy.example.cn')
    expect(delivery.signing.kid).toBe('download-test')
  })

  it('takes the origin and issuer from the manifest, the key from the environment only', async () => {
    const {
      QUALY_STORAGE_COS_EDGEONE_ORIGIN: _origin,
      QUALY_STORAGE_COS_EDGEONE_ISSUER: _issuer,
      QUALY_STORAGE_COS_DELIVERY: _delivery,
      ...rest
    } = edgeone
    const exit = await configured(rest, {
      delivery: 'edgeone',
      edgeOne: { origin: 'https://files.qualy.example.cn', issuer: 'https://qualy.example.cn' },
    })
    if (!Exit.isSuccess(exit) || !('settings' in exit.value)) throw new Error(said(exit))
    expect(exit.value.settings.delivery?.kind).toBe('edgeone')
  })

  it('refuses EdgeOne missing any part, naming what is missing', async () => {
    for (const name of [
      'QUALY_STORAGE_COS_EDGEONE_ORIGIN',
      'QUALY_STORAGE_COS_EDGEONE_ISSUER',
      'QUALY_STORAGE_COS_EDGEONE_SIGNING_KEY',
    ] as const) {
      const { [name]: _gone, ...rest } = edgeone
      const exit = await configured(rest)
      expect(Exit.isFailure(exit)).toBe(true)
      expect(said(exit)).toContain(name)
    }
  })

  it('refuses EdgeOne beside a download domain for direct delivery', async () => {
    const exit = await configured({
      ...edgeone,
      QUALY_STORAGE_COS_DOWNLOAD_DOMAIN: 'https://files.qualy.example.cn',
    })
    expect(Exit.isFailure(exit)).toBe(true)
    expect(said(exit)).toContain('QUALY_STORAGE_COS_DOWNLOAD_DOMAIN')
  })

  it('refuses a delivery it does not know, and origins that are more than an origin', async () => {
    expect(said(await configured({ ...complete, QUALY_STORAGE_COS_DELIVERY: 'cdn' }))).toContain(
      'QUALY_STORAGE_COS_DELIVERY',
    )
    for (const origin of [
      'http://files.qualy.example.cn',
      'https://files.qualy.example.cn/',
      'https://files.qualy.example.cn/v1',
      'https://user@files.qualy.example.cn',
      'files.qualy.example.cn',
    ]) {
      const exit = await configured({ ...edgeone, QUALY_STORAGE_COS_EDGEONE_ORIGIN: origin })
      expect(Exit.isFailure(exit)).toBe(true)
      expect(said(exit)).toContain('QUALY_STORAGE_COS_EDGEONE_ORIGIN')
    }
  })

  it('refuses a signing key that is not the private half of a named P-256 key, without echoing it', async () => {
    const { kid: _kid, ...unnamed } = JSON.parse(signingKey) as Record<string, unknown>
    for (const key of ['not json', publicHalf, JSON.stringify(unnamed)]) {
      const exit = await configured({ ...edgeone, QUALY_STORAGE_COS_EDGEONE_SIGNING_KEY: key })
      expect(Exit.isFailure(exit)).toBe(true)
      expect(said(exit)).toContain('QUALY_STORAGE_COS_EDGEONE_SIGNING_KEY')
      expect(said(exit)).not.toContain(JSON.parse(signingKey).d as string)
    }
  })
})
