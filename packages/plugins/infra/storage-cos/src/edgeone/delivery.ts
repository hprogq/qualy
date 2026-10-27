import { createLocalJWKSet, type JSONWebKeySet, type JWTVerifyGetKey } from 'jose'
import { DELIVERY_PREFIX, verifyGrant, type DownloadGrant, type Refusal } from './protocol.ts'

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
// and none of them carries a byte of any object. What happens after a
// successful response has started is the stream's: an object read that
// fails halfway ends the download, it does not become an error page.

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

export interface DeliveryDependencies {
  readonly env: () => DeliveryEnvironment
  readonly fetch: (input: string, init: RequestInit) => Promise<Response>
  /** unix seconds */
  readonly now: () => number
}

/** the header the object read carries the edge key in */
export const EDGE_KEY_HEADER = 'x-qualy-edge-key'

/** request headers a read may carry on to the object; nothing that identifies the reader */
const CONDITIONAL = ['if-none-match', 'if-modified-since']
/** object headers worth repeating to the reader */
const REPEATED = ['content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']
/** what a script on the application origin needs to read off a delivery */
const EXPOSED = 'Content-Disposition, Content-Length, Content-Range, Accept-Ranges, ETag'
const ALLOWED_METHODS = 'GET, HEAD, OPTIONS'

/** one range of bytes, the only kind the bucket serves; anything else is ignored */
const SINGLE_RANGE = /^bytes=(\d+-\d*|-\d+)$/

/** why a request got no file, for whoever diagnoses it; never the url or the token */
export type Reason =
  | 'wrong_host'
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

