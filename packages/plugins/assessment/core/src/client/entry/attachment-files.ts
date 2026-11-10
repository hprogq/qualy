import { createContext, useContext } from 'react'
import type { ContentDescriptor } from '@qualy/plugin-storage/content'

export interface AttachmentDelivery extends ContentDescriptor {
  readonly contentUrl: string
  readonly thumbnailUrl: string
}
export const AttachmentFiles = createContext<ReadonlyMap<string, AttachmentDelivery>>(new Map())

export const useAttachmentFiles = () => useContext(AttachmentFiles)
