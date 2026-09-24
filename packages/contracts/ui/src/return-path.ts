// Where somebody is sent back to once they have signed in, as one rule for
// the server that follows it after a round trip elsewhere and the browser
// that follows it after a password. A leaf with no imports.

/** the longest address kept to return to; the flow row stores it whole */
export const RETURN_PATH_MAX_LENGTH = 2048

/**
 * A path inside this application, or nothing.
 *
 * Where somebody asked to be returned to arrives from the outside - an
 * address bar, a query string - so an absolute url, a protocol-relative one,
 * a backslash a browser reads as a slash, or anything else that is not a
 * path here is dropped rather than followed: the navigation happens under
 * this application's own name. Resolved against a sentinel origin, so what
 * is judged is what a browser would actually go to.
 */
export const safeReturnPath = (path: string | null | undefined): string | undefined => {
  if (path == null || !path.startsWith('/') || path.startsWith('//')) return undefined
  const sentinel = 'https://qualy.invalid'
  let target: URL
  try {
    target = new URL(path, sentinel)
  } catch {
    return undefined
  }
  if (target.origin !== sentinel) return undefined
  const inside = `${target.pathname}${target.search}${target.hash}`
  return inside.length > RETURN_PATH_MAX_LENGTH ? undefined : inside
}
