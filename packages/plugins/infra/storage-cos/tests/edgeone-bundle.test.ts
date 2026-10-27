import nodeCrypto, { type webcrypto } from 'node:crypto'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import { exportJWK, generateKeyPair } from 'jose'
import { bundleEdgeFunction } from '../src/edgeone/bundle.ts'
import { signGrant } from '../src/edgeone/protocol.ts'
import { derSignatureOf } from '../src/edgeone/webcrypto.ts'

// The script the platform runs, run the way the platform runs it: evaluated
// on its own in a fresh context that offers web globals and nothing of
// node's, registering a fetch listener. A credential the server's signing
// code issued has to come out of it as the object it grants; this is the
// test that the two ends agree in the artifact actually deployed, not only
// in the modules it is built from.

const FILES = 'https://files.qualy.example.cn'
const APP = 'https://qualy.example.cn'

interface FetchEvent {
  readonly request: Request
  respondWith(response: Promise<Response>): void
}

type Crypto = webcrypto.Crypto
type CryptoKey = webcrypto.CryptoKey
type BufferSource = webcrypto.BufferSource

const script = await bundleEdgeFunction()

/**
 * WebCrypto as EdgeOne's runtime was probed to behave: no JWK import (thrown,
 * not rejected), ECDSA signatures in DER, a hash only by name. Signing and
 * verifying go through OpenSSL's own DER, not the bundle's encoder.
 */
const edgeOneCrypto = (): Crypto => {
  const refuse = () => {
    throw new Error('Param Invalid')
  }
  const hashByName = (algorithm: unknown) => {
    const hash = (algorithm as { hash?: unknown }).hash
    if (hash !== undefined && typeof hash !== 'string') refuse()
  }
  const subtle = {
    importKey: (format: string, ...rest: unknown[]) =>
      format === 'jwk'
        ? refuse()
        : (crypto.subtle.importKey as (...a: unknown[]) => unknown)(format, ...rest),
    generateKey: (...args: unknown[]) =>
      (crypto.subtle.generateKey as (...a: unknown[]) => unknown)(...args),
    sign: async (algorithm: unknown, key: CryptoKey, data: BufferSource) => {
      hashByName(algorithm)
      return nodeCrypto.sign('sha256', data as Uint8Array, {
        key: nodeCrypto.KeyObject.from(key),
        dsaEncoding: 'der',
      })
    },
    verify: (algorithm: unknown, key: CryptoKey, signature: BufferSource, data: BufferSource) => {
      hashByName(algorithm)
      return Promise.resolve(
        nodeCrypto.verify(
          'sha256',
          data as Uint8Array,
          { key: nodeCrypto.KeyObject.from(key), dsaEncoding: 'der' },
          signature as Uint8Array,
        ),
      )
    },
  }
  return {
    subtle,
    getRandomValues: (a: never) => crypto.getRandomValues(a),
    randomUUID: () => crypto.randomUUID(),
  } as unknown as Crypto
}

/** the bundled function in a context of its own, with a stand-in for the object read */
const load = (
  env: Record<string, unknown>,
  read: (url: string, init: RequestInit) => Response,
  runtimeCrypto: Crypto = crypto,
) => {
  let listener: ((event: FetchEvent) => void) | undefined
  const context = vm.createContext({
    addEventListener: (type: string, handler: (event: FetchEvent) => void) => {
      if (type === 'fetch') listener = handler
    },
    env,
    fetch: async (url: string, init: RequestInit) => read(url, init),
    Request,
    Response,
    Headers,
    URL,
    ReadableStream,
    TextEncoder,
    TextDecoder,
    crypto: runtimeCrypto,
    CryptoKey,
    atob,
    btoa,
    structuredClone,
    console,
  })
  vm.runInContext(script, context)
  if (listener === undefined) throw new Error('the bundle registered no fetch listener')
  const handler = listener
  return (request: Request) =>
    new Promise<Response>((resolve) =>
      handler({ request, respondWith: (r) => void r.then(resolve) }),
    )
}

describe('the edge function bundle', () => {
  it('is one script with nothing left for the runtime to resolve', () => {
    expect(script).not.toMatch(/^\s*import\s/m)
    expect(script).not.toMatch(/\bimport\s*\(/)
    expect(script).not.toMatch(/\brequire\s*\(/)
    expect(script).not.toMatch(/\bprocess\./)
  })

  it.each([
    ['a runtime that keeps to the standard', () => crypto],
    ["EdgeOne's runtime", edgeOneCrypto],
  ])('delivers what the server signed, and refuses what it did not, on %s', async (_, runtime) => {
    const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true })
    const published = { ...(await exportJWK(publicKey)), kid: 'download-test', alg: 'ES256' }
    const reads: string[] = []
    const deliver = load(
      {
        FILES_ORIGIN: FILES,
        APP_ORIGIN: APP,
        ISSUER: APP,
        VERIFY_KEYS: JSON.stringify({ keys: [published] }),
        QUALY_EDGE_KEY: 'k'.repeat(40),
      },
      (url) => {
        reads.push(url)
        return new Response(new Uint8Array([7, 7, 7]), { status: 200 })
      },
      runtime(),
    )
    const key =
      'attachments/0190a7a0-0000-7000-8000-000000000001/0190a7a0-0000-7000-8000-000000000002'
    const token = await signGrant({
      signing: { key: privateKey, kid: 'download-test' },
      issuer: APP,
      audience: FILES,
      issuedAt: Math.floor(Date.now() / 1000),
      lifetime: 60,
      grant: { key, revision: 'v1', filename: 'a.pdf', mime: 'application/pdf' },
    })

    const answer = await deliver(new Request(`${FILES}/v1/${token}`))
    expect(answer.headers.get('x-qualy-reason')).toBeNull()
    expect(answer.status).toBe(200)
    expect(new Uint8Array(await answer.arrayBuffer())).toEqual(new Uint8Array([7, 7, 7]))
    expect(reads).toEqual([`${FILES}/${key}?versionId=v1`])

    const altered = await deliver(new Request(`${FILES}/v1/${token.slice(0, -4)}AAAA`))
    expect(altered.status).toBe(403)

    // the same signature in the DER a runtime may read natively is still not ES256
    const [head, body, signature] = token.split('.')
    const der = Buffer.from(derSignatureOf(Buffer.from(signature!, 'base64url'))).toString(
      'base64url',
    )
    const reshaped = await deliver(new Request(`${FILES}/v1/${head}.${body}.${der}`))
    expect(reshaped.status).toBe(403)
    expect(reads).toHaveLength(1)
  })
})
