import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { DownloadIcon, FileTextIcon, UploadIcon, XIcon } from 'lucide-react'
import { useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { Button } from '@qualy/ui/button'
import { Field } from '@qualy/ui/admin'
import { Dropzone, FileTile, type Accept, type FileRejection } from '@qualy/ui/dropzone'
import { Input } from '@qualy/ui/input'
import { PhotoProvider, PhotoView } from '@qualy/ui/photo-view'
import { Spinner } from '@qualy/ui/spinner'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { uploadFile, type UploadDoors, type UploadedFile } from './upload.ts'
import {
  attachmentContentUrl,
  fileKindLabels,
  lastDay,
  LOOKS_LIKE_A_PHOTOGRAPH,
  sizeLabel,
  sizeLimitLabel,
} from './model.ts'

// The form an administrator composed, drawn field by field. The page hands
// in the item's form configuration and gets back exactly the payload shape
// the server's driver reads: text and dates as strings, attachments as the
// ids of files this person just put in or already cited.

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
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
  },
  files: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  icon: {
    width: 16,
    height: 16,
  },
  dropWords: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  dropRules: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'center',
    columnGap: 8,
    rowGap: 2,
    fontSize: 12,
  },
  refusals: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  refusal: {
    fontSize: 14,
    color: tokens.danger,
  },
  imgFill: {
    width: '100%',
    height: '100%',
    cursor: 'zoom-in',
    objectFit: 'cover',
  },
})

export interface EvidenceFieldSpec {
  /** what this field is called across versions of the form; older forms have none */
  readonly id?: string
  readonly key: string
  readonly type: 'text' | 'date' | 'attachment'
  readonly label: string
  readonly required?: boolean
  readonly maxLength?: number
  readonly min?: string
  readonly max?: string
  readonly maxCount?: number
  /** the largest one file may be; the round's own rule, in bytes */
  readonly maxFileBytes?: number
  readonly accept?: readonly string[]
}

export type EvidencePayload = Record<string, string | readonly string[]>

/** why a file was not added, said about that file */
const REFUSALS = {
  'too-large': m.entryFileRefusedSize,
  type: m.entryFileRefusedKind,
  'too-many': m.entryFileRefusedRoom,
} as const

/** what the form shows for attachment ids it did not upload itself */
export interface KnownFiles {
  readonly [attachmentId: string]: string
}

/**
 * What the field will take, in the shape the drop area matches against.
 *
 * Both halves of the pair are matched, so a bare extension is honoured
 * whichever mime type it is filed under; the type is only there because the
 * shape demands a key.
 */
const acceptOf = (list: readonly string[] | undefined): Accept | undefined => {
  if (list === undefined || list.length === 0) return undefined
  const accept: Record<string, string[]> = {}
  for (const one of list) {
    if (one.startsWith('.')) (accept['application/octet-stream'] ??= []).push(one)
    else accept[one] ??= []
  }
  return accept
}

