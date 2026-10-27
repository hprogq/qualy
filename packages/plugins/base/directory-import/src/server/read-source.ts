import { Effect } from 'effect'
import type { AttachmentRead } from '@qualy/plugin-storage/server'
import { SPREADSHEET_LIMITS } from '@qualy/spreadsheet'

// The server reads the original from its storage provider, never through a
// browser delivery link. Count bytes while streaming and retain the import
// ceiling; the caller owns the read scope and releases it on every exit.

export class SourceUnreadable extends Error {
  readonly reason: 'source-too-large' | 'source-unavailable'
  constructor(reason: 'source-too-large' | 'source-unavailable') {
    super(reason)
    this.name = 'SourceUnreadable'
    this.reason = reason
  }
}

const FETCH_TIMEOUT_MS = 20_000

const collect = async (body: AsyncIterable<Uint8Array>, ceiling: number): Promise<Uint8Array> => {
  const parts: Uint8Array[] = []
  let total = 0
  for await (const part of body) {
    total += part.byteLength
    if (total > ceiling) throw new SourceUnreadable('source-too-large')
    parts.push(part)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.byteLength
  }
  return out
}

/** Original bytes, bounded by the attachment size and the import limit. */
export const readSourceBytes = (
  source: AttachmentRead,
): Effect.Effect<Uint8Array, SourceUnreadable> =>
  Effect.tryPromise({
    try: async () => {
      const declared = Number(source.meta.size)
      const ceiling = Math.min(
        Number.isFinite(declared) && declared > 0 ? declared : SPREADSHEET_LIMITS.maxFileBytes,
        SPREADSHEET_LIMITS.maxFileBytes,
      )
      const bytes = await collect(source.body, ceiling)
      if (BigInt(bytes.byteLength) !== source.meta.size)
        throw new SourceUnreadable('source-unavailable')
      return bytes
    },
    catch: (error) =>
      error instanceof SourceUnreadable ? error : new SourceUnreadable('source-unavailable'),
  }).pipe(
    Effect.timeoutOrElse({
      duration: FETCH_TIMEOUT_MS,
      orElse: () => Effect.fail(new SourceUnreadable('source-unavailable')),
    }),
  )
