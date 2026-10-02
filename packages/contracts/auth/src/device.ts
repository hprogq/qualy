// Whose device somebody is signing in on, as they said on the sign-in page.
//
// Read on both sides: the page writes the choice into a cookie of its own,
// and the server reads it where a sign-in starts - so every way in carries
// it without any of them knowing, a form's post and a redirect's first
// navigation alike. A way in may read it too, for what it keeps at the
// browser: the password form remembers nobody's address on a shared device. It is a preference of the person at this browser, not a
// credential: what the server makes of it is decided server-side, and a
// redirect's session is made from what the flow recorded when it left, never
// from anything the request that comes back carries.

export type SignInDevice = 'personal' | 'shared'

/** the page's cookie holding the choice; not the session's, and never read as one */
export const SIGN_IN_DEVICE_COOKIE = 'qualy_sign_in_device'

/** the HTTPS form: sibling subdomains cannot plant or shadow a __Host cookie */
export const SECURE_SIGN_IN_DEVICE_COOKIE = '__Host-qualy_sign_in_device'

/** how long the page remembers the choice at this browser: half a year */
export const SIGN_IN_DEVICE_MAX_AGE_SECONDS = 15_552_000

/**
 * The choice a request's cookie header states. The host-bound HTTPS cookie
 * wins wherever it is present. Legacy/plain duplicates fail toward shared:
 * a sibling domain may plant a Domain cookie, but must not turn a shared
 * browser into a long-lived personal session by being listed first.
 */
export const deviceOfCookieHeader = (header: string | undefined): SignInDevice => {
  const secure: string[] = []
  const plain: string[] = []
  for (const part of (header ?? '').split(';')) {
    const at = part.indexOf('=')
    if (at < 0) continue
    const name = part.slice(0, at).trim()
    const value = part.slice(at + 1).trim()
    if (name === SECURE_SIGN_IN_DEVICE_COOKIE) secure.push(value)
    else if (name === SIGN_IN_DEVICE_COOKIE) plain.push(value)
  }
  const values = secure.length > 0 ? secure : plain
  return values.includes('shared') ? 'shared' : 'personal'
}
