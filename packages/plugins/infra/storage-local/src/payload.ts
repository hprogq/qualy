// What this provider puts in a grant, in the one module both halves can read.
//
// The server writes it and the browser driver spends it, and neither of them
// needs the other's imports to agree on the shape - which is why it is here
// and not beside either.

export interface LocalUploadPayload {
  /** where the bytes are PUT */
  readonly url: string
  readonly reservationId: string
  /** a string because a byte count is a bigint, and json has no such thing */
  readonly maxBytes: string
  readonly expiresAt: string
}
