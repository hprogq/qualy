import zlib from 'node:zlib'
import { contentTally, type ContentLimits } from './contents.ts'
import { ArchiveRefused } from './refused.ts'

export { ArchiveRefused, type ArchiveRefusal } from './refused.ts'

// What a workbook costs once it is opened, found out before it is.
//
// An .xlsx is a zip archive, and the ceiling the parser checks first is the
// size of the archive. Ten megabytes of zip can be a gigabyte of XML, and the
// library that reads the workbook (ExcelJS, through JSZip) inflates every
// part it finds, whole, with no ceiling of its own. So the archive is walked
// here first, the way that reader walks it - the central directory named by
// the last end record - and refused if it holds too many parts, if its parts
// together would inflate past the ceiling, or if any part inflates to
// anything but the size the directory declared for it.
//
// That last check is what makes the other two worth having: a declared size
// is a number written in the file, and a hostile file writes any number it
// likes. Inflating each part against its own declaration, with node's output
// ceiling set to it, means nothing larger than the declaration is ever held.
//
// Stricter than the reader, on purpose. Whatever it would reinterpret - data
// before the archive, a split archive, the 64-bit end records no workbook
// this small needs, a method other than stored or deflated, encryption - is
// refused as not a workbook rather than guessed at. Nothing here is about
// what the workbook says; that is the parser's.

export const ARCHIVE_LIMITS = {
  /** a filled-in template is a dozen parts; eight sheets with drawings are a few dozen */
  maxEntries: 512,
  /**
   * Every part inflated, added up.
   *
   * What the reader is handed as text, which it holds while it builds its
   * object model. The model itself is bounded by what the parts contain
   * (contents.ts): it is far larger than the xml it comes from - measured,
   * 73 MiB of sheet xml became 820 MiB of heap - and a small part of numeric
   * cells can hold many times the rows the parser accepts.
   *
   * Sized from the widest workbook the parser will actually accept: 2000
   * rows by 128 columns of ordinary text is 1.58 MiB on disk and 16.71 MiB
   * inflated. The rest is room for styles, themes and pasted images, which
   * arrive already compressed and are bounded by the 10 MiB file ceiling
   * anyway. It was 64 MiB, which admitted about 52,000 rows - twenty-six
   * times the row ceiling - and roughly 700 MiB of heap before the row
   * ceiling was consulted at all.
   */
  maxInflatedBytes: 32 * 1024 * 1024,
} as const

export type ArchiveLimits = { readonly maxEntries: number; readonly maxInflatedBytes: number }

const END_OF_CENTRAL_DIRECTORY = 0x06054b50
const CENTRAL_FILE_HEADER = 0x02014b50
const LOCAL_FILE_HEADER = 0x04034b50
const ZIP64_EXTRA = 0x0001
/** the Info-ZIP unicode path, which the reader prefers to the name it is beside */
const UNICODE_PATH_EXTRA = 0x7075
const MAX16 = 0xffff
const MAX32 = 0xffffffff
/** the end record is 22 bytes and may carry a comment of up to 65535 after it */
const END_RECORD_REACH = 22 + 0xffff

interface Part {
  readonly method: number
  readonly compressed: number
  readonly inflated: number
  readonly localHeader: number
}

/**
 * The 64-bit values a central header defers to its extra field, in the
 * order the format lists them: only the ones whose 32-bit slot is saturated
 * are present.
 */
const widened = (
  view: Buffer,
  from: number,
  length: number,
  part: { inflated: number; compressed: number; localHeader: number },
) => {
  let at = from
  const stop = from + length
  while (at + 4 <= stop) {
    const id = view.readUInt16LE(at)
    const size = view.readUInt16LE(at + 2)
    const body = at + 4
    if (body + size > stop) break
    if (id === ZIP64_EXTRA) {
      let cursor = body
      const next = () => {
        if (cursor + 8 > body + size) throw new ArchiveRefused('malformed')
        const value = view.readBigUInt64LE(cursor)
        cursor += 8
        if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new ArchiveRefused('malformed')
        return Number(value)
      }
      const inflated = part.inflated === MAX32 ? next() : part.inflated
      const compressed = part.compressed === MAX32 ? next() : part.compressed
      const localHeader = part.localHeader === MAX32 ? next() : part.localHeader
      return { inflated, compressed, localHeader }
    }
    at = body + size
  }
  // a saturated slot with nothing to widen it is a header that lies
  throw new ArchiveRefused('malformed')
}

/** whether a header's extra field carries a record of this kind */
const hasExtra = (view: Buffer, from: number, length: number, kind: number) => {
  let at = from
  const stop = from + length
  while (at + 4 <= stop) {
    if (view.readUInt16LE(at) === kind) return true
    at += 4 + view.readUInt16LE(at + 2)
  }
  return false
}

