import { ConfigProvider, Effect, Layer } from 'effect'
import { exportJWK, generateKeyPair } from 'jose'
import { describe, expect, it } from 'vitest'
import { createDelivery } from '../src/edgeone/delivery.ts'
import { cosBackend } from '../src/server/backend.ts'
import { config, CosStorageConfig } from '../src/server/config.ts'

const DIRECT = 'https://files.qualy.hprogq.com'
const EDGE = 'https://files.qualy.hprogq.cn'
const APP = 'https://qualy.hprogq.cn'
const KEY = 'attachments/0190a7a0-0000-7000-8000-000000000001/0190a7a0-0000-7000-8000-000000000002'
const credentials = {
  QUALY_STORAGE_COS_REGION: 'ap-beijing',
  QUALY_STORAGE_COS_BUCKET: 'qualy-test-1250000000',
  QUALY_STORAGE_COS_SECRET_ID: 'test-id',
  QUALY_STORAGE_COS_SECRET_KEY: 'test-key',
}
const settingsFor = (env: Record<string, string>) =>
  Effect.runPromise(
    CosStorageConfig.pipe(
      Effect.provide(
        config({}, { manifestDir: '/test' }).pipe(
          Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
        ),
      ),
    ),
  )

describe('exclusive public delivery modes', () => {
  it.each([undefined, 'direct'])(
    'keeps the original COS signer usable in %s mode',
    async (mode) => {
      const configured = await settingsFor({
        ...credentials,
        QUALY_STORAGE_COS_DOWNLOAD_DOMAIN: DIRECT,
        ...(mode === undefined ? {} : { QUALY_STORAGE_COS_DELIVERY: mode }),
        // A rollback selects direct delivery without needing to destroy the
        // inactive EdgeOne configuration or its rotation key.
        QUALY_STORAGE_COS_EDGEONE_ORIGIN: EDGE,
        QUALY_STORAGE_COS_EDGEONE_ISSUER: APP,
        QUALY_STORAGE_COS_EDGEONE_SIGNING_KEY: 'unused-in-direct-mode',
      })
      if (!('settings' in configured)) throw new Error('missing COS settings')
      for (const revision of [null, 'recorded-version']) {
        const opened = await Effect.runPromise(
          cosBackend(configured.settings, 'versioned').open(
            { key: KEY, revision },
            { filename: 'proof.pdf', mime: 'application/pdf' },
          ),
        )
        if (opened.kind !== 'redirect') throw new Error('expected redirect')
        const url = new URL(opened.url)
        expect(url.origin).toBe(DIRECT)
        expect(url.pathname).toBe(`/${KEY}`)
        expect(url.searchParams.get('versionId')).toBe(revision ?? 'null')
        expect(url.searchParams.get('response-content-type')).toBe('application/pdf')
        expect(url.searchParams.get('response-content-disposition')).toContain('proof.pdf')
        expect(url.searchParams.get('q-signature')).toMatch(/^[a-f0-9]{40}$/)
        expect(url.searchParams.get('q-url-param-list')).toBe(
          'response-content-disposition;response-content-type;versionid',
        )
        expect(opened.url).not.toContain(EDGE)
      }
    },
  )

  it('signs for EdgeOne, verifies at the edge and never falls back on an upstream refusal', async () => {
    const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true })
    const kid = 'mode-test'
    const configured = await settingsFor({
      ...credentials,
      QUALY_STORAGE_COS_DELIVERY: 'edgeone',
      QUALY_STORAGE_COS_EDGEONE_ORIGIN: EDGE,
      QUALY_STORAGE_COS_EDGEONE_ISSUER: APP,
      QUALY_STORAGE_COS_EDGEONE_SIGNING_KEY: JSON.stringify({
        ...(await exportJWK(privateKey)),
        kid,
      }),
    })
    if (!('settings' in configured)) throw new Error('missing COS settings')
    const opened = await Effect.runPromise(
      cosBackend(configured.settings, 'versioned').open(
        { key: KEY, revision: null },
        { filename: '证明.pdf', mime: 'application/pdf' },
      ),
    )
    if (opened.kind !== 'redirect') throw new Error('expected redirect')
    expect(new URL(opened.url).origin).toBe(EDGE)
    expect(opened.url).not.toContain(DIRECT)
    expect(opened.url).not.toContain('myqcloud.com')
    const keys = JSON.stringify({ keys: [{ ...(await exportJWK(publicKey)), kid, alg: 'ES256' }] })
    let status = 200
    const delivery = createDelivery({
      env: () => ({
        FILES_ORIGIN: EDGE,
        APP_ORIGIN: APP,
        ISSUER: APP,
        VERIFY_KEYS: keys,
        QUALY_EDGE_KEY: 'test-only',
      }),
      now: () => Math.floor(Date.now() / 1000),
      fetch: async (input, init) => {
        const url = new URL(input)
        expect(url.origin).toBe(EDGE)
        expect(url.pathname).toBe(`/${KEY}`)
        expect(url.search).toBe('?versionId=null')
        expect(new Headers(init.headers).get('accept-encoding')).toBe('identity')
        return new Response('original', { status })
      },
    })
    const request = new Request(opened.url, { headers: { origin: APP } })
    const success = await delivery(request)
    expect(success.status).toBe(200)
    expect(await success.text()).toBe('original')
    expect(success.headers.get('content-disposition')).toContain(encodeURIComponent('证明.pdf'))
    status = 403
    const failure = await delivery(request)
    expect(failure.status).toBe(502)
    expect(failure.headers.get('location')).toBeNull()
    expect(await failure.text()).not.toContain(DIRECT)
  })
})
