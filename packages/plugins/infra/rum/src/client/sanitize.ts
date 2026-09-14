// Turning an address into something safe to send away.
//
// The rule is this product's, not any vendor's: a reporting platform should
// learn WHICH SCREEN failed and never WHICH ROW.
// `/assessment/batches/019a.../review` names a batch;
// `/assessment/batches/:batchId/review` names a screen, and the second groups
// usefully anyway - a thousand distinct urls are a thousand issues nobody can
// read.
//
// This runs when the manifest has not loaded yet, or on an address no page
// pattern matched. When a page pattern IS known its route template is used
// instead and none of the guessing below happens.

/** `019a2f3e-...`, in any case */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** what a path segment may keep: it says what it is, not who it is */
const PLAIN = /^[A-Za-z0-9._~-]+$/

/**
 * Long enough to be an identifier rather than a word.
 *
 * Sixteen because that is past every segment this product's routes actually
 * use - `batches`, `review`, `user-types`, `role-assignments` - and short of
 * nothing a generated id would be.
 */
const OPAQUE_LENGTH = 16

const decoded = (segment: string): string => {
  try {
    return decodeURIComponent(segment)
  } catch {
    // a malformed escape is itself a reason not to pass the segment on
    return ''
  }
}

/** whether a segment names a thing (kept) or an instance of one (masked) */
const identifies = (segment: string): boolean => {
  if (UUID.test(segment)) return true
  // a run of digits long enough to be a student number, an order, a row id
  if (/^\d{4,}$/.test(segment)) return true
  const plain = decoded(segment)
  // anything that had to be escaped, or that carries a character a route
  // never would: a name, an address, something somebody typed
  if (plain !== segment || !PLAIN.test(plain)) return true
  return plain.length >= OPAQUE_LENGTH
}

/**
 * The path with its instances masked.
 *
 * Query and hash are not sanitized because they are not carried at all:
 * everything this product puts in one is either an id or something a viewer
 * typed.
 */
export const sanitizePath = (pathname: string): string => {
  const masked = pathname
    .split('/')
    .map((segment) => (segment === '' ? segment : identifies(segment) ? ':id' : segment))
    .join('/')
  return masked === '' ? '/' : masked
}

/**
 * The same, from a whole address.
 *
 * The origin goes with the query and the hash: every page this runs on is
 * served from this application's own origin, so it distinguishes nothing, and
 * an origin is one more thing that could carry a token in a subdomain.
 */
export const sanitizeUrl = (href: string): string => {
  const cut = href.replace(/[?#].*$/, '')
  const withoutOrigin = cut.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '')
  return sanitizePath(withoutOrigin === '' ? '/' : withoutOrigin)
}
