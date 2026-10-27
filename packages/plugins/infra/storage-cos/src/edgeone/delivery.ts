import { createLocalJWKSet, type JSONWebKeySet, type JWTVerifyGetKey } from 'jose'
import { noticeText, refusalLocaleOf, type Notice } from './messages.ts'
import { DELIVERY_PREFIX, verifyGrant, type DownloadGrant, type Refusal } from './protocol.ts'
import { THUMBNAIL_IMAGE, THUMBNAIL_TYPES } from './thumbnail.ts'

// The attachment door at the edge: what a signed download link opens.
//
// Runs as an EdgeOne edge function on the deployment's file host, bundled
// into one classic script from ./entry.ts (`qualy cos edge-build`). It does
// not decide who may read - the application did that before it signed the
// link. It decides whether the link is one the application signed and still
// holds, and then makes exactly the read the link grants: one object, one
// version, delivered as a download under the granted name and type.
//
// The object is read from this same host, so the read lands in the
// platform's cache and, on a miss, at the private bucket through the
// platform's own grant. The host's rules refuse every other path, so that
// read carries a key only this function holds and the rule lets exactly it
// through. The name, the type and the cross-origin headers are set here, per
// request, after the link has been verified; none of them is cached.
//
// Every refusal is this function's own response - status, a short reason,
// the cross-origin headers a script on the application needs to read it -
// and none of them carries a byte of any object; a failure nobody foresaw is
// answered the same way. What happens after a successful response has
// started is the stream's: an object read that fails halfway ends the
// download, it does not become an error page.

export interface DeliveryEnvironment {
  /** this file host's origin; a request addressed anywhere else is refused */
  readonly FILES_ORIGIN?: unknown
  /** the application origin a script may read a delivery from */
  readonly APP_ORIGIN?: unknown
  /** the issuer a credential must name */
  readonly ISSUER?: unknown
  /** the public keys credentials are verified against, as a JWK Set in JSON */
  readonly VERIFY_KEYS?: unknown
  /** the key the object read carries past the host's rules */
  readonly QUALY_EDGE_KEY?: unknown
}

export type DeliveryRequestInit = RequestInit & {
  readonly eo?: { readonly image: typeof THUMBNAIL_IMAGE }
}

export interface DeliveryDependencies {
  readonly env: () => DeliveryEnvironment
  readonly fetch: (input: string, init: DeliveryRequestInit) => Promise<Response>
  /** unix seconds */
  readonly now: () => number
}

/** the header the object read carries the edge key in */
export const EDGE_KEY_HEADER = 'x-qualy-edge-key'

/** request headers a read may carry on to the object; nothing that identifies the reader */
const CONDITIONAL = ['if-none-match', 'if-modified-since']
/** request headers a script on the application may send */
const ALLOWED_HEADERS = 'Range, If-Range, If-None-Match, If-Modified-Since'
/** object headers worth repeating to the reader */
const REPEATED = ['content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']
/** what a script on the application origin needs to read off a delivery */
const EXPOSED =
  'Content-Disposition, Content-Length, Content-Range, Accept-Ranges, ETag, X-Qualy-Reason'
const ALLOWED_METHODS = 'GET, HEAD, OPTIONS'

/**
 * The one kind of range a delivery serves: a single span of bytes. Any other
 * byte range - several spans, or one that does not parse - is refused before
 * anything is read, rather than quietly answered with the whole file.
 */
const SINGLE_RANGE = /^bytes=(\d+-\d*|-\d+)$/

/** why a request got no file, for whoever diagnoses it; never the url or the token */
export type Reason =
  | 'wrong_host'
  | 'foreign_origin'
  | 'method'
  | 'not_a_delivery'
  | 'unexpected_query'
  | Refusal
  | 'unconfigured'
  | 'invalid_filename'
  | 'upstream_fetch_failed'
  | 'object_missing'
  | 'range'
  | 'upstream_status'
  | 'unexpected_encoding'
  | 'unexpected_type'
  | 'unexpected'

/** each reason's status, and what a person reading it is told */
const REASONS: Readonly<Record<Reason, readonly [status: number, notice: Notice]>> = {
  wrong_host: [404, 'not_found'],
  not_a_delivery: [404, 'invalid'],
  unexpected_query: [400, 'invalid'],
  malformed: [400, 'invalid'],
  invalid: [403, 'invalid'],
  expired: [403, 'expired'],
  foreign_origin: [403, 'unsupported'],
  method: [405, 'unsupported'],
  object_missing: [404, 'missing'],
  range: [416, 'unsupported'],
  // the service failed, not the link: whoever holds it can try again
  unavailable: [502, 'unavailable'],
  unconfigured: [502, 'unavailable'],
  invalid_filename: [502, 'unavailable'],
  upstream_fetch_failed: [502, 'unavailable'],
  upstream_status: [502, 'unavailable'],
  unexpected_encoding: [502, 'unavailable'],
  unexpected_type: [502, 'unavailable'],
  unexpected: [502, 'unavailable'],
}

