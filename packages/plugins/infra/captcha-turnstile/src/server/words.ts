import { createHash } from 'node:crypto'

// Two translations Siteverify needs, each a pure function so its edges can be
// tested on their own.

/** Turnstile's own limit on an action: at most 32 of A-Z a-z 0-9 _ - */
const ACTION = /^[A-Za-z0-9_-]{1,32}$/

/**
 * A capability purpose, as a Turnstile action.
 *
 * `auth/login` becomes `auth_login`: a purpose has no `_` of its own, so
 * turning `/` into one cannot make two purposes collide. One too long to fit
 * becomes `q_` and the start of its SHA-256 - never a truncation, which would
 * make two purposes sharing their first 32 characters the same action.
 */
export const actionOfPurpose = (purpose: string): string => {
  const plain = purpose.replaceAll('/', '_')
  if (ACTION.test(plain)) return plain
  return `q_${createHash('sha256').update(purpose).digest('hex').slice(0, 30)}`
}

/**
 * The hostname a browser addressed this deployment by, as Siteverify reports
 * one: lowercase, without a port or a trailing dot. Parsed as a URL rather
 * than split on `:`, which an IPv6 address would break.
 *
 * Undefined when there is no host or it does not parse - which a caller must
 * treat as a mismatch, never as a reason to skip the check.
 */
export const hostnameOfPublicHost = (publicHost: string | undefined): string | undefined => {
  if (publicHost === undefined || publicHost === '') return undefined
  try {
    const hostname = new URL(`https://${publicHost}`).hostname.toLowerCase().replace(/\.$/, '')
    return hostname === '' ? undefined : hostname
  } catch {
    return undefined
  }
}
