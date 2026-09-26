import { Schema } from 'effect'
import { uuidInput } from '@qualy/api-kit/schema'
import type { ResourceStateKind } from '@qualy/ui/resource-state'
import { getApiErrorCode, isBackendUnavailable, isTransportError } from '@qualy/web-i18n/format'

// Why a reading failed, in the terms that decide what the reader can do.
//
// The failure a write gets is about an action ("you may not do this", "that
// did not work, try again"); a reading that failed is about something the
// reader came to look at, and the difference matters for what they do next.
// Something that is not there, or not theirs to see, is not there on the
// second try either; an unreachable or overloaded server is worth another
// try; so is anything else, once.
//
// Which codes mean "the thing itself is not there" is the owner's to say,
// never guessed from a `_NOT_FOUND` suffix: a batch page that fails to find
// one phase inside it is a page about a batch that IS there.

export function loadFailureKind(
  error: unknown,
  missing: readonly string[] = [],
): ResourceStateKind {
  if (isTransportError(error)) return 'offline'
  const code = getApiErrorCode(error)
  if (code === 'SERVICE_UNAVAILABLE' || isBackendUnavailable(error)) return 'unavailable'
  if (code !== undefined && missing.includes(code)) return 'missing'
  if (code === 'ACCESS_DENIED') return 'denied'
  return 'failed'
}

/** whether asking again can bring a different answer */
export const retryHelps = (kind: ResourceStateKind): boolean =>
  kind === 'offline' || kind === 'unavailable' || kind === 'failed'

// the same schema the typed client encodes an id with, so the answer here
// is the answer the client would have given
const recordIdShape = Schema.is(uuidInput)

/**
 * Whether an address segment can name a record at all.
 *
 * An id of the wrong shape never reaches the server: the client refuses to
 * encode it, and the failure it reports is the same kind of failure as a
 * response that would not decode, so nothing downstream can tell the two
 * apart. The owner of the address asks here first and, on a no, says the
 * thing is not there without asking anybody.
 */
export function isRecordId(value: string): boolean {
  return recordIdShape(value)
}

/**
 * Whether what a screen is about has turned out to be absent, from the
 * query that reads it: not there or not the reader's, whenever that is
 * learned; any other failure only while nothing has been read yet. A screen
 * already showing a record keeps showing it through a dropped connection -
 * the record did not go anywhere - but one deleted meanwhile is gone.
 */
export function subjectFailureKind(
  query: { readonly data: unknown; readonly error: unknown; readonly isError: boolean },
  missing: readonly string[] = [],
): ResourceStateKind | null {
  if (!query.isError) return null
  const kind = loadFailureKind(query.error, missing)
  if (kind === 'missing' || kind === 'denied') return kind
  return query.data === undefined ? kind : null
}
