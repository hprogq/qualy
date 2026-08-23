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
//
// The sdk is fetched when somebody uploads, not when the app boots. This
// module is declared `Ui.browser`, which means it runs on EVERY page load to
// announce the driver - and a static `import COS from 'cos-js-sdk-v5'` put
// 392 KB of sdk source into the entry chunk of a person who was reading a
// list of batches. Announcing costs a name and a function; the sdk is the
// cost of the first upload, and that is where it now falls.

const sdk = () => import('cos-js-sdk-v5').then((module) => module.default)

const put = async (payload: CosUploadPayload, file: Blob, options: UploadOptions) => {
  const COS = await sdk()
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
        // both headers are conditions of the credential, not politeness: the
        // store refuses a second write to the key, and refuses to publish the
        // object. Sending them explicitly means a request that lost them
        // fails here rather than quietly storing something world-readable.
        Headers: { 'x-cos-forbid-overwrite': 'true', 'x-cos-acl': 'private' },
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
