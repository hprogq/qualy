/**
 * The identifier of the API every plugin contributes to.
 *
 * A plugin implements its own group against a local API holding only that
 * group, so no plugin depends on the aggregate that is generated from every
 * plugin:
 *
 * ```ts
 * const local = HttpApi.make(QUALY_API_ID).add(pingApiGroup)
 * export const pingApiHandlers = HttpApiBuilder.group(local, 'ping', ...)
 * ```
 *
 * The two agree at runtime because the aggregate looks handlers up by group
 * identifier alone, and they agree in the type system because
 * `HttpApiBuilder.group` brands its output with the api id as well: a handler
 * layer built under a different id does not satisfy the aggregate that serves
 * it, so a typo here is a compile error rather than a missing route.
 *
 * The consequence worth knowing is that group identifiers are global. Two
 * plugins claiming the same one would resolve to whichever layer merged last,
 * so the generator rejects duplicates rather than letting one replace the
 * other silently.
 */
export const QUALY_API_ID = 'qualy'

/**
 * Where the business API is mounted.
 *
 * The prefix has to be applied in two places: the local API a plugin
 * implements against, and the aggregate that serves it. `HttpApiBuilder.layer`
 * takes its routes from the group layer and uses the aggregate only to
 * generate the document, so prefixing one and not the other moves the document
 * without moving the routes. Nothing in the type system catches that, which is
 * why there is a test asserting the served paths and the generated document
 * agree.
 *
 * Health probes deliberately live outside it: they answer orchestrators, not
 * API clients, and they stay out of the generated document.
 */
export const QUALY_API_PREFIX = '/api'


// --- pagination ---

// Keyset pagination, in the kit because the alternative is what every list
// started as: a bare `limit 200` that drops the rest in silence. A page
// either says where the next one starts or says there is no next one.
export const DEFAULT_PAGE_SIZE = 50
export const MAX_PAGE_SIZE = 200

// the cursor is opaque to clients on purpose: it encodes the sort key of the
// last row, which is an implementation detail of the query behind it. Encoded
// through the web primitives rather than Buffer, because this is bundled into
// the browser and sort keys are display names, so utf-8 is not optional.
const toBase64Url = (bytes: Uint8Array) => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

const fromBase64Url = (value: string) => {
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/'))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

/**
 * Where a page resumes.
 *
 * The cursor carries a fingerprint of the query it came from, because a cursor
 * is only meaningful against the filter that produced it: resuming a search
 * for A with a cursor from a search for B silently skips or repeats rows, and
 * looks like data loss rather than misuse.
 */
export function encodeQueryCursor(
  queryFingerprint: string,
  key: readonly (string | number)[],
): string {
  return toBase64Url(
    new TextEncoder().encode(JSON.stringify({ v: 1, q: queryFingerprint, k: key })),
  )
}

/**
 * A cursor read without deciding what an unusable one means.
 *
 * Undefined for "no cursor", the key for a usable one, and null for one that
 * cannot be read here. Each runtime turns that null into the refusal its own
 * clients understand; neither may turn it into the first page, which makes
 * "load more" an endless loop of the same rows and reports nothing wrong.
 */
export function readQueryCursor(
  cursor: string | undefined,
  queryFingerprint: string,
  arity: number,
): string[] | undefined | null {
  if (cursor === undefined) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(fromBase64Url(cursor)))
  } catch {
    return null
  }
  const payload = parsed as { v?: unknown; q?: unknown; k?: unknown } | null
  if (!payload || payload.v !== 1 || payload.q !== queryFingerprint) return null
  if (!Array.isArray(payload.k) || payload.k.length !== arity) return null
  if (!payload.k.every((part) => typeof part === 'string')) return null
  return payload.k as string[]
}
