// What a password here has to be. A leaf with no imports, so the form checks
// what the server checks without carrying the hashing library into a browser.

/** what a password must be at least: NIST's floor for a password that is the only factor */
export const PASSWORD_MIN_LENGTH = 15
/** argon2 hashes any length; a bound keeps one request from hashing a megabyte */
export const PASSWORD_MAX_LENGTH = 128

/**
 * A password as it is hashed, compared and measured: one form for what two
 * keyboards or input methods type as different code points for the same
 * characters (a full-width digit, a composed accent).
 */
export const normalizePassword = (password: string) => password.normalize('NFKC')

/** how long a password is, in characters rather than utf-16 units */
export const passwordLength = (password: string) => [...normalizePassword(password)].length
