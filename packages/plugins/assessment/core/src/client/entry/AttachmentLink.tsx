import { useState, type ReactNode } from 'react'
import type * as React from 'react'
import * as stylex from '@stylexjs/stylex'
import { DownloadIcon, FileTextIcon, PaperclipIcon } from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { Button } from '@qualy/ui/button'
import { FileTile } from '@qualy/ui/dropzone'
import { PhotoProvider, PhotoView } from '@qualy/ui/photo-view'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
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

const styles = stylex.create({
  srOnly: {
    position: 'absolute',
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    whiteSpace: 'nowrap',
    borderWidth: 0,
  },
  arriving: {
    opacity: 0,
    transitionProperty: 'opacity',
    transitionDuration: '300ms',
  },
  arrived: {
    opacity: 1,
  },
  imgFill: {
    width: '100%',
    height: '100%',
    cursor: 'zoom-in',
    objectFit: 'cover',
  },
  lineRow: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 6,
  },
  clipIcon: {
    width: 14,
    height: 14,
    flexShrink: 0,
    color: tokens.mutedForeground,
  },
  lineName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    textAlign: 'left',
    textUnderlineOffset: 2,
    textDecorationLine: {
      default: 'none',
      ':hover': 'underline',
    },
  },
  zoomIn: {
    cursor: 'zoom-in',
  },
  pointer: {
    cursor: 'pointer',
  },
  quietDownload: {
    flexShrink: 0,
    color: {
      default: tokens.mutedForeground,
      ':hover': tokens.foreground,
    },
  },
  smallIcon: {
    width: 14,
    height: 14,
  },
  cardFigure: {
    display: 'flex',
    width: 168,
    flexShrink: 0,
    flexDirection: 'column',
    gap: 6,
  },
  cardBox: {
    position: 'relative',
    display: 'flex',
    height: 96,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 50%, transparent)`,
    color: tokens.mutedForeground,
  },
  cardBoxMarked: {
    borderColor: tokens.foreground,
    backgroundColor: tokens.surfaceMuted,
  },
  fillButton: {
    display: 'flex',
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: {
      default: 'default',
      ':enabled': 'pointer',
    },
  },
  fillColumn: {
    flexDirection: 'column',
    gap: 6,
  },
  docIconCard: {
    width: 22,
    height: 22,
  },
  docIconPreview: {
    width: 24,
    height: 24,
  },
  docIconTile: {
    width: 16,
    height: 16,
  },
  slotBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    borderRadius: tokens.radiusSm,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    backgroundColor: tokens.background,
    paddingInline: 4,
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    fontSize: 10,
    color: tokens.foreground,
  },
  markBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    borderRadius: tokens.radiusSm,
    backgroundColor: tokens.foreground,
    paddingInline: 6,
    fontSize: 10,
    fontWeight: 500,
    whiteSpace: 'nowrap',
    color: tokens.background,
  },
  cardDownload: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    display: 'flex',
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: tokens.radiusMd,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    backgroundColor: tokens.background,
    color: {
      default: tokens.mutedForeground,
      ':hover': tokens.foreground,
    },
    opacity: {
      default: 0,
      ':focus-visible': 1,
    },
    transitionProperty: 'opacity',
  },
  cardDownloadShown: {
    opacity: 1,
  },
  cardCaption: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 1,
  },
  cardName: {
    fontSize: 11,
    lineHeight: 1.375,
    overflowWrap: 'anywhere',
  },
  cardSize: {
    fontSize: 10,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  previewFigure: {
    display: 'flex',
    width: 224,
    flexDirection: 'column',
    gap: 8,
  },
  previewBox: {
    display: 'flex',
    height: 144,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: `calc(${tokens.radiusLg} + 4px)`,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 60%, transparent)`,
    color: tokens.mutedForeground,
  },
  previewCaption: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 6,
  },
  previewName: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12,
  },
  tileMediaButton: {
    display: 'flex',
    width: '100%',
    height: '100%',
    cursor: 'pointer',
    alignItems: 'center',
    justifyContent: 'center',
  },
})

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
function ArrivingImg({ className, onLoad, ...rest }: React.ComponentProps<'img'>) {
  const [ready, setReady] = useState(false)
  return (
    // The rest props are the lightbox's lifeline: PhotoView hands its child
    // the click that opens the viewer by cloning it, and a component that
    // keeps only the props it knows swallows that click - every photograph
    // on the product silently stopped opening.
    <img
      loading="lazy"
      decoding="async"
      {...rest}
      ref={(node) => {
        if (node !== null && node.complete) setReady(true)
      }}
      onLoad={(event) => {
        setReady(true)
        onLoad?.(event)
      }}
      className={[stylex.props(styles.arriving, ready && styles.arrived).className, className]
        .filter(Boolean)
        .join(' ')}
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
  // whether the pointer is on the card tile: the download button in its
  // corner reads that from here rather than from a selector on the figure
  const [rested, setRested] = useState(false)
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
        <span {...stylex.props(styles.lineRow)}>
          <PaperclipIcon aria-hidden className={stylex.props(styles.clipIcon).className} />
          {/* a picture or a document opens where it stands; anything else
              is a download */}
          {isImage ? (
            <PhotoView src={href}>
              <button
                type="button"
                className={stylex.props(styles.lineName, styles.zoomIn).className}
              >
                {name}
              </button>
            </PhotoView>
          ) : isDocument ? (
            <button
              type="button"
              onClick={() => setReading(true)}
              {...stylex.props(styles.lineName, styles.pointer)}
            >
              {name}
            </button>
          ) : (
            <a
              href={href}
              download={data?.filename}
              target="_blank"
              rel="noreferrer"
              {...stylex.props(styles.lineName)}
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
              {...stylex.props(styles.quietDownload)}
            >
              <DownloadIcon aria-hidden className={stylex.props(styles.smallIcon).className} />
              <span {...stylex.props(styles.srOnly)}>{name}</span>
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
          {...stylex.props(styles.cardFigure)}
          aria-label={name}
          onMouseEnter={() => setRested(true)}
          onMouseLeave={() => setRested(false)}
        >
          <div {...stylex.props(styles.cardBox, mark !== undefined && styles.cardBoxMarked)}>
            {isImage ? (
              <PhotoView src={href}>
                <ArrivingImg
                  src={href}
                  alt={name}
                  className={stylex.props(styles.imgFill).className}
                />
              </PhotoView>
            ) : (
              <button
                type="button"
                disabled={!isDocument}
                onClick={() => setReading(true)}
                {...stylex.props(styles.fillButton)}
              >
                <FileTextIcon aria-hidden className={stylex.props(styles.docIconCard).className} />
                <span {...stylex.props(styles.srOnly)}>{name}</span>
              </button>
            )}
            {slot !== undefined && <span {...stylex.props(styles.slotBadge)}>{slot}</span>}
            {mark !== undefined && (
              <span {...stylex.props(styles.markBadge)}>
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
              {...stylex.props(styles.cardDownload, rested && styles.cardDownloadShown)}
            >
              <DownloadIcon aria-hidden className={stylex.props(styles.smallIcon).className} />
              <span {...stylex.props(styles.srOnly)}>{name}</span>
            </a>
          </div>
          <figcaption {...stylex.props(styles.cardCaption)}>
            <span {...stylex.props(styles.cardName)}>{name}</span>
            <span {...stylex.props(styles.cardSize)}>
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
        <figure {...stylex.props(styles.previewFigure)}>
          <div {...stylex.props(styles.previewBox)}>
            {isImage ? (
              <PhotoView src={href}>
                <ArrivingImg
                  src={href}
                  alt={name}
                  className={stylex.props(styles.imgFill).className}
                />
              </PhotoView>
            ) : (
              <button
                type="button"
                disabled={!isDocument}
                onClick={() => setReading(true)}
                {...stylex.props(styles.fillButton, styles.fillColumn)}
              >
                <FileTextIcon
                  aria-hidden
                  className={stylex.props(styles.docIconPreview).className}
                />
                <span {...stylex.props(styles.srOnly)}>{name}</span>
              </button>
            )}
          </div>
          <figcaption {...stylex.props(styles.previewCaption)}>
            <span {...stylex.props(styles.previewName)} title={name}>
              {name}
            </span>
            <a
              href={href}
              download={data?.filename}
              target="_blank"
              rel="noreferrer"
              {...stylex.props(styles.quietDownload)}
            >
              <DownloadIcon aria-hidden className={stylex.props(styles.smallIcon).className} />
              <span {...stylex.props(styles.srOnly)}>{name}</span>
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
                className={stylex.props(styles.imgFill).className}
              />
            </PhotoView>
          ) : isDocument ? (
            <button
              type="button"
              onClick={() => setReading(true)}
              {...stylex.props(styles.tileMediaButton)}
            >
              <FileTextIcon aria-hidden className={stylex.props(styles.docIconTile).className} />
              <span {...stylex.props(styles.srOnly)}>{name}</span>
            </button>
          ) : (
            <FileTextIcon aria-hidden className={stylex.props(styles.docIconTile).className} />
          )
        }
        name={name}
        meta={data === undefined ? undefined : sizeLabel(Number(data.size))}
        actions={
          <Button variant="ghost" size="icon-sm" asChild>
            <a href={href} download={data?.filename} target="_blank" rel="noreferrer">
              <DownloadIcon aria-hidden />
              <span {...stylex.props(styles.srOnly)}>{name}</span>
            </a>
          </Button>
        }
      />
      {lightbox}
    </Shown>
  )
}
