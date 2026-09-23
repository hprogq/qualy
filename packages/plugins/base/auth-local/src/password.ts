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

let running = 0
const waiting: (() => void)[] = []

const enter = (): Promise<void> => {
  if (running < MAX_CONCURRENT_HASHES) {
    running += 1
    return Promise.resolve()
  }
  return new Promise<void>((resume) => waiting.push(resume))
}

const leave = (): void => {
  const next = waiting.shift()
  if (next === undefined) running -= 1
  else next()
}

/** one hash at a time per seat, however the call turns out */
const throttled = async <T>(work: () => Promise<T>): Promise<T> => {
  await enter()
  try {
    return await work()
  } finally {
    leave()
  }
}

export function hashPassword(password: string): Promise<string> {
  return throttled(() => argon2.hash(password, ARGON2_OPTIONS))
}

export function verifyPassword(hash: string, password: string): Promise<boolean> {
  return throttled(() => argon2.verify(hash, password)).catch(() => false)
}

// verified against unknown identifiers so response timing does not reveal
// whether an account exists; not a credential for anything
export const timingEqualizerHash =
  '$argon2id$v=19$m=65536,p=4,t=3$lXA8UXjMAcQhodLiqlhItg$C8P52o5+kx8/f7dhVFfZiShWvbTGyRvBANgjasbigv4'
