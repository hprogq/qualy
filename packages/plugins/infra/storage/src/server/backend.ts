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
// key the object keeps, so an object is immutable from its first byte rather
// than after a move that could half-happen.
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

  /** what the store says about the object, or null when there is none */
  readonly stat: (key: string) => Effect.Effect<BlobStat | null, BackendUnavailable>

  readonly open: (
    key: string,
    options: { readonly filename: string; readonly mime: string },
  ) => Effect.Effect<BackendOpen, BackendUnavailable>

  /** deleting what is not there is success: a sweep must be repeatable */
  readonly delete: (key: string) => Effect.Effect<void, BackendUnavailable>

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
