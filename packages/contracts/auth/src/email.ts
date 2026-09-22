// A person's email address, in the one spelling it is stored and compared in.
//
// Shared by whoever writes the address (the directory) and whoever looks a
// person up by it (the password door), so the two can never disagree about
// whether `Ada@School.edu` and `ada@school.edu` are the same person. Zero
// dependencies: a form validates with it too.

/** the longest address a mail system will route (RFC 5321 path limit) */
export const EMAIL_MAX_LENGTH = 254

// Deliberately plain: one `@`, no whitespace, a dotted domain. Addresses a
// school hands out look like this; anything cleverer only lets typos through
// or refuses addresses that work.
const SHAPE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/

/**
 * Trimmed and lower-cased, or null when it cannot be an address.
 *
 * Lower-casing the local part is not what the RFC promises, and it is what
 * every provider people here actually use does; one spelling per person is
 * worth more than preserving a distinction nobody relies on.
 */
export const normalizeEmail = (raw: string): string | null => {
  const value = raw.trim().toLowerCase()
  if (value.length === 0 || value.length > EMAIL_MAX_LENGTH) return null
  return SHAPE.test(value) ? value : null
}
