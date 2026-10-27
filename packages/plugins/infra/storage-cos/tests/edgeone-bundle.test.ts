import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import { exportJWK, generateKeyPair } from 'jose'
import { bundleEdgeFunction } from '../src/edgeone/bundle.ts'
import { signGrant } from '../src/edgeone/protocol.ts'

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

const script = await bundleEdgeFunction()

/** the bundled function in a context of its own, with a stand-in for the object read */
const load = (env: Record<string, unknown>, read: (url: string, init: RequestInit) => Response) => {
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
    crypto,
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

  it('delivers what the server signed, and refuses what it did not', async () => {
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
    expect(reads).toHaveLength(1)
  })
})
