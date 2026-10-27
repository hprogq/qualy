import { jwtVerify, SignJWT, type CryptoKey, type JWTVerifyGetKey } from 'jose'

// The download credential an EdgeOne delivery carries, read the same way at
// both ends.
//
// The server signs one after it has decided the reader may have the file; the
// edge function verifies it before it reads a single byte. Both import this
// module - the edge function is bundled from it - so the token is written and
// read by one implementation, and the rules below are not restated anywhere.
//
// It is a JWT signed as a JWS (ES256, compact serialization): the claims say
// who issued it, which file service it is for, when it was issued and until
// when it holds, and which object, version, name and type it grants. The
// signature covers all of it; nothing the reader adds beside the token is
// read. It is signed, not encrypted: whoever holds the url can read what it
// grants, and can use it until it expires.
//
// The profile is narrower than JWT allows on purpose. One algorithm, one
// token type of its own, a fixed set of header and payload members, and a
// lifetime ceiling the verifier enforces whatever the issuer wrote.

/** the token type only a download credential carries */
export const TOKEN_TYPE = 'qualy-download+jwt'
/** the one algorithm a credential is signed with and verified against */
export const ALGORITHM = 'ES256'
/** the longest a credential may hold, from issue to expiry, whatever it says */
export const MAX_LIFETIME_SECONDS = 300
/** how far apart the two ends' clocks may be */
export const CLOCK_TOLERANCE_SECONDS = 3
/** a token longer than this is not one this protocol issues */
export const MAX_TOKEN_LENGTH = 4096
/** where a credential is presented: `${origin}${DELIVERY_PREFIX}${token}` */
export const DELIVERY_PREFIX = '/v1/'

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
/** objectKeyOf in core storage: attachments/<tenant>/<attachment> */
export const OBJECT_KEY = new RegExp(`^attachments/${UUID}/${UUID}$`)
/** the version ids cos hands out, and "null", its name for the one before versioning */
export const REVISION = /^[A-Za-z0-9+/=._-]{1,128}$/
/**
 * What a delivery is ever willing to say the bytes are: servedTypeOf in core
 * storage, whose answers all fall in this set (a test holds the two together).
 */
export const DELIVERABLE_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'application/pdf',
  'application/octet-stream',
])

const MAX_FILENAME = 255
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/
// a control character could end a header; matching them is the point
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/

/** one object, as a delivery grants it */
export interface DownloadGrant {
  readonly key: string
  /** the version to read: null reads the object without naming one */
  readonly revision: string | null
  readonly filename: string
  readonly mime: string
}

/** a file name a delivery may carry: well-formed text, nothing that ends a header, bounded */
export const filenameAccepted = (name: unknown): name is string =>
  typeof name === 'string' &&
  name.length > 0 &&
  name.length <= MAX_FILENAME &&
  !LONE_SURROGATE.test(name) &&
  !CONTROL.test(name)

/**
 * The name a stored file is delivered under.
 *
 * The name an uploader gave is kept as given; it is only made deliverable
 * here: half of a surrogate pair cannot be percent-encoded into a header,
 * and a control character could end one, so both are replaced, and the
 * whole is cut to the length a header carries.
 */
export const deliverableFilename = (name: string): string => {
  const fixed = name
    .replace(new RegExp(LONE_SURROGATE.source, 'g'), '�')
    .replace(new RegExp(CONTROL.source, 'g'), '_')
  const cut = fixed.slice(0, MAX_FILENAME).replace(/[\ud800-\udbff]$/, '')
  return cut === '' ? 'file' : cut
}

/** whether a grant names an object, a version, a name and a type this protocol delivers */
export const grantAccepted = (grant: DownloadGrant): boolean =>
  OBJECT_KEY.test(grant.key) &&
  (grant.revision === null || REVISION.test(grant.revision)) &&
  filenameAccepted(grant.filename) &&
  DELIVERABLE_TYPES.has(grant.mime)

export interface SigningKey {
  /** the private half of the key pair, imported for ES256 */
  readonly key: CryptoKey
  /** the name its public half is published under */
  readonly kid: string
}

