import COS from 'cos-js-sdk-v5'
import {
  registerUploadDriver,
  type UploadGrant,
  type UploadOptions,
} from '@qualy/plugin-storage/client'
import type { CosUploadPayload } from '../payload.ts'

// Writing the file straight to the bucket, with the credential the server
// minted for this one object.
//
// One `putObject` and nothing else. The global ceiling on a file is well
// inside what a single put handles, so there is no multipart state machine
// here - no init, no parts, no complete, and nothing that can be abandoned
// halfway and leave the bucket holding fragments nobody will ever collect.
//
// Whatever the store answers with - etag, checksum, length - is for the
// progress bar and the console. The attachment's real size and fingerprint
// come from the server asking the bucket afterwards, so nothing this file
// returns can become a stored fact.

const put = (payload: CosUploadPayload, file: Blob, options: UploadOptions) => {
  const cos = new COS({
    SecretId: payload.tmpSecretId,
    SecretKey: payload.tmpSecretKey,
    SecurityToken: payload.sessionToken,
    StartTime: payload.startTime,
    ExpiredTime: payload.expiredTime,
  })
  return new Promise<void>((resolve, reject) => {
    cos.putObject(
      {
        Bucket: payload.bucket,
        Region: payload.region,
        Key: payload.key,
        Body: file,
        ContentType: file.type || 'application/octet-stream',
        // the credential itself insists on this header, so a second upload to
        // the same key fails at the store rather than replacing an attachment
        // somebody has already referred to
        Headers: { 'x-cos-forbid-overwrite': 'true' },
        onProgress: (info) => {
          options.onProgress?.({ loaded: info.loaded, total: info.total })
        },
      },
      (error) => {
        if (error) reject(error instanceof Error ? error : new Error('upload refused'))
        else resolve()
      },
    )
  })
}

export const cosUploadDriver = {
  driver: 'cos',
  upload: (grant: UploadGrant, file: Blob, options: UploadOptions) =>
    put(grant.payload as CosUploadPayload, file, options),
}

registerUploadDriver(cosUploadDriver)
