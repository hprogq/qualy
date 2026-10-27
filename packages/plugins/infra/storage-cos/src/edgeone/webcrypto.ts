// EdgeOne's WebCrypto, answering as the standard does for the one use the
// delivery has for it: verifying ES256 with a public key out of a JWK Set.
// Probing the runtime found three departures (docs/notes/edgeone-file-delivery.md):
//
// - importKey('jwk', ...) throws "Param Invalid" for any EC key; 'raw' and
//   'spki' import
// - ECDSA verify reads a signature as DER, where the standard and JWS write
//   r || s, so a correct ES256 signature verifies as false
// - an algorithm whose hash is given as { name } throws "Param Invalid"
//
// The bundle injects this module in place of the global `crypto` (./bundle.ts),
// so the token library verifies through it unchanged and nothing global is
// touched. A public EC JWK is imported as the raw point it names and a hash is
// passed by name, which every runtime accepts; an ES256 signature is checked
// to be the 64 bytes of r || s, and re-encoded only where the runtime was seen
// to read DER (a fixed public test vector shows which, once per instance).

import type { webcrypto } from 'node:crypto'

// the names WebCrypto's types go by; the server's type environment has no
// DOM library, and these are erased from the bundle
type Crypto = webcrypto.Crypto
type SubtleCrypto = webcrypto.SubtleCrypto
type CryptoKey = webcrypto.CryptoKey
type BufferSource = webcrypto.BufferSource
type JsonWebKey = webcrypto.JsonWebKey
type AlgorithmIdentifier = webcrypto.AlgorithmIdentifier
type EcdsaParams = webcrypto.EcdsaParams
type EcKeyImportParams = webcrypto.EcKeyImportParams
type KeyFormat = webcrypto.KeyFormat
type KeyUsage = webcrypto.KeyUsage

const native = (): Crypto => globalThis.crypto

const decodeBase64url = (value: string): Uint8Array =>
  Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0))

const bytesOf = (source: BufferSource): Uint8Array =>
  source instanceof ArrayBuffer
    ? new Uint8Array(source)
    : new Uint8Array(source.buffer, source.byteOffset, source.byteLength)

const COORDINATE_BYTES: Readonly<Record<string, number>> = { 'P-256': 32 }

/** a public EC JWK as the uncompressed point raw import takes, or null for anything else */
const pointOf = (jwk: JsonWebKey): Uint8Array | null => {
  if (jwk.kty !== 'EC' || jwk.d !== undefined) return null
  const size = jwk.crv === undefined ? undefined : COORDINATE_BYTES[jwk.crv]
  if (size === undefined || typeof jwk.x !== 'string' || typeof jwk.y !== 'string') return null
  const x = decodeBase64url(jwk.x)
  const y = decodeBase64url(jwk.y)
  if (x.length !== size || y.length !== size) return null
  const point = new Uint8Array(1 + 2 * size)
  point[0] = 4
  point.set(x, 1)
  point.set(y, 1 + size)
  return point
}

/** the hash named by a string, as the runtime takes it */
const byName = <A>(algorithm: A): A => {
  if (typeof algorithm !== 'object' || algorithm === null || !('hash' in algorithm)) {
    return algorithm
  }
  const hash = algorithm.hash
  return typeof hash === 'object' && hash !== null && 'name' in hash
    ? { ...algorithm, hash: hash.name }
    : algorithm
}

/** one DER INTEGER holding an unsigned big-endian value */
const derInteger = (value: Uint8Array): Uint8Array => {
  let start = 0
  while (start < value.length - 1 && value[start] === 0) start++
  const pad = value[start]! >= 0x80 ? 1 : 0
  const length = value.length - start + pad
  const out = new Uint8Array(2 + length)
  out[0] = 0x02
  out[1] = length
  out.set(value.subarray(start), 2 + pad)
  return out
}

/** an ES256 r || s signature as the DER SEQUENCE of r and s */
export const derSignatureOf = (signature: Uint8Array): Uint8Array => {
  const r = derInteger(signature.subarray(0, 32))
  const s = derInteger(signature.subarray(32))
  const out = new Uint8Array(2 + r.length + s.length)
  out[0] = 0x30
  out[1] = r.length + s.length
  out.set(r, 2)
  out.set(s, 2 + r.length)
  return out
}

