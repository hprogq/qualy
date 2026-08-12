// What a browser is handed when it is allowed to upload, in the one shape
// both sides of the wire agree on.
//
// The payload is opaque here on purpose. A grant for a cloud store carries
// temporary credentials and a bucket; a grant for a disk carries a url. Core
// storage decides neither, and a business screen that looked inside would be
// a business screen that has to change when the deployment moves.

export interface UploadGrant {
  /** which client-side driver knows how to spend this grant */
  readonly driver: string
  readonly payload: unknown
}

/** what `prepareUpload` tells a client, and nothing it did not need to know */
export interface UploadTicket {
  readonly reservationId: string
  readonly attachmentId: string
  readonly grant: UploadGrant
  /** epoch milliseconds, after which the grant stops working */
  readonly expiresAt: number
}
