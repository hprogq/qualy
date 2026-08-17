import { useState, type ReactNode } from 'react'
import { DownloadIcon, FileTextIcon, PaperclipIcon } from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { Button } from '@qualy/ui/button'
import { cn } from '@qualy/ui/cn'
import { FileTile } from '@qualy/ui/dropzone'
import { PhotoProvider, PhotoView } from '@qualy/ui/photo-view'
import { assessmentMessages as m } from '../i18n.ts'
import { DocumentLightbox } from './DocumentLightbox.tsx'
import { useAttachmentDescriptor } from './use-attachment-descriptor.ts'
import {
  attachmentContentUrl,
  LOOKS_LIKE_A_DOCUMENT,
  LOOKS_LIKE_A_PHOTOGRAPH,
  sizeLabel,
} from './model.ts'

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
//
// Three sizes for three places, one component so a file behaves the same in
// all of them. `line` is icon and name, for a claim card - a dozen tiles in a
// compact list would be somebody's file drawer with a claim attached. `tile`
// carries a small thumbnail beside the name, for the filing form, where a
// file is being worked with. `preview` draws the file large, for the review
// screen, whose whole job is looking at what was submitted.

/**
 * A photograph that arrives, not one that assembles.
 *
 * The tiles show originals - there is no derived size to ask for - and a
 * large original paints top to bottom as it streams, scanline by scanline
 * over the placeholder. Held invisible until it has fully decoded and then
 * faded in, the tile goes from placeholder to picture in one movement. A
 * cached image is already complete before the load handler is attached, so
 * the ref checks rather than waits.
 */
function ArrivingImg({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [ready, setReady] = useState(false)
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      ref={(node) => {
        if (node !== null && node.complete) setReady(true)
      }}
      onLoad={() => setReady(true)}
      className={cn(
        'transition-opacity duration-300',
        ready ? 'opacity-100' : 'opacity-0',
        className,
      )}
    />
  )
}

/** the lightbox only around a picture: everything else pays nothing for it */
function Shown({ photo, children }: { photo: boolean; children: ReactNode }) {
  return photo ? <PhotoProvider maskOpacity={0.85}>{children}</PhotoProvider> : <>{children}</>
}