// A public ES256 test vector: a P-256 point, a message and its r || s
// signature. It holds no secret; it only shows which encoding this runtime's
// verify reads, by the very operation a delivery depends on.
const PROBE_POINT =
  'BOUAheYYT3k4130wAXWuBpl_EtS-SO_aYy46YLDVLBsC0z4bN5MPFvjb9FPQRawoXTorTub8eLy-kC69oJNT6Eo'
const PROBE_MESSAGE = 'qualy edge webcrypto probe'
const PROBE_SIGNATURE =
  'p67GiY9fi1thutx65T3wPZsxxSDc62m0dc3lnl1xO18agJT8kVSqO1mRl8qkylq-oplYRj34ldqgnF2RsK5qpQ'

type Encoding = 'p1363' | 'der'
let encoding: Promise<Encoding> | undefined

/**
 * The signature encoding this runtime's ECDSA verify reads, found once per
 * instance on its first verification. A runtime that reads neither is not
 * one a delivery can verify on: the failure is the service's, not the link's,
 * and it is tried again on the next verification.
 */
const runtimeEncoding = (): Promise<Encoding> => {
  encoding ??= (async (): Promise<Encoding> => {
    const { subtle } = native()
    const key = await subtle.importKey(
      'raw',
      decodeBase64url(PROBE_POINT),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    )
    const algorithm = { name: 'ECDSA', hash: 'SHA-256' }
    const message = new TextEncoder().encode(PROBE_MESSAGE)
    const signature = decodeBase64url(PROBE_SIGNATURE)
    if (await subtle.verify(algorithm, key, signature, message)) return 'p1363'
    if (await subtle.verify(algorithm, key, derSignatureOf(signature), message)) return 'der'
    throw new Error('this runtime verifies ECDSA in neither encoding')
  })().catch((error: unknown) => {
    encoding = undefined
    throw error
  })
  return encoding
}

const isEcdsa = (algorithm: AlgorithmIdentifier | EcdsaParams): boolean =>
  (typeof algorithm === 'string' ? algorithm : algorithm.name).toUpperCase() === 'ECDSA'

const importKey = async (
  format: KeyFormat,
  data: JsonWebKey | BufferSource,
  algorithm: AlgorithmIdentifier | EcKeyImportParams,
  extractable: boolean,
  usages: KeyUsage[],
): Promise<CryptoKey> => {
  const { subtle } = native()
  const point = format === 'jwk' ? pointOf(data as JsonWebKey) : null
  return point === null
    ? subtle.importKey(
        format as 'raw',
        data as BufferSource,
        byName(algorithm),
        extractable,
        usages,
      )
    : subtle.importKey('raw', point, byName(algorithm), extractable, usages)
}

const verify = async (
  algorithm: AlgorithmIdentifier | EcdsaParams,
  key: CryptoKey,
  signature: BufferSource,
  data: BufferSource,
): Promise<boolean> => {
  const { subtle } = native()
  const named = byName(algorithm)
  const curve = (key.algorithm as { readonly namedCurve?: unknown }).namedCurve
  if (!isEcdsa(algorithm) || curve !== 'P-256') return subtle.verify(named, key, signature, data)
  // only the r || s an ES256 signature is, on every runtime: a DER-shaped
  // one would verify on some runtimes alone and is no ES256 signature
  const bytes = bytesOf(signature)
  if (bytes.length !== 64) return false
  return (await runtimeEncoding()) === 'der'
    ? subtle.verify(named, key, derSignatureOf(bytes), data)
    : subtle.verify(named, key, bytes, data)
}

const subtle = new Proxy({} as SubtleCrypto, {
  get: (_target, name) => {
    if (name === 'importKey') return importKey
    if (name === 'verify') return verify
    const own = native().subtle
    const value: unknown = Reflect.get(own, name)
    return typeof value === 'function' ? value.bind(own) : value
  },
})

/** the `crypto` the edge bundle's modules see */
const edgeCrypto: Crypto = {
  get subtle() {
    return subtle
  },
  getRandomValues: (array) => native().getRandomValues(array),
  randomUUID: () => native().randomUUID(),
}

export { edgeCrypto as crypto }
