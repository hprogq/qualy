import { StagedFiles } from '../../attachment/contexts.ts'
import { useQuery } from '@qualy/web-runtime/query'
import { useCallback, useMemo, useState } from 'react'
import { useApi, useRunApi, useManifest } from '@qualy/web-runtime'
import type { ApiResult, ClientOf } from '@qualy/web-runtime/api'
import { assessmentApi } from '../api.ts'
import { useAttachmentFiles } from './attachment-files.ts'

// One request for a screenful of files.
//
// Every cited file renders through AttachmentLink, and each one asking the
// server for its own name put a page of thirty citations thirty requests
// deep before anything was read. The links stay ignorant of each other; what
// changes is underneath them: loads landing in the same breath are collected
// and asked as one call, and each answer is dealt back to whoever asked.
// The per-file cache entry survives, so a file already described renders
// without any request at all.

type Descriptor = ApiResult<
  typeof assessmentApi,
  'assessment',
  'listStagedAttachmentDescriptors'
>['attachments'][number]
type Client = ClientOf<typeof assessmentApi>
type Run = <A, E>(effect: import('effect').Effect.Effect<A, E>) => Promise<A>

/** the server refuses more than this many ids in one crossing */
const PER_REQUEST = 60

interface Waiting {
  readonly resolve: (found: Descriptor | null) => void
  readonly reject: (error: unknown) => void
}

interface Gathering {
  waiting: Map<string, Waiting[]>
  scheduled: boolean
}

// per client instance, so a test's fake client gathers apart from the real
// one and nothing leaks between runtimes
const gatherings = new WeakMap<object, Gathering>()

const load = (client: Client, run: Run, attachmentId: string): Promise<Descriptor | null> => {
  let gathering = gatherings.get(client)
  if (gathering === undefined) {
    gathering = { waiting: new Map(), scheduled: false }
    gatherings.set(client, gathering)
  }
  const settled = new Promise<Descriptor | null>((resolve, reject) => {
    const line = gathering.waiting.get(attachmentId)
    if (line === undefined) gathering.waiting.set(attachmentId, [{ resolve, reject }])
    else line.push({ resolve, reject })
  })
  if (!gathering.scheduled) {
    gathering.scheduled = true
    // one macrotask: everything a render commit asks for goes as one call
    setTimeout(() => {
      gathering.scheduled = false
      const waiting = gathering.waiting
      gathering.waiting = new Map()
      void flush(client, run, waiting)
    }, 0)
  }
  return settled
}

const flush = async (client: Client, run: Run, waiting: Map<string, Waiting[]>) => {
  const ids = [...waiting.keys()]
  for (let at = 0; at < ids.length; at += PER_REQUEST) {
    const chunk = ids.slice(at, at + PER_REQUEST)
    try {
      const { attachments } = await run(
        client.assessment.listStagedAttachmentDescriptors({ query: { id: chunk } }),
      )
      const byId = new Map(attachments.map((one) => [one.id, one]))
      for (const id of chunk) {
        for (const line of waiting.get(id) ?? []) line.resolve(byId.get(id) ?? null)
      }
    } catch (error) {
      for (const id of chunk) {
        for (const line of waiting.get(id) ?? []) line.reject(error)
      }
    }
  }
}

/** Business responses supply files. Only restored staged drafts need a lookup. */
export function useAttachmentDescriptor(attachmentId: string) {
  const identity = useManifest().identity
  const files = useAttachmentFiles()
  const projected = files.get(attachmentId)
  const client = useApi(assessmentApi)
  const run = useRunApi()
  const query = useQuery({
    queryKey: ['assessment', 'attachment', attachmentId],
    queryFn: () => load(client, run, attachmentId),
    enabled: projected === undefined,
    staleTime: Infinity,
    retry: false,
  })
  // A failed reauthorization must not unmount an open preview by erasing
  // its name and MIME. Keep citation metadata, never use it to renew access.
  const data = useMemo(() => {
    if (projected !== undefined) return projected
    const metadata = query.data
    if (metadata == null || identity === undefined) return undefined
    const reference = StagedFiles.at({})
    return {
      ...metadata,
      contentUrl: reference.contentUrl(attachmentId, identity),
      thumbnailUrl: reference.contentUrl(attachmentId, identity, 'thumbnail'),
    }
  }, [projected, query.data, identity, attachmentId])
  const [known, setKnown] = useState(data)
  if (data != null && data !== known) setKnown(data)
  const knownMetadata =
    known?.id === attachmentId
      ? { filename: known.filename, declaredMime: known.declaredMime, size: known.size }
      : undefined
  const attempted = useMemo(
    () => ({ attachmentId, original: false, thumbnail: false }),
    [attachmentId],
  )
  const beginPreview = useCallback(() => {
    attempted.original = false
  }, [attempted])
  const originalUrl = data?.contentUrl
  const thumbnailUrl = data?.thumbnailUrl
  const renewFor = useCallback(
    async (kind: 'original' | 'thumbnail'): Promise<string | null> => {
      if (attempted[kind]) return null
      attempted[kind] = true
      // Re-read the stable application URL. A retry never substitutes the
      // current global identity or signs a new reference for an old page.
      const target = kind === 'thumbnail' ? thumbnailUrl : originalUrl
      if (target === undefined) return null
      const url = new URL(target, window.location.origin)
      url.searchParams.set('retry', '1')
      return url.pathname + url.search
    },
    [originalUrl, thumbnailUrl, attempted],
  )
  const renew = useCallback(() => renewFor('original'), [renewFor])
  const renewThumbnail = useCallback(() => renewFor('thumbnail'), [renewFor])
  return {
    ...query,
    data,
    metadata: knownMetadata,
    renew,
    renewThumbnail,
    thumbnailUrl: data?.thumbnailUrl ?? '',
    contentUrl: data?.contentUrl ?? '',
    beginPreview,
  }
}
