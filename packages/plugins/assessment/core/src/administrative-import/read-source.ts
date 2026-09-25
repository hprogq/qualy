import { Effect } from 'effect'
import type { AttachmentOpen } from '@qualy/plugin-storage/server'
import { ADMIN_IMPORT_LIMITS } from './workbook.ts'

// Getting the workbook's bytes back, whichever way the store hands them out.
//
// The server re-reads the file rather than trusting rows the browser parsed
// and posted. That is the whole point of keeping the original: if the stored
// file and the rows actually written are two different documents, the
// provenance is decoration.
//
// Two shapes, because a store either streams or signs. Both are read with a
// ceiling, and the ceiling is the attachment's own declared size rather than
// a constant: a body that keeps coming after the store said how big it is
// has stopped being the file that was uploaded.

export class SourceUnreadable extends Error {
  readonly reason: string
  constructor(reason: string) {
    super(reason)
    this.name = 'SourceUnreadable'
    this.reason = reason
  }
}

/** how long a signed url is given before the read is abandoned */
const FETCH_TIMEOUT_MS = 20_000

const collect = async (body: AsyncIterable<Uint8Array>, ceiling: number): Promise<Uint8Array> => {
  const parts: Uint8Array[] = []
  let total = 0
  for await (const part of body) {
    total += part.byteLength
    // a body that outruns what the store declared is not the file that was
    // uploaded, and reading the rest of it is the only way to find out how
    // much memory somebody wanted
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

/**
 * The bytes behind an opened attachment, bounded.
 *
 * The url a redirecting store hands out is a credential: it is fetched and
 * never logged, and a non-2xx from it is the store failing rather than the
 * caller being wrong about anything.
 */
export const readSourceBytes = (
  open: AttachmentOpen,
): Effect.Effect<Uint8Array, SourceUnreadable> =>
  Effect.tryPromise({
    try: async () => {
      const declared = Number(open.meta.size)
      const ceiling = Math.min(
        Number.isFinite(declared) && declared > 0 ? declared : ADMIN_IMPORT_LIMITS.maxFileBytes,
        ADMIN_IMPORT_LIMITS.maxFileBytes,
      )
      if (open.target.kind === 'stream') return collect(open.target.body, ceiling)
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
      try {
        const response = await fetch(open.target.url, {
          signal: controller.signal,
          headers: { 'accept-encoding': 'identity' },
        })
        if (!response.ok || response.body === null) {
          throw new SourceUnreadable('source-unavailable')
        }
        // The client inflates whatever encoding the response names, before
        // anything here can count it: a few hundred bytes stored as brotli
        // arrive as gigabytes. A stored file is its own bytes; one served
        // with an encoding is not the file an upload wrote.
        const encoding = response.headers.get('content-encoding')?.trim().toLowerCase() ?? ''
        if (encoding !== '' && encoding !== 'identity') {
          throw new SourceUnreadable('source-unavailable')
        }
        return await collect(response.body, ceiling)
      } finally {
        clearTimeout(timer)
        // stops a body that outran the ceiling; after a whole read it is nothing
        controller.abort()
      }
    },
    catch: (error) =>
      error instanceof SourceUnreadable ? error : new SourceUnreadable('source-unavailable'),
  })
