// What a password here has to be. A leaf with no imports, so the form checks
// what the server checks without carrying the hashing library into a browser.

/** what a password must be at least; the same at the door as where it is set */
export const PASSWORD_MIN_LENGTH = 12
/** argon2 hashes any length; a bound keeps one request from hashing a megabyte */
export const PASSWORD_MAX_LENGTH = 128
