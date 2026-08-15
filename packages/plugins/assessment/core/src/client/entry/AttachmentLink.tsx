import { useQuery } from '@tanstack/react-query'
import { DownloadIcon, FileTextIcon } from 'lucide-react'
import { useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { Button } from '@qualy/ui/button'
import { FileTile } from '@qualy/ui/dropzone'
import { PhotoProvider, PhotoView } from '@qualy/ui/photo-view'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { attachmentContentUrl, LOOKS_LIKE_A_PHOTOGRAPH, sizeLabel } from './model.ts'

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

export function AttachmentLink({ attachmentId }: { attachmentId: string }) {
  const query = useApiQuery(assessmentApi)
  const { format } = useI18n()
  const descriptor = useQuery({
    ...query.assessment.describeAttachment.queryOptions({ params: { attachmentId } }),
    staleTime: 30_000,
  })
  const data = descriptor.data
  const href =
    data?.delivery.kind === 'redirect' ? data.delivery.url : attachmentContentUrl(attachmentId)
  const name = data?.filename ?? format(m.entryFileUnnamed)
  const isImage = data !== undefined && LOOKS_LIKE_A_PHOTOGRAPH.has(data.declaredMime)

  return (
    <PhotoProvider maskOpacity={0.85}>
      <FileTile
        className="w-full max-w-sm bg-card"
        media={
          isImage ? (
            <PhotoView src={href}>
              <img
                src={href}
                alt={name}
                loading="lazy"
                decoding="async"
                className="size-full cursor-zoom-in object-cover"
              />
            </PhotoView>
          ) : (
            <FileTextIcon aria-hidden className="size-4" />
          )
        }
        name={name}
        meta={data === undefined ? undefined : sizeLabel(Number(data.size))}
        actions={
          <Button variant="ghost" size="icon-sm" asChild>
            <a href={href} download={data?.filename} target="_blank" rel="noreferrer">
              <DownloadIcon aria-hidden />
              <span className="sr-only">{name}</span>
            </a>
          </Button>
        }
      />
    </PhotoProvider>
  )
}