const publicReason = (reason: Reason): string => {
  const [status] = REASONS[reason]
  if (status >= 500) return 'unavailable'
  if (reason === 'expired' || reason === 'range' || reason === 'method') return reason
  if (reason === 'object_missing') return 'missing'
  if (reason === 'wrong_host' || reason === 'not_a_delivery') return 'not_found'
  if (reason === 'foreign_origin') return 'forbidden'
  return 'invalid'
}

const P256_COORDINATE = /^[A-Za-z0-9_-]{43}$/

/**
 * The configured public keys, or null when they are not keys a delivery can
 * verify with: at least one, each a public P-256 key for ES256 under a kid
 * of its own. A key set that could verify nothing is the service's fault,
 * and is reported as that rather than as every link being invalid.
 */
const verifyKeysOf = (source: string): JSONWebKeySet | null => {
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    return null
  }
  const keys = (parsed as { keys?: unknown } | null)?.keys
  if (!Array.isArray(keys) || keys.length === 0) return null
  const kids = new Set<string>()
  for (const key of keys as Record<string, unknown>[]) {
    if (
      typeof key !== 'object' ||
      key === null ||
      key.kty !== 'EC' ||
      key.crv !== 'P-256' ||
      typeof key.x !== 'string' ||
      !P256_COORDINATE.test(key.x) ||
      typeof key.y !== 'string' ||
      !P256_COORDINATE.test(key.y) ||
      'd' in key ||
      typeof key.kid !== 'string' ||
      key.kid.trim() === '' ||
      kids.has(key.kid) ||
      (key.alg !== undefined && key.alg !== 'ES256') ||
      (key.use !== undefined && key.use !== 'sig') ||
      (key.ext !== undefined && typeof key.ext !== 'boolean') ||
      (key.key_ops !== undefined &&
        (!Array.isArray(key.key_ops) || key.key_ops.length !== 1 || key.key_ops[0] !== 'verify'))
    ) {
      return null
    }
    kids.add(key.kid)
  }
  return parsed as JSONWebKeySet
}

/** whether a range response is of the representation an If-Range names */
const sameRepresentation = (ifRange: string, upstream: Response): boolean => {
  const value = ifRange.trim()
  if (value.startsWith('"')) return upstream.headers.get('etag')?.trim() === value
  // a weak tag never names the bytes; a date names the version modified then
  if (value.startsWith('W/')) return false
  return upstream.headers.get('last-modified')?.trim() === value
}

/** a setting from the function's environment, or null when it is not set */
const setting = (env: DeliveryEnvironment, name: keyof DeliveryEnvironment): string | null => {
  const value = env[name]
  return typeof value === 'string' && value !== '' ? value : null
}

/** a response body nobody will read, let go of rather than left to the platform */
const discard = async (response: Response) => {
  try {
    await response.body?.cancel()
  } catch {
    // letting go failed; the refusal this was for still stands
  }
}

