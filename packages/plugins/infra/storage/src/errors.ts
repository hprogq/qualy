// What storage can refuse, as tags a caller can act on.
//
// Every one of these is somebody's next move: ask for less, wait, upload
// again, or stop. A single opaque failure would leave a screen with nothing to
// say beyond "it didn't work", which is what a 500 already says.
//
// Deliberately not schema-backed wire errors. Nothing serves storage over http
// yet - a business plugin calls this service and decides what its own api says
// about the refusal - and a code with an http status and a translation, raised
// by something no client can reach, is a promise about a wire format nobody
// has had to keep. When the attachment endpoints arrive, whichever plugin
// exposes them declares the codes it answers with and registers them in
// tools/tests/error-codes.test.ts, which is where the one global table lives.

export type UploadRefusedReason =
  /** larger than this deployment allows in one file */
  | 'file-too-large'
  /** the owner already holds as many open tickets as they may */
  | 'too-many-reservations'
  /** the owner's allowance would be exceeded by this upload */
  | 'owner-quota-exceeded'
  /** the tenant's allowance would be */
  | 'tenant-quota-exceeded'
  /** too many tickets asked for in the last hour */
  | 'rate-limited'

/** the upload could not be allowed to start */
export class UploadRefused extends Error {
  readonly _tag = 'STORAGE_UPLOAD_REFUSED'
  // plain fields, not parameter properties: bare node loads this source in
  // strip-only mode when resolution imports descriptors
  readonly reason: UploadRefusedReason
  constructor(input: { reason: UploadRefusedReason }) {
    super(`upload refused: ${input.reason}`)
    this.reason = input.reason
  }
}

/** the ticket named does not exist, or does not belong to this caller */
export class ReservationNotFound extends Error {
  readonly _tag = 'STORAGE_RESERVATION_NOT_FOUND'
  constructor() {
    super('no such upload reservation')
  }
}

export type ReservationInvalidReason =
  /**
   * The ordinary one: the browser said it had finished and the object is not
   * there, which the caller answers by uploading again. It is separate from
   * the rest because the ticket survives it.
   */
  | 'not-uploaded'
  | 'expired'
  | 'failed'
  /** a sweeper holds it; the caller may try again in a moment */
  | 'being-cleaned-up'
  /** the object is larger than the ticket allowed */
  | 'oversized'

/** the ticket cannot be completed as asked */
export class ReservationInvalid extends Error {
  readonly _tag = 'STORAGE_RESERVATION_INVALID'
  readonly reason: ReservationInvalidReason
  constructor(input: { reason: ReservationInvalidReason }) {
    super(`upload reservation is ${input.reason}`)
    this.reason = input.reason
  }
}

export class AttachmentNotFound extends Error {
  readonly _tag = 'STORAGE_ATTACHMENT_NOT_FOUND'
  constructor() {
    super('no such attachment')
  }
}

export type AttachmentInvalidReason =
  /** retired attachments take no new references */
  | 'retired'
  /** somebody else's staged upload is not yours to bind */
  | 'not-owner'
  /** a sweeper holds it; binding would race a delete */
  | 'being-cleaned-up'

/** the attachment is not in a state this act can be done to */
export class AttachmentInvalid extends Error {
  readonly _tag = 'STORAGE_ATTACHMENT_INVALID'
  readonly reason: AttachmentInvalidReason
  constructor(input: { reason: AttachmentInvalidReason }) {
    super(`attachment is ${input.reason}`)
    this.reason = input.reason
  }
}

/**
 * The object store itself failed.
 *
 * Not a domain refusal: nothing the caller did caused it and nothing they can
 * do fixes it. The driver's error rides along on `cause`, so it reaches the log
 * without any of it reaching whoever was uploading - a bucket name or an sts
 * message is exactly what a stable refusal exists to keep inside.
 */
export class BackendUnavailable extends Error {
  readonly _tag = 'STORAGE_BACKEND_UNAVAILABLE'
  readonly operation: string
  constructor(operation: string, cause?: unknown) {
    super(
      `storage backend failed during ${operation}: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      { cause },
    )
    this.operation = operation
  }
}

export const backendFailure = (operation: string, cause: unknown): BackendUnavailable =>
  new BackendUnavailable(operation, cause)

export type StorageError =
  | UploadRefused
  | ReservationNotFound
  | ReservationInvalid
  | AttachmentNotFound
  | AttachmentInvalid
  | BackendUnavailable
