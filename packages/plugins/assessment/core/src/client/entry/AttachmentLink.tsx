import { useQuery } from '@tanstack/react-query'
import { PaperclipIcon } from 'lucide-react'
import { useApiQuery } from '@qualy/web-runtime'
import { assessmentApi } from '../api.ts'
import { attachmentContentUrl } from './model.ts'

// A cited file, by its own name. The descriptor says what the file is and
// where its bytes live - a signed url for stores that mint their own, this
// api's content door otherwise - so the page never guesses either.

export function AttachmentLink({ attachmentId }: { attachmentId: string }) {
  const query = useApiQuery(assessmentApi)
  const descriptor = useQuery({
    ...query.assessment.describeAttachment.queryOptions({ params: { attachmentId } }),
    staleTime: 30_000,
  })
  const data = descriptor.data
  const href =
    data?.delivery.kind === 'redirect' ? data.delivery.url : attachmentContentUrl(attachmentId)
  return (
    <a
      className="inline-flex max-w-full items-center gap-1.5 text-sm text-primary underline-offset-2 hover:underline"
      href={href}
      download={data?.filename}
      target="_blank"
      rel="noreferrer"
    >
      <PaperclipIcon aria-hidden className="size-3.5 shrink-0" />
      <span className="truncate">{data?.filename ?? '…'}</span>
      {data !== undefined && (
        <span className="shrink-0 text-xs text-muted-foreground">
          {sizeLabel(Number(data.size))}
        </span>
      )}
    </a>
  )
}

const sizeLabel = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