export function EvidenceForm({
  fields,
  value,
  onChange,
  doors,
  where,
  materialRange,
  knownFiles = {},
  disabled = false,
}: {
  fields: readonly EvidenceFieldSpec[]
  value: EvidencePayload
  onChange: (next: EvidencePayload) => void
  doors: UploadDoors
  where: { batchId: string; itemId: string }
  /** the round's window; what the server will accept is this ∩ the field's own */
  materialRange?: { start: string; end: string } | undefined
  knownFiles?: KnownFiles
  disabled?: boolean
}) {
  const { format } = useI18n()
  const [uploaded, setUploaded] = useState<Record<string, UploadedFile>>({})
  const [uploading, setUploading] = useState<{ field: string; names: readonly string[] } | null>(
    null,
  )
  const [uploadError, setUploadError] = useState<string | null>(null)
  // what the last drop would not take, per field: the file by name and the
  // one reason, kept until the next drop replaces it
  const [turnedAway, setTurnedAway] = useState<{
    field: string
    files: readonly { name: string; reason: FileRejection['reason'] }[]
  } | null>(null)

  const setField = (key: string, next: string | readonly string[]) =>
    onChange({ ...value, [key]: next })

  return (
    <div {...stylex.props(styles.form)}>
      {fields.map((field) => {
        if (field.type === 'text') {
          return (
            <Field key={field.key} label={field.label} required={field.required === true}>
              {(id) => (
                <Input
                  id={id}
                  value={(value[field.key] as string | undefined) ?? ''}
                  maxLength={field.maxLength}
                  disabled={disabled}
                  onChange={(event) => setField(field.key, event.target.value)}
                />
              )}
            </Field>
          )
        }
        if (field.type === 'date') {
          // the picker offers exactly what the server will take: the field's
          // own bounds narrowed by the round's material window
          const floor = [field.min, materialRange?.start].filter(Boolean).sort().at(-1)
          const ceiling = [
            field.max,
            materialRange === undefined ? undefined : lastDay(materialRange.end),
          ]
            .filter(Boolean)
            .sort()
            .at(0)
          return (
            <Field
              key={field.key}
              label={field.label}
              required={field.required === true}
              hint={
                floor === undefined || ceiling === undefined
                  ? undefined
                  : format(m.entryDateWithin, { start: floor, end: ceiling })
              }
            >
              {(id) => (
                <Input
                  id={id}
                  type="date"
                  value={(value[field.key] as string | undefined) ?? ''}
                  min={floor}
                  max={ceiling}
                  disabled={disabled}
                  onChange={(event) => setField(field.key, event.target.value)}
                />
              )}
            </Field>
          )
        }

        const cited = (value[field.key] as readonly string[] | undefined) ?? []
        const kinds = fileKindLabels(field.accept)
        const most = field.maxCount ?? 1
        const room = most - cited.length
        const busy = uploading?.field === field.key

        /**
         * Everything that was dropped, in the order it was dropped, and no
         * more than the field has room for. One at a time: the reservation
         * a ticket holds is per file, and a browser that fires six of them
         * at once is six ways for the round's storage to say no.
         */
        const take = async (files: readonly File[]) => {
          // The rules again, on the way in. The area applies them too, but
          // the area is a widget: this is where an upload begins, and what
          // begins here must never be a file the round has already said it
          // will not keep - the bytes would go up in full and the refusal
          // would arrive at save time, a form's worth of work later.
          const tooBig =
            field.maxFileBytes === undefined
              ? []
              : files.filter((file) => file.size > field.maxFileBytes!)
          const fits = files.filter((file) => !tooBig.includes(file))
          const taking = fits.slice(0, room)
          const noRoom = fits.slice(room)
          const refused = [
            ...tooBig.map((file) => ({ name: file.name, reason: 'too-large' as const })),
            ...noRoom.map((file) => ({ name: file.name, reason: 'too-many' as const })),
          ]
          if (refused.length > 0) setTurnedAway({ field: field.key, files: refused })
          else setTurnedAway(null)
          if (taking.length === 0) return
          setUploadError(null)
          setUploading({ field: field.key, names: taking.map((file) => file.name) })
          const landed: string[] = []
          try {
            for (const file of taking) {
              const done = await uploadFile(doors, where, file)
              setUploaded((previous) => ({ ...previous, [done.attachmentId]: done }))
              landed.push(done.attachmentId)
            }
          } catch {
            setUploadError(format(m.entryFileFailed))
          } finally {
            setUploading(null)
            if (landed.length > 0) setField(field.key, [...cited, ...landed])
          }
        }

        return (
          <Field key={field.key} label={field.label} required={field.required === true}>
            {() => (
              <PhotoProvider maskOpacity={0.85}>
                <div {...stylex.props(styles.files)}>
                  {cited.map((attachmentId) => (
                    <CitedFile
                      key={attachmentId}
                      attachmentId={attachmentId}
                      fallbackName={
                        uploaded[attachmentId]?.filename ??
                        knownFiles[attachmentId] ??
                        format(m.entryFileUnnamed)
                      }
                      onRemove={
                        disabled
                          ? undefined
                          : () =>
                              setField(
                                field.key,
                                cited.filter((id) => id !== attachmentId),
                              )
                      }
                    />
                  ))}

                  {busy &&
                    (uploading?.names ?? []).map((name) => (
                      <FileTile
                        key={`uploading:${name}`}
                        media={<Spinner className={stylex.props(styles.icon).className} />}
                        name={name}
                        meta={format(m.entryFileUploading)}
                      />
                    ))}

                  {!disabled && room > 0 && (
                    <Dropzone
                      accept={acceptOf(field.accept)}
                      maxFiles={room}
                      maxSize={field.maxFileBytes}
                      multiple={room > 1}
                      disabled={busy}
                      onFiles={(files) => void take(files)}
                      onRejected={(rejections) =>
                        setTurnedAway({
                          field: field.key,
                          files: rejections.map((one) => ({
                            name: one.file.name,
                            reason: one.reason,
                          })),
                        })
                      }
                    >
                      <span {...stylex.props(styles.dropWords)}>
                        <UploadIcon aria-hidden className={stylex.props(styles.icon).className} />
                        {format(m.entryFileDrop)}
                      </span>
                      {/* what the round will take, before anybody picks a
                          file: the rules are the administrator's and they
                          are cheap to say, while finding them out by being
                          refused costs the reader a round trip each time */}
                      <span {...stylex.props(styles.dropRules)}>
                        {kinds !== null && <span>{format(m.entryFileKinds, { kinds })}</span>}
                        {field.maxFileBytes !== undefined && (
                          <span>
                            {format(m.entryFileMaxSize, {
                              size: sizeLimitLabel(field.maxFileBytes),
                            })}
                          </span>
                        )}
                        {most > 1 && <span>{format(m.entryFileRoom, { count: room })}</span>}
                      </span>
                    </Dropzone>
                  )}

                  {/* named, one line each: "some files were not added" leaves
                      the reader counting rows to work out which */}
                  {turnedAway?.field === field.key && turnedAway.files.length > 0 && (
                    <ul data-testid="files-turned-away" {...stylex.props(styles.refusals)}>
                      {turnedAway.files.map((one, index) => (
                        <li
                          key={`${one.name}:${index}`}
                          data-turned-away={one.reason}
                          {...stylex.props(styles.refusal)}
                        >
                          {format(REFUSALS[one.reason], {
                            name: one.name,
                            size:
                              field.maxFileBytes === undefined
                                ? ''
                                : sizeLimitLabel(field.maxFileBytes),
                            count: most,
                          })}
                        </li>
                      ))}
                    </ul>
                  )}

                  {uploadError !== null && !busy && (
                    <p {...stylex.props(styles.refusal)}>{uploadError}</p>
                  )}
                </div>
              </PhotoProvider>
            )}
          </Field>
        )
      })}
    </div>
  )
}