/** A credential for one grant, from `issuedAt` (unix seconds) for `lifetime` seconds. */
export const signGrant = (input: {
  readonly signing: SigningKey
  readonly issuer: string
  readonly audience: string
  readonly issuedAt: number
  readonly lifetime: number
  readonly grant: DownloadGrant
}): Promise<string> => {
  const { grant } = input
  if (!grantAccepted(grant)) {
    return Promise.reject(new Error('the grant is not one this protocol delivers'))
  }
  if (!Number.isInteger(input.lifetime) || input.lifetime <= 0) {
    return Promise.reject(new Error('a credential lifetime is a positive number of seconds'))
  }
  if (input.lifetime > MAX_LIFETIME_SECONDS) {
    return Promise.reject(new Error(`a credential holds at most ${MAX_LIFETIME_SECONDS} seconds`))
  }
  return new SignJWT({ k: grant.key, r: grant.revision, f: grant.filename, m: grant.mime })
    .setProtectedHeader({ alg: ALGORITHM, typ: TOKEN_TYPE, kid: input.signing.kid })
    .setIssuer(input.issuer)
    .setAudience(input.audience)
    .setIssuedAt(input.issuedAt)
    .setExpirationTime(input.issuedAt + input.lifetime)
    .sign(input.signing.key)
}

/** why a credential was not honoured, as far as a reader may be told */
export type Refusal =
  /** not a token of this shape at all */
  | 'malformed'
  /** a token whose signature, issuer, audience or contents do not hold */
  | 'invalid'
  /** a token that was genuine and has run out */
  | 'expired'

export type Verification =
  | { readonly ok: true; readonly grant: DownloadGrant }
  | { readonly ok: false; readonly refusal: Refusal }

const COMPACT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
const HEADER_MEMBERS = ['alg', 'kid', 'typ']
const PAYLOAD_MEMBERS = ['aud', 'exp', 'f', 'iat', 'iss', 'k', 'm', 'r']

const sameMembers = (value: object, members: readonly string[]) => {
  const own = Object.keys(value).sort()
  return own.length === members.length && own.every((name, at) => name === members[at])
}

/**
 * What a credential grants, or why it grants nothing.
 *
 * `keys` resolves the public key a token names by `kid` among the keys this
 * end was configured with; nothing a token says sends it looking elsewhere.
 * The signature is checked over the token as it arrived, before any of its
 * contents are believed.
 */
export const verifyGrant = async (
  token: string,
  expected: {
    readonly keys: JWTVerifyGetKey
    readonly issuer: string
    readonly audience: string
    /** unix seconds */
    readonly now: number
  },
): Promise<Verification> => {
  if (token.length > MAX_TOKEN_LENGTH || !COMPACT.test(token)) {
    return { ok: false, refusal: 'malformed' }
  }
  let verified: Awaited<ReturnType<typeof jwtVerify>>
  try {
    verified = await jwtVerify(token, expected.keys, {
      algorithms: [ALGORITHM],
      typ: TOKEN_TYPE,
      issuer: expected.issuer,
      audience: expected.audience,
      requiredClaims: ['iss', 'aud', 'iat', 'exp'],
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      maxTokenAge: MAX_LIFETIME_SECONDS,
      currentDate: new Date(expected.now * 1000),
    })
  } catch (error) {
    // the library says which check failed; only "genuine and run out" is
    // worth telling apart, and only once the signature has held
    const code = (error as { code?: unknown }).code
    return { ok: false, refusal: code === 'ERR_JWT_EXPIRED' ? 'expired' : 'invalid' }
  }
  const { payload, protectedHeader } = verified
  if (!sameMembers(protectedHeader, HEADER_MEMBERS) || !sameMembers(payload, PAYLOAD_MEMBERS)) {
    return { ok: false, refusal: 'invalid' }
  }
  const { iat, exp, k, r, f, m } = payload as Record<string, unknown>
  if (
    !Number.isInteger(iat) ||
    !Number.isInteger(exp) ||
    (exp as number) <= (iat as number) ||
    (exp as number) - (iat as number) > MAX_LIFETIME_SECONDS ||
    typeof k !== 'string' ||
    (r !== null && typeof r !== 'string') ||
    typeof f !== 'string' ||
    typeof m !== 'string'
  ) {
    return { ok: false, refusal: 'invalid' }
  }
  const grant: DownloadGrant = { key: k, revision: r as string | null, filename: f, mime: m }
  return grantAccepted(grant) ? { ok: true, grant } : { ok: false, refusal: 'invalid' }
}
