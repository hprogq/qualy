import { Effect } from 'effect'
import type { AttachmentOpen } from '@qualy/plugin-storage/server'
import { SPREADSHEET_LIMITS } from '@qualy/spreadsheet'

// Getting the spreadsheet's bytes back, whichever way the store hands them
// out. The server re-reads the file rather than trusting rows the browser
// parsed and posted: the original kept as provenance and the rows actually
// written have to be one document.

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

/** the bytes behind an opened attachment, bounded by what the store declared */
export const readSourceBytes = (
  open: AttachmentOpen,
): Effect.Effect<Uint8Array, SourceUnreadable> =>
  Effect.tryPromise({
    try: async () => {
      const declared = Number(open.meta.size)
      const ceiling = Math.min(
        Number.isFinite(declared) && declared > 0 ? declared : SPREADSHEET_LIMITS.maxFileBytes,
        SPREADSHEET_LIMITS.maxFileBytes,
      )
      if (open.target.kind === 'stream') return collect(open.target.body, ceiling)
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
      try {
        const response = await fetch(open.target.url, { signal: controller.signal })
        if (!response.ok) throw new SourceUnreadable('source-unavailable')
        const buffer = await response.arrayBuffer()
        if (buffer.byteLength > ceiling) throw new SourceUnreadable('source-too-large')
        return new Uint8Array(buffer)
      } finally {
        clearTimeout(timer)
      }
    },
    catch: (error) =>
      error instanceof SourceUnreadable ? error : new SourceUnreadable('source-unavailable'),
  })
