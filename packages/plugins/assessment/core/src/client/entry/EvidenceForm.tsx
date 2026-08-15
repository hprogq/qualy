import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileTextIcon, UploadIcon, XIcon } from 'lucide-react'
import { useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { Button } from '@qualy/ui/button'
import { Field } from '@qualy/ui/admin'
import { Dropzone, FileTile, type Accept } from '@qualy/ui/dropzone'
import { Input } from '@qualy/ui/input'
import { PhotoProvider, PhotoView } from '@qualy/ui/photo-view'
import { Spinner } from '@qualy/ui/spinner'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { uploadFile, type UploadDoors, type UploadedFile } from './upload.ts'
import { attachmentContentUrl, lastDay, LOOKS_LIKE_A_PHOTOGRAPH, sizeLabel } from './model.ts'

// The form an administrator composed, drawn field by field. The page hands
// in the item's form configuration and gets back exactly the payload shape
// the server's driver reads: text and dates as strings, attachments as the
// ids of files this person just put in or already cited.

export interface EvidenceFieldSpec {
  readonly key: string
  readonly type: 'text' | 'date' | 'attachment'
  readonly label: string
  readonly required?: boolean
  readonly maxLength?: number
  readonly min?: string
  readonly max?: string
  readonly maxCount?: number
  readonly accept?: readonly string[]
}

export type EvidencePayload = Record<string, string | readonly string[]>

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

  const setField = (key: string, next: string | readonly string[]) =>
    onChange({ ...value, [key]: next })

  return (
    <div className="flex flex-col gap-5">
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
          const taking = files.slice(0, room)
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
                <div className="flex flex-col gap-2">
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
                        media={<Spinner className="size-4" />}
                        name={name}
                        meta={format(m.entryFileUploading)}
                      />
                    ))}

                  {!disabled && room > 0 && (
                    <Dropzone
                      accept={acceptOf(field.accept)}
                      maxFiles={room}
                      multiple={room > 1}
                      disabled={busy}
                      onFiles={(files) => void take(files)}
                    >
                      <span className="flex items-center gap-2">
                        <UploadIcon aria-hidden className="size-4" />
                        {format(m.entryFileDrop)}
                      </span>
                      {most > 1 && (
                        <span className="text-xs">{format(m.entryFileRoom, { count: room })}</span>
                      )}
                    </Dropzone>
                  )}

                  {uploadError !== null && !busy && (
                    <p className="text-sm text-destructive">{uploadError}</p>
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
        onRemove !== undefined && (
          <Button variant="ghost" size="icon-sm" type="button" onClick={onRemove}>
            <XIcon aria-hidden />
            <span className="sr-only">{format(m.entryFileRemove)}</span>
          </Button>
        )
      }
    />
  )
}