export function AttachmentLink({
  attachmentId,
  variant = 'tile',
  slot,
  mark,
}: {
  attachmentId: string
  variant?: 'line' | 'tile' | 'preview' | 'card'
  /**
   * Its number among the materials of this filing, which is also the key
   * that opens it. Only the ones still filed have one - a file that was
   * taken out is not the third thing to look at.
   */
  slot?: number | undefined
  /**
   * Whether this version is where it first appeared. Absent while nothing
   * is being compared, which is when every file is simply one of the files.
   * There is no counterpart for a file that was taken out: that one is named
   * in grey under the row, not drawn as a card among the ones still filed.
   */
  mark?: 'added' | 'supplement' | undefined
}) {
  const { format } = useI18n()
  const descriptor = useAttachmentDescriptor(attachmentId)
  const data = descriptor.data ?? undefined
  const href =
    data?.delivery.kind === 'redirect' ? data.delivery.url : attachmentContentUrl(attachmentId)
  const name = data?.filename ?? format(m.entryFileUnnamed)
  const isImage = data !== undefined && LOOKS_LIKE_A_PHOTOGRAPH.has(data.declaredMime)
  const isDocument = data !== undefined && LOOKS_LIKE_A_DOCUMENT.has(data.declaredMime)
  const [reading, setReading] = useState(false)
  const lightbox = reading && data !== undefined && (
    <DocumentLightbox
      href={href}
      mime={data.declaredMime}
      name={name}
      onClose={() => setReading(false)}
    />
  )

  if (variant === 'line') {
    return (
      <Shown photo={isImage}>
        <span className="flex min-w-0 items-center gap-1.5">
          <PaperclipIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          {/* a picture or a document opens where it stands; anything else
              is a download */}
          {isImage ? (
            <PhotoView src={href}>
              <button
                type="button"
                className="min-w-0 cursor-zoom-in truncate text-left underline-offset-2 hover:underline"
              >
                {name}
              </button>
            </PhotoView>
          ) : isDocument ? (
            <button
              type="button"
              onClick={() => setReading(true)}
              className="min-w-0 cursor-pointer truncate text-left underline-offset-2 hover:underline"
            >
              {name}
            </button>
          ) : (
            <a
              href={href}
              download={data?.filename}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 truncate underline-offset-2 hover:underline"
            >
              {name}
            </a>
          )}
          {lightbox}
          {(isImage || isDocument) && (
            <a
              href={href}
              download={data?.filename}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              <DownloadIcon aria-hidden className="size-3.5" />
              <span className="sr-only">{name}</span>
            </a>
          )}
        </span>
      </Shown>
    )
  }

  // What is filed now, as the design draws it: a tile per file, numbered
  // with the key that opens it and marked when this version is where it
  // first appeared. A file the version took out is not one of these - it is
  // named on its own line underneath, because a tile among the tiles would
  // read as something still on offer.
  if (variant === 'card') {
    return (
      <Shown photo={isImage}>
        <figure
          data-file-slot={slot}
          className="group/file flex w-42 shrink-0 flex-col gap-1.5"
          aria-label={name}
        >
          <div
            className={cn(
              'relative flex h-24 items-center justify-center overflow-hidden rounded-lg border text-muted-foreground',
              mark !== undefined ? 'border-foreground bg-muted' : 'bg-muted/50',
            )}
          >
            {isImage ? (
              <PhotoView src={href}>
                <ArrivingImg
                  src={href}
                  alt={name}
                  className="size-full cursor-zoom-in object-cover"
                />
              </PhotoView>
            ) : (
              <button
                type="button"
                disabled={!isDocument}
                onClick={() => setReading(true)}
                className="flex size-full items-center justify-center enabled:cursor-pointer"
              >
                <FileTextIcon aria-hidden className="size-5.5" />
                <span className="sr-only">{name}</span>
              </button>
            )}
            {slot !== undefined && (
              <span className="absolute top-1.5 left-1.5 rounded border bg-background px-1 font-mono text-[10px] text-foreground">
                {slot}
              </span>
            )}
            {mark !== undefined && (
              <span className="absolute top-1.5 right-1.5 rounded bg-foreground px-1.5 text-[10px] font-medium whitespace-nowrap text-background">
                {format(mark === 'added' ? m.reviewFileAdded : m.reviewFileSupplement)}
              </span>
            )}
            {/* Taking a copy is a second thought, not the reason the tile is
                here, so it waits in the corner of the picture until the
                pointer arrives - and comes back for the keyboard, which
                cannot hover. The caption belongs to the file: its name, and
                what it weighs. */}
            <a
              href={href}
              download={data?.filename}
              target="_blank"
              rel="noreferrer"
              className="absolute right-1.5 bottom-1.5 flex size-6 items-center justify-center rounded-md border bg-background text-muted-foreground opacity-0 transition-opacity group-hover/file:opacity-100 hover:text-foreground focus-visible:opacity-100"
            >
              <DownloadIcon aria-hidden className="size-3.5" />
              <span className="sr-only">{name}</span>
            </a>
          </div>
          <figcaption className="flex min-w-0 flex-col gap-px">
            <span className="text-[11px] leading-snug [overflow-wrap:anywhere]">{name}</span>
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {data === undefined ? '' : sizeLabel(Number(data.size))}
            </span>
          </figcaption>
        </figure>
        {lightbox}
      </Shown>
    )
  }

  if (variant === 'preview') {
    return (
      <Shown photo={isImage}>
        <figure className="flex w-56 flex-col gap-2">
          <div className="flex h-36 items-center justify-center overflow-hidden rounded-xl border bg-muted/60 text-muted-foreground">
            {isImage ? (
              <PhotoView src={href}>
                <ArrivingImg
                  src={href}
                  alt={name}
                  className="size-full cursor-zoom-in object-cover"
                />
              </PhotoView>
            ) : (
              <button
                type="button"
                disabled={!isDocument}
                onClick={() => setReading(true)}
                className="flex size-full flex-col items-center justify-center gap-1.5 enabled:cursor-pointer"
              >
                <FileTextIcon aria-hidden className="size-6" />
                <span className="sr-only">{name}</span>
              </button>
            )}
          </div>
          <figcaption className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-xs" title={name}>
              {name}
            </span>
            <a
              href={href}
              download={data?.filename}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              <DownloadIcon aria-hidden className="size-3.5" />
              <span className="sr-only">{name}</span>
            </a>
          </figcaption>
        </figure>
        {lightbox}
      </Shown>
    )
  }

  return (
    <Shown photo={isImage}>
      <FileTile
        className="w-full max-w-sm bg-card"
        media={
          isImage ? (
            <PhotoView src={href}>
              <ArrivingImg
                src={href}
                alt={name}
                className="size-full cursor-zoom-in object-cover"
              />
            </PhotoView>
          ) : isDocument ? (
            <button
              type="button"
              onClick={() => setReading(true)}
              className="flex size-full cursor-pointer items-center justify-center"
            >
              <FileTextIcon aria-hidden className="size-4" />
              <span className="sr-only">{name}</span>
            </button>
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
      {lightbox}
    </Shown>
  )
}