/**
 * One file the answer already cites.
 *
 * It asks the server what the file is rather than trusting whatever the page
 * happened to know: a draft reopened tomorrow carries ids and nothing else,
 * and a name the form remembered from the upload is gone by then.
 */
function CitedFile({
  attachmentId,
  fallbackName,
  onRemove,
}: {
  attachmentId: string
  fallbackName: string
  onRemove?: (() => void) | undefined
}) {
  const query = useApiQuery(assessmentApi)
  const { format } = useI18n()
  const descriptor = useQuery({
    ...query.assessment.describeAttachment.queryOptions({ params: { attachmentId } }),
    staleTime: 30_000,
  })
  const data = descriptor.data
  const href =
    data?.delivery.kind === 'redirect' ? data.delivery.url : attachmentContentUrl(attachmentId)
  const name = data?.filename ?? fallbackName
  const isImage = data !== undefined && LOOKS_LIKE_A_PHOTOGRAPH.has(data.declaredMime)

  return (
    <FileTile
      media={
        isImage ? (
          <PhotoView src={href}>
            <img
              src={href}
              alt={name}
              loading="lazy"
              decoding="async"
              className={stylex.props(styles.imgFill).className}
            />
          </PhotoView>
        ) : (
          <FileTextIcon aria-hidden className={stylex.props(styles.icon).className} />
        )
      }
      name={name}
      meta={data === undefined ? undefined : sizeLabel(Number(data.size))}
      actions={
        <>
          {/* a staged upload is already its owner's to read back: checking
              what actually went up should not have to wait for a submission */}
          <Button variant="ghost" size="icon-sm" asChild>
            <a href={href} download={data?.filename} target="_blank" rel="noreferrer">
              <DownloadIcon aria-hidden />
              <span {...stylex.props(styles.srOnly)}>{name}</span>
            </a>
          </Button>
          {onRemove !== undefined && (
            <Button variant="ghost" size="icon-sm" type="button" onClick={onRemove}>
              <XIcon aria-hidden />
              <span {...stylex.props(styles.srOnly)}>{format(m.entryFileRemove)}</span>
            </Button>
          )}
        </>
      }
    />
  )
}
