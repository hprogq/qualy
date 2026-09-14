// One release, one name on the reporting platform.
//
// This product's release id and the vendor's version field almost agree: the
// id's alphabet is a subset of what the platform takes, and only the length
// differs - 128 against 60. So the id passes through whenever it fits, which
// in practice is always, and the fallback exists so that "whenever it fits" is
// a statement about this function rather than a hope about deployments.
//
// The fallback is a digest and not a truncation. Two release ids sharing a
// prefix are ordinary here - a date stamp, a branch name, a hash at the end -
// and cutting at sixty characters would map them onto one version, which means
// one set of source maps, and stack traces restored against the wrong build. A
// wrong line number is worse than an unreadable name.
//
// Shared rather than duplicated: the browser stamps reports with this and the
// source map uploader will name its files with it, so the two have to be the
// same function.

const MAX_VERSION = 60

/** FNV-1a, 64 bit. Small, dependency free, and the same answer in every runtime. */
const OFFSET = 0xcbf29ce484222325n
const PRIME = 0x100000001b3n
const MASK = 0xffffffffffffffffn

const digest = (value: string): string => {
  let hash = OFFSET
  for (const byte of new TextEncoder().encode(value)) {
    hash = ((hash ^ BigInt(byte)) * PRIME) & MASK
  }
  return hash.toString(16).padStart(16, '0')
}

/**
 * The version a report carries, from the release the browser is running.
 *
 * `crypto.subtle` would be the obvious digest and is not used: it is async and
 * only exists in a secure context, so a development host reached by its lan
 * address would have had no version at all.
 */
export const rumVersionForRelease = (releaseId: string): string =>
  releaseId.length <= MAX_VERSION ? releaseId : `q-${digest(releaseId)}`
