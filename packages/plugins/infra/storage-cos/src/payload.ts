// What this provider puts in a grant: a credential that can write one object,
// once, for a few minutes.
//
// Everything here is deliberately narrow. The credential is temporary, the key
// is fixed, the ceiling is fixed, and the store itself refuses a second write
// to the same key - so possession of this is not possession of a bucket.

export interface CosUploadPayload {
  readonly bucket: string
  readonly region: string
  readonly key: string
  readonly tmpSecretId: string
  readonly tmpSecretKey: string
  readonly sessionToken: string
  /** seconds since the epoch, which is the unit the browser sdk wants */
  readonly startTime: number
  readonly expiredTime: number
  /** a string because a byte count is a bigint, and json has no such thing */
  readonly maxBytes: string
}