/** the central directory, read the way the workbook reader reads it, or a refusal */
const partsOf = (view: Buffer, limits: ArchiveLimits): readonly Part[] => {
  // the LAST end record, as JSZip finds it; one further back than a comment
  // could put it means bytes after the archive the reader would skip over
  let end = -1
  const floor = Math.max(0, view.length - END_RECORD_REACH)
  for (let at = view.length - 22; at >= floor; at -= 1) {
    if (view.readUInt32LE(at) === END_OF_CENTRAL_DIRECTORY) {
      end = at
      break
    }
  }
  if (end < 0) throw new ArchiveRefused('malformed')

  const disk = view.readUInt16LE(end + 4)
  const directoryDisk = view.readUInt16LE(end + 6)
  const onThisDisk = view.readUInt16LE(end + 8)
  const total = view.readUInt16LE(end + 10)
  const directorySize = view.readUInt32LE(end + 12)
  const directoryOffset = view.readUInt32LE(end + 16)
  // split archives and the 64-bit end records: never a workbook this size
  if (disk !== 0 || directoryDisk !== 0 || onThisDisk !== total) {
    throw new ArchiveRefused('malformed')
  }
  if (total === MAX16 || directorySize === MAX32 || directoryOffset === MAX32) {
    throw new ArchiveRefused('malformed')
  }
  // the directory ends where the end record begins; anything else is data
  // prepended or wedged in, which the reader would shift every offset for
  if (directoryOffset + directorySize !== end) throw new ArchiveRefused('malformed')
  if (total > limits.maxEntries) throw new ArchiveRefused('too-large')

  const parts: Part[] = []
  let declared = 0
  let at = directoryOffset
  for (let n = 0; n < total; n += 1) {
    if (at + 46 > end || view.readUInt32LE(at) !== CENTRAL_FILE_HEADER) {
      throw new ArchiveRefused('malformed')
    }
    const flags = view.readUInt16LE(at + 8)
    const method = view.readUInt16LE(at + 10)
    const nameLength = view.readUInt16LE(at + 28)
    const extraLength = view.readUInt16LE(at + 30)
    const commentLength = view.readUInt16LE(at + 32)
    const next = at + 46 + nameLength + extraLength + commentLength
    if (next > end) throw new ArchiveRefused('malformed')
    // encrypted parts, and compression the reader would have to guess at
    if ((flags & 0x0001) !== 0) throw new ArchiveRefused('malformed')
    if (method !== 0 && method !== 8) throw new ArchiveRefused('malformed')

    let sizes = {
      inflated: view.readUInt32LE(at + 24),
      compressed: view.readUInt32LE(at + 20),
      localHeader: view.readUInt32LE(at + 42),
    }
    if (sizes.inflated === MAX32 || sizes.compressed === MAX32 || sizes.localHeader === MAX32) {
      sizes = widened(view, at + 46 + nameLength, extraLength, sizes)
    }
    // a second name for the part, which the reader believes over the one
    // the contents are routed by; no workbook needs one
    if (hasExtra(view, at + 46 + nameLength, extraLength, UNICODE_PATH_EXTRA)) {
      throw new ArchiveRefused('malformed')
    }
    declared += sizes.inflated
    // said out loud by the directory itself: nothing needs inflating to know
    if (declared > limits.maxInflatedBytes) throw new ArchiveRefused('too-large')
    parts.push({ method, ...sizes })
    at = next
  }
  if (at !== end) throw new ArchiveRefused('malformed')
  return parts
}

/**
 * The archive, walked and every part inflated against its own declaration,
 * or a refusal saying whether it was too large or not an archive at all.
 *
 * Given the ceilings on what the parts hold, each part the reader would
 * parse is also counted against them (contents.ts), so a workbook that
 * would become too many objects is refused before any of them exist.
 *
 * Nothing is kept: each part is inflated, measured and let go, so the most
 * this holds at once is the largest single part the directory admitted to.
 */
export const inspectArchive = (
  bytes: Uint8Array,
  limits: ArchiveLimits = ARCHIVE_LIMITS,
  contents?: ContentLimits,
): void => {
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.length < 22) throw new ArchiveRefused('malformed')
  const tally = contents === undefined ? null : contentTally(contents)
  for (const part of partsOf(view, limits)) {
    const header = part.localHeader
    if (header + 30 > view.length || view.readUInt32LE(header) !== LOCAL_FILE_HEADER) {
      throw new ArchiveRefused('malformed')
    }
    // the data starts after the LOCAL header's own name and extra, which
    // need not match the central ones - that is where the reader looks too,
    // and the local name is the one it routes the part by
    const nameLength = view.readUInt16LE(header + 26)
    if (header + 30 + nameLength > view.length) throw new ArchiveRefused('malformed')
    const name = view.toString('latin1', header + 30, header + 30 + nameLength)
    const start = header + 30 + nameLength + view.readUInt16LE(header + 28)
    const stop = start + part.compressed
    if (stop > view.length) throw new ArchiveRefused('malformed')
    if (part.method === 0) {
      if (part.compressed !== part.inflated) throw new ArchiveRefused('malformed')
      tally?.add(name, view.subarray(start, stop))
      continue
    }
    let inflated: Buffer
    try {
      inflated = zlib.inflateRawSync(view.subarray(start, stop), {
        maxOutputLength: Math.max(part.inflated, 1),
      })
    } catch (error) {
      // past its own declaration is the hostile case; anything else is not
      // deflate the reader could have read either
      if ((error as { code?: unknown }).code === 'ERR_BUFFER_TOO_LARGE') {
        throw new ArchiveRefused('too-large')
      }
      throw new ArchiveRefused('malformed')
    }
    if (inflated.byteLength !== part.inflated) throw new ArchiveRefused('malformed')
    tally?.add(name, inflated)
  }
}
