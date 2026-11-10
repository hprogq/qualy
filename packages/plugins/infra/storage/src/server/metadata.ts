import { Effect } from 'effect'
import type { ContentDescriptor } from '../content-metadata.ts'
import { Storage, type AttachmentMeta } from './service.ts'

/** Safe wire projection, with neither backend coordinates nor delivery credentials. */
export const attachmentInfo = (meta: AttachmentMeta): ContentDescriptor => ({
  id: meta.id,
  filename: meta.filename,
  declaredMime: meta.declaredMime,
  size: meta.size.toString(),
  status: meta.status,
})

/** One metadata read for a business response, including repeated historical citations. */
export const presentAttachmentMetadata = Effect.fnUntraced(function* (
  tenantId: string,
  ids: readonly string[],
) {
  const storage = yield* Storage
  const metadata = yield* storage.metadataMany({ tenantId, attachmentIds: [...new Set(ids)] })
  return metadata.map(attachmentInfo)
})
