import argon2 from 'argon2'

// argon2id with explicit parameters (rationale and timing measurement in
// docs/notes/auth-security.md); the seed resolves this module through the
// host so argon2 stays a dependency of this package alone
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
} as const

export const PASSWORD_MIN_LENGTH = 12

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS)
}

export function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password).catch(() => false)
}

// verified against unknown identifiers so response timing does not reveal
// whether an account exists; not a credential for anything
export const timingEqualizerHash =
  '$argon2id$v=19$m=65536,p=4,t=3$lXA8UXjMAcQhodLiqlhItg$C8P52o5+kx8/f7dhVFfZiShWvbTGyRvBANgjasbigv4'

// login names are case-insensitive ascii: trimmed, lowercased and restricted
// to a conservative charset; returns null when the input cannot be a valid
// identifier (callers treat that as invalid credentials)
export function normalizeLocalIdentifier(raw: string): string | null {
  const value = raw.trim().toLowerCase()
  if (value.length < 2 || value.length > 64) return null
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(value)) return null
  return value
}
