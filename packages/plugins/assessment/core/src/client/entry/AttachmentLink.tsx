import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PaperclipIcon } from 'lucide-react'
import { useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { attachmentContentUrl } from './model.ts'

// A cited file, by its own name, and - when it is a picture - as a picture.
//
// The bytes are served as a download on purpose: an html or svg file opened
// as a document would run as one. Rendering through an `<img>` does not
// reopen that door - a subresource load ignores the disposition, and an svg
// loaded this way has scripting disabled by the image spec - so a photograph
// of a certificate can be looked at without a reviewer downloading it, while
// anything that could execute stays a download.
//
// The preview is the original drawn small - there is no derived size to ask
// for - so a page citing a dozen files must not fetch a dozen originals to
// paint: each one waits for the scroll that reaches it, decodes off the main
// thread, and holds its box from the start so nothing moves when it lands.

const LOOKS_LIKE_A_PHOTOGRAPH = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
])

export function AttachmentLink({ attachmentId }: { attachmentId: string }) {
  const query = useApiQuery(assessmentApi)
  const { format } = useI18n()
  const [open, setOpen] = useState(false)
  const descriptor = useQuery({
    ...query.assessment.describeAttachment.queryOptions({ params: { attachmentId } }),
    staleTime: 30_000,
  })
  const data = descriptor.data
  const href =
    data?.delivery.kind === 'redirect' ? data.delivery.url : attachmentContentUrl(attachmentId)
  const isImage = data !== undefined && LOOKS_LIKE_A_PHOTOGRAPH.has(data.declaredMime)

  return (
    <div className="flex flex-col gap-1">
      {isImage && (
        <>
          <button
            type="button"
            className="w-fit overflow-hidden rounded-md border transition-opacity hover:opacity-90"
            onClick={() => setOpen(true)}
            aria-label={data.filename}
          >
            <img
              src={href}
              alt={data.filename}
              width={160}
              height={160}
              loading="lazy"
              decoding="async"
              className="max-h-40 max-w-full object-contain"
            />
          </button>
          {open && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
              role="dialog"
              aria-modal="true"
              aria-label={data.filename}
              onClick={() => setOpen(false)}
            >
              <img
                src={href}
                alt={data.filename}
                decoding="async"
                className="max-h-full max-w-full object-contain"
              />
            </div>
          )}
        </>
      )}
      <a
        className="inline-flex max-w-full items-center gap-1.5 text-sm text-primary underline-offset-2 hover:underline"
        href={href}
        download={data?.filename}
        target="_blank"
        rel="noreferrer"
      >
        <PaperclipIcon aria-hidden className="size-3.5 shrink-0" />
        <span className="truncate">{data?.filename ?? format(m.entryFileUnnamed)}</span>
        {data !== undefined && (
          <span className="shrink-0 text-xs text-muted-foreground">
            {sizeLabel(Number(data.size))}
          </span>
        )}
      </a>
    </div>
  )
}

const sizeLabel = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
