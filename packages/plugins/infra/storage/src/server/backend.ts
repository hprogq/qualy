import type { Effect } from 'effect'
import type { BackendUnavailable, ReservationInvalid } from '../errors.ts'
import type { UploadGrant } from '../upload.ts'

// What a place to keep bytes has to be able to do, and nothing more.
//
// Four operations, because the upload itself is not one of them: the bytes go
// from the browser to the store directly, and this process only ever hands out
// the permission to write one object, asks whether it arrived, hands out a
// short-lived way to read it, and deletes it.
//
// There is no promote or copy step. The key an upload is authorized for is the
// key the object keeps. What makes the attachment immutable is that a
// completed one always reads back the bytes that were checked when it
// completed, and a store gets there one of two ways: it refuses a second
// write to the key, or it keeps every write as a revision of its own and the
// attachment names the revision it completed with. Core storage does not ask
// which; it keeps whatever revision `stat` reports and hands it back to
// `open`.
//
// Implementing this is the whole of being a storage provider. Everything above
// it - what an attachment is, whose quota it spends, when an unclaimed one is
// swept - belongs to core storage and is the same whichever store answers.

/** the final resting place of one attachment's bytes */
export const objectKeyOf = (tenantId: string, attachmentId: string) =>
  `attachments/${tenantId}/${attachmentId}`

export interface BlobStat {
  readonly size: bigint
  readonly integrityAlgorithm: 'sha256' | 'crc64-ecma'
  readonly integrityValue: string
  readonly etag?: string | undefined
  /**
   * Which of the store's revisions of the key this answer is about.
   *
   * Only from a store that keeps more than one: absent where a key only ever
   * holds the one object a second write is refused against.
   */
  readonly revision?: string | undefined
}

/** one object as core storage names it: the key, and the revision when the store keeps several */
export interface BlobRef {
  readonly key: string
  readonly revision?: string | null | undefined
}

/** a revision the store holds under some key, or a marker saying the key was deleted */
export interface RevisionEntry {
  readonly key: string
  /** absent for the object a key held before the store kept revisions */
  readonly revision: string | undefined
  readonly deleteMarker: boolean
  readonly modifiedAt: number
}

/**
 * What a store that keeps revisions lets core storage do with them.
 *
 * Deleting a key there only hides it behind a marker, and a write after the
 * attachment completed leaves a revision nobody reads: both are bytes that
 * have to be found and removed, which is what these two are for.
 */
export interface RevisionStore {
  /** one page of revisions and markers under a prefix, and where the next begins */
  readonly list: (
    prefix: string,
    cursor: string | undefined,
  ) => Effect.Effect<
    { readonly entries: readonly RevisionEntry[]; readonly next: string | undefined },
    BackendUnavailable
  >
  /** removes exactly one revision or marker; removing what is not there is success */
  readonly remove: (
    key: string,
    revision: string | undefined,
  ) => Effect.Effect<void, BackendUnavailable>
}

/**
 * How the bytes come back.
 *
 * A store that can sign urls sends the reader to itself; one that cannot hands
 * over the stream and lets the caller serve it. Neither is a filesystem path:
 * core storage passes this to an http boundary, and a path would only be
 * meaningful to a provider that happens to keep files.
 */
export type BackendOpen =
  | { readonly kind: 'redirect'; readonly url: string; readonly expiresInSeconds: number }
  | {
      readonly kind: 'stream'
      readonly body: AsyncIterable<Uint8Array>
      readonly size: bigint
    }

export interface PrepareUploadRequest {
  readonly tenantId: string
  readonly ownerUserId: string
  readonly attachmentId: string
  readonly reservationId: string
  readonly key: string
  /** the exact ceiling the store itself must refuse a larger write against */
  readonly maxBytes: bigint
  readonly grantExpiresAt: Date
}

export interface StorageBackend {
  /**
   * How attachments written here name this provider.
   *
   * Recorded on every attachment, which is what lets a deployment change
   * where new files go without losing the old ones: an attachment written to
   * a disk in 2026 still opens through the disk provider after the default
   * moves to a cloud bucket.
   */
  readonly code: string

  /**
   * Permission to write exactly this key, this large, until this instant.
   *
   * Every one of those is a limit the store itself enforces - not a promise
   * the caller makes and this process checks afterwards, which is what a
   * prefix-wide credential would be.
   */
  readonly prepareUpload: (
    request: PrepareUploadRequest,
  ) => Effect.Effect<UploadGrant, BackendUnavailable>

  /** what the store says about the object at the key now, or null when there is none */
  readonly stat: (key: string) => Effect.Effect<BlobStat | null, BackendUnavailable>

  /** the object as it was when it completed: the revision is honoured when there is one */
  readonly open: (
    ref: BlobRef,
    options: { readonly filename: string; readonly mime: string },
  ) => Effect.Effect<BackendOpen, BackendUnavailable>

  /**
   * Removes everything the store holds under the key - every revision and
   * marker, where it keeps them - so the bytes are gone rather than hidden.
   * Deleting what is not there is success: a sweep must be repeatable.
   */
  readonly delete: (key: string) => Effect.Effect<void, BackendUnavailable>

  /** present only where the store keeps revisions of a key */
  readonly revisions?: RevisionStore

  /**
   * Takes an upload's bytes over an open connection, for stores that have no
   * door of their own. A cloud bucket receives directly and never implements
   * this; a disk cannot, so the deployment's http boundary hands the body
   * here. The store itself still enforces the reserved ceiling.
   */
  readonly receive?: (input: {
    readonly reservationId: string
    readonly key: string
    readonly maxBytes: bigint
    readonly body: AsyncIterable<Uint8Array>
  }) => Effect.Effect<void, BackendUnavailable | ReservationInvalid>
}
