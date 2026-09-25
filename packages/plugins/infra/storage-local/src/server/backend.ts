import { createHash } from 'node:crypto'
import { ReservationInvalid } from '@qualy/plugin-storage/errors'
import fs from 'node:fs'
import { constants as fsConstants } from 'node:fs'
import { link, mkdir, open, readdir, rm, stat as statFile } from 'node:fs/promises'
import path from 'node:path'
import { Effect } from 'effect'
import { backendFailure, type BackendUnavailable } from '@qualy/plugin-storage/errors'
import type { BlobStat, StorageBackend } from '@qualy/plugin-storage/backend'
import type { LocalUploadPayload } from '../payload.ts'
import { localUploadUrl } from '../urls.ts'

// The disk as an object store.
//
// Not a development stand-in: a deployment that keeps its files on its own
// machine is a supported deployment, and everything a cloud provider
// guarantees has to hold here too. The two that take work are immutability -
// an installed object is never overwritten - and never leaving a half file
// where a whole one is expected.
//
// Both come from the same trick: bytes land in `.tmp` under the ticket's id
// and are installed with a hard link, which fails if anything already holds
// the name.
//
// A crash mid-upload leaves that temporary file behind. It used to stay for
// good, and it held the ticket too: the exclusive open refused every retry,
// so the uploader got 503 until the ticket ran out. One process receives a
// store's uploads, so which staging files are being written is known here:
// one this process is not writing is a dead process's half file, reclaimed
// by the next upload on its ticket, or swept once nothing could still be
// writing it.

const fault = (operation: string) => (cause: unknown) => backendFailure(operation, cause)

/** the temporary file an upload accumulates in, named for its ticket */
/** the one failure that is the ticket's, not the disk's */
class Oversized extends Error {}

const stagingPath = (root: string, reservationId: string) => path.join(root, '.tmp', reservationId)

const objectPath = (root: string, key: string) => path.join(root, key)

/** the staging files this process is writing right now, by absolute path */
const receiving = new Set<string>()

const EXCLUSIVE_WRITE = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL

/**
 * How long a staging file can go untouched before nothing can still be
 * writing it: twice the longest the host lets one request take to arrive
 * (apps/server/src/http-server.ts), and an arriving upload touches its file
 * with every chunk.
 */
export const STALE_STAGING_MS = 60 * 60 * 1000

export interface ReceivedUpload {
  readonly bytes: bigint
  readonly sha256: string
}

/**
 * What a local upload route calls once there is one.
 *
 * The receiving of bytes is separate from the http route on purpose: a route
 * has to decide who is uploading, and this plugin's whole job is to know
 * nothing about people. The route arrives with the attachment api; this is
 * what it will hand the request body to.
 */
export interface LocalReceiver {
  readonly receive: (input: {
    readonly reservationId: string
    readonly key: string
    readonly maxBytes: bigint
    readonly body: AsyncIterable<Uint8Array>
  }) => Effect.Effect<ReceivedUpload, BackendUnavailable | ReservationInvalid>
}

const install = async (root: string, key: string, from: string) => {
  const target = objectPath(root, key)
  await mkdir(path.dirname(target), { recursive: true })
  // link rather than rename: rename replaces silently, and an object that can
  // be replaced is not immutable. The temporary name goes either way.
  await link(from, target)
  await rm(from, { force: true })
}

const receiveInto = async (
  root: string,
  input: {
    reservationId: string
    key: string
    maxBytes: bigint
    body: AsyncIterable<Uint8Array>
  },
): Promise<ReceivedUpload> => {
  const staging = stagingPath(root, input.reservationId)
  // two uploads on one ticket are two writers on one file, and the second is
  // refused rather than interleaved
  if (receiving.has(staging)) {
    throw new Error(`an upload on ticket ${input.reservationId} is already arriving`)
  }
  receiving.add(staging)
  try {
    return await receiveExclusively(root, staging, input)
  } finally {
    receiving.delete(staging)
  }
}

/** the staging file, opened for this upload alone; a file nobody here is writing is reclaimed */
const openStaging = async (staging: string) => {
  await mkdir(path.dirname(staging), { recursive: true })
  try {
    return await open(staging, EXCLUSIVE_WRITE)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    await rm(staging, { force: true })
    return await open(staging, EXCLUSIVE_WRITE)
  }
}

