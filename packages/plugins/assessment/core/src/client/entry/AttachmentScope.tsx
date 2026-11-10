import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useManifest } from '@qualy/web-runtime'
import type { ReadReference, ContentDescriptor } from '@qualy/plugin-storage/content'

export interface AttachmentDelivery extends ContentDescriptor {
  readonly contentUrl: string
  readonly thumbnailUrl: string
}
const Files = createContext<ReadonlyMap<string, AttachmentDelivery>>(new Map())

/** Metadata already projected by the business response; no URL lookup per tile. */
export function AttachmentScope({
  files,
  context,
  children,
}: {
  context: ReadReference | undefined
  files: readonly ContentDescriptor[] | undefined
  children: ReactNode
}) {
  const parent = useContext(Files)
  const identity = useManifest().identity
  const value = useMemo(() => {
    if (
      files === undefined ||
      files.length === 0 ||
      context === undefined ||
      identity === undefined
    )
      return parent
    const next = new Map(parent)
    for (const file of files)
      next.set(file.id, {
        ...file,
        contentUrl: context.contentUrl(file.id, identity),
        thumbnailUrl: context.contentUrl(file.id, identity, 'thumbnail'),
      })
    return next
  }, [parent, files, context, identity])
  return <Files value={value}>{children}</Files>
}

export const useAttachmentFiles = () => useContext(Files)