const WORDS: Record<number, { readonly en: string; readonly zh: string }> = {
  400: { en: 'This is not a download link.', zh: '这不是有效的下载链接' },
  403: {
    en: 'This download link has expired or is not valid. Return to Qualy and download the file again.',
    zh: '下载链接已失效，请返回 Qualy 重新下载',
  },
  404: { en: 'Not found.', zh: '文件不存在' },
  405: { en: 'Method not allowed.', zh: '不支持该请求方式' },
  416: { en: 'Range not satisfiable.', zh: '请求的范围无效' },
  502: { en: 'The file could not be read. Try again later.', zh: '文件暂时无法读取，请稍后重试' },
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
  let keysFor: { readonly source: string; readonly keys: JWTVerifyGetKey | null } | undefined
  const keysOf = (env: DeliveryEnvironment): JWTVerifyGetKey | null => {
    const source = setting(env, 'VERIFY_KEYS')
    if (source === null) return null
    if (keysFor?.source !== source) {
      let keys: JWTVerifyGetKey | null = null
      try {
        keys = createLocalJWKSet(JSON.parse(source) as JSONWebKeySet)
      } catch {
        keys = null
      }
      keysFor = { source, keys }
    }
    return keysFor.keys
  }

  return async (request: Request): Promise<Response> => {
    const env = dependencies.env()
    const url = new URL(request.url)
    const method = request.method
    // the application origin, when this request is a script on it
    const app = setting(env, 'APP_ORIGIN')
    const reader = app !== null && request.headers.get('origin') === app ? app : null

    const cors: Record<string, string> =
      reader === null
        ? { vary: 'Origin' }
        : {
            'access-control-allow-origin': reader,
            'access-control-expose-headers': EXPOSED,
            vary: 'Origin',
          }

    /** no file: a status, a reason a person or a script can read, and nothing of any object */
    const refuse = (status: number, reason: Reason, extra: Record<string, string> = {}) => {
      const words = WORDS[status] ?? WORDS[502]!
      const accept = request.headers.get('accept') ?? ''
      const json = accept.includes('application/json') && !accept.includes('text/html')
      const chinese = /^\s*zh\b/i.test(request.headers.get('accept-language') ?? '')
      const body = json ? JSON.stringify({ code: reason }) : `${chinese ? words.zh : words.en}\n`
      return new Response(method === 'HEAD' ? null : body, {
        status,
        headers: {
          'content-type': json ? 'application/json' : 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'x-qualy-reason': reason,
          ...(status === 405 ? { allow: ALLOWED_METHODS } : {}),
          ...cors,
          ...extra,
        },
      })
    }

    // The function answers on the file host and nowhere else: a platform
    // address it can also be reached at is not a door to the bucket.
    if (url.origin !== setting(env, 'FILES_ORIGIN')) return refuse(404, 'wrong_host')

    // a preflight asks permission to ask; it reads nothing
    if (method === 'OPTIONS') {
      if (reader === null) return refuse(403, 'invalid')
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': reader,
          'access-control-allow-methods': 'GET, HEAD',
          'access-control-allow-headers': 'Range, If-None-Match, If-Modified-Since',
          'access-control-max-age': '600',
          'cache-control': 'no-store',
          vary: 'Origin',
        },
      })
    }
    if (method !== 'GET' && method !== 'HEAD') return refuse(405, 'method')

    if (!url.pathname.startsWith(DELIVERY_PREFIX)) return refuse(404, 'not_a_delivery')
    const token = url.pathname.slice(DELIVERY_PREFIX.length)
    // the link is the whole instruction; anything beside it would be an
    // attempt to steer the read, and nothing here reads it
    if (url.search !== '') return refuse(400, 'unexpected_query')

    const keys = keysOf(env)
    const issuer = setting(env, 'ISSUER')
    const files = setting(env, 'FILES_ORIGIN')
    const edgeKey = setting(env, 'QUALY_EDGE_KEY')
    if (keys === null || issuer === null || files === null || edgeKey === null) {
      return refuse(502, 'unconfigured')
    }

    const verified = await verifyGrant(token, {
      keys,
      issuer,
      audience: files,
      now: dependencies.now(),
    })
    if (!verified.ok) {
      return refuse(verified.refusal === 'malformed' ? 400 : 403, verified.refusal)
    }
    const grant: DownloadGrant = verified.grant

    // everything that needs no network is settled before the read
    let disposition: string
    try {
      disposition = dispositionOf(grant.filename)
    } catch {
      return refuse(400, 'invalid_filename')
    }

    const inner = new URL(`/${grant.key}`, files)
    if (grant.revision !== null) inner.searchParams.set('versionId', grant.revision)
    const headers = new Headers({
      [EDGE_KEY_HEADER]: edgeKey,
      // the stored bytes, as stored: an encoded answer would be a different
      // file under the same name
      'accept-encoding': 'identity',
    })
    const range = request.headers.get('range')
    if (range !== null && SINGLE_RANGE.test(range.trim())) headers.set('range', range.trim())
    for (const name of CONDITIONAL) {
      const value = request.headers.get(name)
      if (value !== null) headers.set(name, value)
    }

    let upstream: Response
    try {
      upstream = await dependencies.fetch(inner.toString(), {
        method,
        headers,
        // a redirect is not the object; it is neither followed nor passed on
        redirect: 'manual',
      })
    } catch {
      return refuse(502, 'upstream_fetch_failed')
    }

    const status = upstream.status
    if (status === 404) {
      await discard(upstream)
      return refuse(404, 'object_missing')
    }
    if (status === 416) {
      const extent = upstream.headers.get('content-range')
      await discard(upstream)
      return refuse(416, 'range', extent === null ? {} : { 'content-range': extent })
    }
    // only a body that is the object's: a redirect, the bucket refusing the
    // platform, an outage - none of them is a file
    if (status !== 200 && status !== 206 && status !== 304) {
      await discard(upstream)
      return refuse(502, 'upstream_status', { 'x-qualy-upstream': String(status) })
    }
    const encoding = upstream.headers.get('content-encoding')?.trim().toLowerCase() ?? ''
    if (encoding !== '' && encoding !== 'identity') {
      await discard(upstream)
      return refuse(502, 'unexpected_encoding')
    }
    const type = upstream.headers.get('content-type')?.toLowerCase() ?? ''
    if (type.startsWith('multipart/')) {
      await discard(upstream)
      return refuse(502, 'unexpected_type')
    }

    const answer = new Headers({
      'content-type': grant.mime,
      'content-disposition': disposition,
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
      ...cors,
    })
    for (const name of REPEATED) {
      const value = upstream.headers.get(name)
      if (value !== null) answer.set(name, value)
    }
    // whether the object came from the platform's cache or the bucket, for
    // whoever measures it; it says nothing about the object
    const cache = upstream.headers.get('eo-cache-status')
    if (cache !== null) answer.set('x-qualy-cache', cache)
    if (method === 'HEAD' || status === 304) {
      await discard(upstream)
      return new Response(null, { status, headers: answer })
    }
    return new Response(upstream.body, { status, headers: answer })
  }
}
