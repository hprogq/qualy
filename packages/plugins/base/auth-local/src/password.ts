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

import { normalizePassword } from './rules.ts'

export { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './rules.ts'

/**
 * How many password hashes may be computed at once.
 *
 * argon2 is deliberately expensive, and node-argon2 spends that expense on a
 * libuv threadpool thread - the same four threads that serve every `fs` read
 * this process makes, which is how the browser shell is served and how an
 * attachment is streamed. Unthrottled, four concurrent attempts on the one
 * unauthenticated write endpoint hold 256 MiB and leave nothing to read a
 * file with, so a handful of presses degrades the whole server rather than
 * just the login.
 *
 * Two, so half the pool is always somebody else's. What this costs is
 * latency under load, and a queue is the right answer to a cost that is
 * supposed to be paid slowly.
 */
const MAX_CONCURRENT_HASHES = 2

/**
 * How many sign-in checks may wait for a seat.
 *
 * Anybody may ask for one, and a stream of them that arrives faster than two
 * seats drain grows the line without end: everybody behind it, the person
 * who knows their password included, waits for all of it. Past this many a
 * check is turned away at once, whoever it is about, and the door says to
 * come back. What an administrator or the person themselves sets or checks
 * is counted and slowed elsewhere, and always waits its turn.
 */
export const MAX_WAITING_CHECKS = 64

/** a sign-in check found the line for a seat full */
export class HashQueueFull extends Error {
  override readonly name = 'HashQueueFull'
}

let running = 0
const waiting: (() => void)[] = []

const enter = (signal: AbortSignal | undefined, bounded: boolean): Promise<void> => {
  if (signal?.aborted === true) return Promise.reject(signal.reason)
  if (running < MAX_CONCURRENT_HASHES) {
    running += 1
    return Promise.resolve()
  }
  if (bounded && waiting.length >= MAX_WAITING_CHECKS) return Promise.reject(new HashQueueFull())
  return new Promise<void>((resume, reject) => {
    const seated = () => {
      signal?.removeEventListener('abort', gone)
      resume()
    }
    // whoever stops waiting gives their place up rather than being hashed for later
    const gone = () => {
      const at = waiting.indexOf(seated)
      if (at !== -1) waiting.splice(at, 1)
      reject(signal!.reason)
    }
    waiting.push(seated)
    signal?.addEventListener('abort', gone, { once: true })
  })
}

const leave = (): void => {
  const next = waiting.shift()
  if (next === undefined) running -= 1
  else next()
}

/** one hash at a time per seat, however the call turns out */
const throttled = async <T>(
  work: () => Promise<T>,
  options: { readonly signal?: AbortSignal | undefined; readonly bounded: boolean },
): Promise<T> => {
  await enter(options.signal, options.bounded)
  try {
    // seated after the caller left: the seat goes to the next one unused
    options.signal?.throwIfAborted()
    return await work()
  } finally {
    leave()
  }
}

export interface HashOptions {
  /** the caller gave up; a hash still waiting for a seat is not computed */
  readonly signal?: AbortSignal | undefined
}

export interface CheckOptions extends HashOptions {
  /** a sign-in check, which is turned away when too many already wait */
  readonly bounded?: boolean | undefined
}

// both normalized, so a password typed through another input method still
// meets the digest it was set as
export function hashPassword(password: string, options: HashOptions = {}): Promise<string> {
  return throttled(() => argon2.hash(normalizePassword(password), ARGON2_OPTIONS), {
    signal: options.signal,
    bounded: false,
  })
}

/**
 * Whether the password meets the digest. A digest that cannot be read is a
 * mismatch; a full line or a caller that gave up is the promise's rejection.
 */
export function verifyPassword(
  hash: string,
  password: string,
  options: CheckOptions = {},
): Promise<boolean> {
  return throttled(() => argon2.verify(hash, normalizePassword(password)).catch(() => false), {
    signal: options.signal,
    bounded: options.bounded === true,
  })
}

// verified against unknown identifiers so response timing does not reveal
// whether an account exists; not a credential for anything
export const timingEqualizerHash =
  '$argon2id$v=19$m=65536,p=4,t=3$lXA8UXjMAcQhodLiqlhItg$C8P52o5+kx8/f7dhVFfZiShWvbTGyRvBANgjasbigv4'
