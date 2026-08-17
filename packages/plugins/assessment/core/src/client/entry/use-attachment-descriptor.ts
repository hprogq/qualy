import { useQuery } from '@tanstack/react-query'
import { useApi, useRunApi } from '@qualy/web-runtime'
import type { ApiResult, ClientOf } from '@qualy/web-runtime/api'
import { assessmentApi } from '../api.ts'

// One request for a screenful of files.
//
// Every cited file renders through AttachmentLink, and each one asking the
// server for its own name put a page of thirty citations thirty requests
// deep before anything was read. The links stay ignorant of each other; what
// changes is underneath them: loads landing in the same breath are collected
// and asked as one call, and each answer is dealt back to whoever asked.
// The per-file cache entry survives, so a file already described renders
// without any request at all.

type Descriptor = ApiResult<typeof assessmentApi, 'assessment', 'describeAttachment'>
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
  let gathering = gatherings.get(client as object)
  if (gathering === undefined) {
    gathering = { waiting: new Map(), scheduled: false }
    gatherings.set(client as object, gathering)
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
        client.assessment.listAttachmentDescriptors({ query: { id: chunk } }),
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

/**
 * What one cited file is, batched under the hood. `null` when the server
 * left it out - absent and not-yours read the same on purpose.
 */
export function useAttachmentDescriptor(attachmentId: string) {
  const client = useApi(assessmentApi)
  const run = useRunApi()
  return useQuery({
    queryKey: ['assessment', 'attachment', attachmentId],
    queryFn: () => load(client, run as Run, attachmentId),
    staleTime: 30_000,
  })
}