/** a download under the granted name, readable whatever the script */
const dispositionOf = (filename: string): string => {
  const fallback = filename
    .replace(/[^\x20-\x7e]/g, '_')
    .replaceAll('"', "'")
    .replaceAll('\\', '_')
  // throws on half of a surrogate pair; the protocol refuses such names, and
  // the caller turns a throw into a refusal before anything is fetched
  const starred = encodeURIComponent(filename).replace(
    /['()*!]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `attachment; filename="${fallback}"; filename*=UTF-8''${starred}`
}

export const createDelivery = (dependencies: DeliveryDependencies) => {
  // The key set is parsed once per value it is configured with, not per
  // request: the environment does not change under a running function, and
  // importing a key is the costly part of a verification.
  let keysFor:
    | { readonly source: string; readonly keys: Promise<JWTVerifyGetKey | null> }
    | undefined
  const keysOf = (env: DeliveryEnvironment): Promise<JWTVerifyGetKey | null> => {
    const source = setting(env, 'VERIFY_KEYS')
    if (source === null) return Promise.resolve(null)
    if (keysFor?.source !== source) {
      const keys = (async () => {
        const set = verifyKeysOf(source)
        if (set === null) return null
        const resolve = createLocalJWKSet(set)
        // Import every configured key, including rotation keys not yet used
        // by a token. Configuration failures must not look like bad links.
        await Promise.all(set.keys.map((key) => resolve({ alg: 'ES256', kid: key.kid })))
        return resolve
      })().catch(() => null)
      keysFor = { source, keys }
    }
    return keysFor.keys
  }

  /** what a request is answered with when it gets no file, and with what cross-origin headers */
  const responderFor = (request: Request, env: DeliveryEnvironment) => {
    // the application origin, when this request is a script on it
    const app = setting(env, 'APP_ORIGIN')
    const reader = app !== null && request.headers.get('origin') === app ? app : null
    const cors: Record<string, string> =
      reader === null
        ? {}
        : { 'access-control-allow-origin': reader, 'access-control-expose-headers': EXPOSED }

    /** no file: a status, a reason a person or a script can read, and nothing of any object */
    const refuse = (reason: Reason, extra: Record<string, string> = {}) => {
      const [status, notice] = REASONS[reason]
      const locale = refusalLocaleOf(request.headers.get('accept-language'))
      const body = `${noticeText(notice, locale)}\n`
      return new Response(request.method === 'HEAD' ? null : body, {
        status,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'content-language': locale,
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'x-qualy-reason': publicReason(reason),
          vary: 'Origin, Accept-Language',
          ...(status === 405 ? { allow: ALLOWED_METHODS } : {}),
          ...cors,
          ...extra,
        },
      })
    }
    return { reader, cors, refuse }
  }

  const deliver = async (
    request: Request,
    env: DeliveryEnvironment,
    { reader, cors, refuse }: ReturnType<typeof responderFor>,
  ): Promise<Response> => {
    const url = new URL(request.url)
    const method = request.method

    // The function answers on the file host and nowhere else: a platform
    // address it can also be reached at is not a door to the bucket.
    const configuredOrigin = setting(env, 'FILES_ORIGIN')
    if (configuredOrigin === null) return refuse('unconfigured')
    if (url.origin !== configuredOrigin) return refuse('wrong_host')

    // a preflight asks permission to ask; it reads nothing
    if (method === 'OPTIONS') {
      if (reader === null) return refuse('foreign_origin')
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': reader,
          'access-control-allow-methods': 'GET, HEAD',
          'access-control-allow-headers': ALLOWED_HEADERS,
          'access-control-max-age': '600',
          'cache-control': 'no-store',
          vary: 'Origin',
        },
      })
    }
    if (method !== 'GET' && method !== 'HEAD') return refuse('method')

    if (!url.pathname.startsWith(DELIVERY_PREFIX)) return refuse('not_a_delivery')
    const token = url.pathname.slice(DELIVERY_PREFIX.length)
    // the link is the whole instruction; anything beside it would be an
    // attempt to steer the read, and nothing here reads it
    if (url.search !== '') return refuse('unexpected_query')

    const keys = await keysOf(env)
    const issuer = setting(env, 'ISSUER')
    const files = setting(env, 'FILES_ORIGIN')
    const edgeKey = setting(env, 'QUALY_EDGE_KEY')
    if (keys === null || issuer === null || files === null || edgeKey === null) {
      return refuse('unconfigured')
    }

    const verified = await verifyGrant(token, {
      keys,
      issuer,
      audience: files,
      now: dependencies.now(),
    })
    if (!verified.ok) {
      return refuse(verified.refusal)
    }
    const grant: DownloadGrant = verified.grant
    const thumbnail = grant.preset !== undefined

    // everything that needs no network is settled before the read
    let disposition: string
    try {
      disposition = dispositionOf(grant.filename)
    } catch {
      // the protocol refuses a name like this, so the server signed one it should not have
      return refuse('invalid_filename')
    }

    // a range is a GET's alone; any other method reads the whole representation
    const range = method === 'GET' ? (request.headers.get('range')?.trim() ?? null) : null
    // A transformation needs the whole image; never transform a byte range.
    if (thumbnail && range !== null) return refuse('range')
    if (range !== null && /^bytes\s*=/i.test(range) && !SINGLE_RANGE.test(range)) {
      return refuse('range')
    }
    const ranged = range !== null && SINGLE_RANGE.test(range) ? range : null
    const ifRange = ranged === null ? null : request.headers.get('if-range')

    const inner = new URL(`/${grant.key}`, files)
    if (grant.revision !== null) inner.searchParams.set('versionId', grant.revision)
    if (grant.preset !== undefined) inner.searchParams.set('qualy-preview', grant.preset)
    const read = async (withRange: boolean, transform = thumbnail): Promise<Response> => {
      const headers = new Headers({
        [EDGE_KEY_HEADER]: edgeKey,
        // the stored bytes, as stored: an encoded answer would be a different
        // file under the same name
        'accept-encoding': 'identity',
      })
      if (thumbnail) headers.set('host', url.host)
      if (withRange && ranged !== null) {
        headers.set('range', ranged)
        if (ifRange !== null) headers.set('if-range', ifRange)
      }
      // Original validators cannot stand in for a transformed representation.
      for (const name of thumbnail ? [] : CONDITIONAL) {
        const value = request.headers.get(name)
        if (value !== null) headers.set(name, value)
      }
      const target = new URL(inner)
      if (!transform) target.searchParams.delete('qualy-preview')
      return dependencies.fetch(target.toString(), {
        method,
        headers,
        // a redirect is not the object; it is neither followed nor passed on
        redirect: 'manual',
        ...(transform ? { eo: { image: THUMBNAIL_IMAGE } } : {}),
      })
    }

    let upstream: Response
    try {
      upstream = await read(true)
      if (thumbnail && upstream.status === 200) {
        const length = upstream.headers.get('content-length')
        // The native option was observed returning larger images. The
        // signed original size makes this a bounded, streaming fallback.
        if (length === null || !/^\d+$/.test(length) || Number(length) > grant.bytes!) {
          await discard(upstream)
          upstream = await read(false, false)
        }
      }
      // A part is only worth having of the representation the reader holds
      // the rest of. Whether or not the bucket honoured If-Range, a part of
      // another one is replaced by the whole.
      if (upstream.status === 206 && ifRange !== null && !sameRepresentation(ifRange, upstream)) {
        await discard(upstream)
        upstream = await read(false)
      }
    } catch {
      return refuse('upstream_fetch_failed')
    }

    const status = upstream.status
    if (status === 404) {
      await discard(upstream)
      return refuse('object_missing')
    }
    if (status === 416) {
      const extent = upstream.headers.get('content-range')
      await discard(upstream)
      return refuse('range', extent === null ? {} : { 'content-range': extent })
    }
    // only a body that is the object's: a redirect, the bucket refusing the
    // platform, an outage - none of them is a file
    if (status !== 200 && status !== 206 && status !== 304) {
      await discard(upstream)
      return refuse('upstream_status')
    }
    const encoding = upstream.headers.get('content-encoding')?.trim().toLowerCase() ?? ''
    if (encoding !== '' && encoding !== 'identity') {
      await discard(upstream)
      return refuse('unexpected_encoding')
    }
    const type = upstream.headers.get('content-type')?.toLowerCase() ?? ''
    if (type.startsWith('multipart/')) {
      await discard(upstream)
      return refuse('unexpected_type')
    }

    const mediaType = type.split(';', 1)[0]!.trim()
    if (thumbnail && (status !== 200 || !THUMBNAIL_TYPES.has(mediaType))) {
      await discard(upstream)
      return refuse('unexpected_type')
    }

    const answer = new Headers({
      'content-type': thumbnail ? mediaType : grant.mime,
      'content-disposition': thumbnail ? 'inline' : disposition,
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
      vary: 'Origin',
      ...cors,
    })
    for (const name of thumbnail ? ['content-length'] : REPEATED) {
      const value = upstream.headers.get(name)
      if (value !== null) answer.set(name, value)
    }
    if (thumbnail) answer.set('accept-ranges', 'none')
    // whether the object came from the platform's cache or the bucket, for
    // whoever measures it; it says nothing about the object
    const cache = upstream.headers.get('eo-cache-status')
    if (cache !== null) answer.set('x-qualy-cache', cache)
    if (status === 304) {
      await discard(upstream)
      return new Response(null, { status, headers: answer })
    }
    // EdgeOne's HEAD fetch has an empty body stream carrying the original
    // length. Replacing it with null makes the platform emit length 0.
    // Pass that stream through just like GET; the upstream request is still
    // HEAD, so this does not download the object to answer a metadata request.
    return new Response(upstream.body, { status, headers: answer })
  }

  return async (request: Request): Promise<Response> => {
    let env: DeliveryEnvironment = {}
    try {
      env = dependencies.env()
      return await deliver(request, env, responderFor(request, env))
    } catch {
      return responderFor(request, env).refuse('unexpected')
    }
  }
}