const receiveExclusively = async (
  root: string,
  staging: string,
  input: {
    key: string
    maxBytes: bigint
    body: AsyncIterable<Uint8Array>
  },
): Promise<ReceivedUpload> => {
  const handle = await openStaging(staging)
  const digest = createHash('sha256')
  let size = 0n
  try {
    for await (const chunk of input.body) {
      size += BigInt(chunk.byteLength)
      // stopping at the limit rather than after it: the whole point of a
      // declared size is that nobody gets to write past it
      if (size > input.maxBytes) throw new Oversized()
      digest.update(chunk)
      await handle.write(chunk)
    }
    await handle.sync()
  } catch (error) {
    await handle.close().catch(() => {})
    await rm(staging, { force: true })
    throw error
  }
  await handle.close()
  try {
    await install(root, input.key, staging)
  } catch (error) {
    await rm(staging, { force: true })
    throw error
  }
  return { bytes: size, sha256: digest.digest('hex') }
}

/**
 * Removes the staging files nothing can still be writing, and says how many.
 *
 * Only what a crash left: a file this process is writing is skipped whatever
 * its age, and so is one touched within `STALE_STAGING_MS`, which is how a
 * file another process might be writing looks.
 */
export const sweepStaging = async (root: string, now: number): Promise<number> => {
  const directory = path.join(root, '.tmp')
  let names: string[]
  try {
    names = await readdir(directory)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
    throw error
  }
  let removed = 0
  for (const name of names) {
    const file = path.join(directory, name)
    if (receiving.has(file)) continue
    const info = await statFile(file).catch(() => undefined)
    if (info === undefined || !info.isFile() || now - info.mtimeMs < STALE_STAGING_MS) continue
    await rm(file, { force: true })
    removed += 1
  }
  return removed
}

export const localReceiver = (root: string): LocalReceiver => ({
  receive: (input) =>
    Effect.tryPromise({
      try: () => receiveInto(root, input),
      catch: (cause) =>
        cause instanceof Oversized
          ? new ReservationInvalid({ reason: 'oversized' })
          : fault('receive')(cause),
    }),
})

/**
 * Reads back what is actually on disk.
 *
 * Including the digest, which means reading the whole file. That is the cost
 * of not trusting the uploader: the value recorded against an attachment has
 * to be one this process computed from the bytes that are there, not one the
 * receiving handler reported and nobody checked.
 */
const statLocal = async (root: string, key: string): Promise<BlobStat | null> => {
  const target = objectPath(root, key)
  let size: bigint
  try {
    const info = await statFile(target, { bigint: true })
    if (!info.isFile()) return null
    size = info.size
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  const digest = createHash('sha256')
  for await (const chunk of fs.createReadStream(target)) digest.update(chunk as Uint8Array)
  return { size, integrityAlgorithm: 'sha256', integrityValue: digest.digest('hex') }
}

export const localBackend = (root: string): StorageBackend => ({
  code: 'local',

  // the same receiving the standalone receiver does, on the registered
  // backend so core storage's upload door can hand bytes to whichever store
  // a reservation names
  receive: (input) => Effect.asVoid(localReceiver(root).receive(input)),

  prepareUpload: (request) =>
    Effect.succeed({
      driver: 'local',
      payload: {
        url: localUploadUrl(request.reservationId),
        reservationId: request.reservationId,
        maxBytes: request.maxBytes.toString(),
        expiresAt: request.grantExpiresAt.toISOString(),
      } satisfies LocalUploadPayload,
    }),

  stat: (key) => Effect.tryPromise({ try: () => statLocal(root, key), catch: fault('stat') }),

  open: (key) =>
    Effect.tryPromise({
      try: async () => {
        const info = await statFile(objectPath(root, key), { bigint: true })
        return {
          kind: 'stream' as const,
          body: fs.createReadStream(objectPath(root, key)) as AsyncIterable<Uint8Array>,
          size: info.size,
        }
      },
      catch: fault('open'),
    }),

  delete: (key) =>
    Effect.tryPromise({
      try: () => rm(objectPath(root, key), { force: true }),
      catch: fault('delete'),
    }),
})
