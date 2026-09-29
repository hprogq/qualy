// The object store's sdk calls back with plain objects, not Errors: it copies
// an Error it caught into `{ code, name, message }`, and a failed request
// arrives as `{ statusCode, code, message, ... }`. Turned into a string as it
// is, either reads "[object Object]", which is how a stalled upload once told
// the release log nothing about why.

interface Said {
  readonly statusCode?: unknown
  readonly code?: unknown
  readonly message?: unknown
}

/** anything else it hands back, as its fields rather than its type's name */
const shown = (error: unknown): string => {
  if (typeof error !== 'object' || error === null) return String(error)
  try {
    return JSON.stringify(error)
  } catch {
    return Object.keys(error).join(', ') || 'an empty object'
  }
}

/** what the sdk said went wrong, as an Error that keeps what it handed back */
export const cosFailure = (error: unknown): Error => {
  if (error instanceof Error) return error
  const said = (typeof error === 'object' && error !== null ? error : {}) as Said
  const parts = [said.statusCode, said.code, said.message]
    .filter((part) => typeof part === 'string' || typeof part === 'number')
    .map(String)
    .filter((part) => part !== '')
  return new Error(parts.length > 0 ? parts.join(' ') : shown(error), { cause: error })
}
