import { useRef, useState } from 'react'
import { useI18n } from '@qualy/web-i18n'
import { Button } from '@qualy/ui/button'
import { Field } from '@qualy/ui/admin'
import { Input } from '@qualy/ui/input'
import { assessmentMessages as m } from '../i18n.ts'
import { uploadFile, type UploadDoors, type UploadedFile } from './upload.ts'
import { lastDay } from './model.ts'

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
  const [uploading, setUploading] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const nameOf = (attachmentId: string) =>
    uploaded[attachmentId]?.filename ?? knownFiles[attachmentId] ?? format(m.entryFileUnnamed)

  const setField = (key: string, next: string | readonly string[]) =>
    onChange({ ...value, [key]: next })

  return (
    <div className="flex flex-col gap-4">
      {fields.map((field) => {
        if (field.type === 'text') {
          return (
            <Field key={field.key} label={field.label}>
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
            <Field key={field.key} label={field.label}>
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
        const room = (field.maxCount ?? 1) - cited.length
        return (
          <Field key={field.key} label={field.label}>
            {() => (
              <div className="flex flex-col gap-2">
                {cited.map((attachmentId) => (
                  <div
                    key={attachmentId}
                    className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                  >
                    <span className="truncate">{nameOf(attachmentId)}</span>
                    {!disabled && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setField(
                            field.key,
                            cited.filter((id) => id !== attachmentId),
                          )
                        }
                      >
                        {format(m.entryFileRemove)}
                      </Button>
                    )}
                  </div>
                ))}
                {!disabled && room > 0 && (
                  <FilePick
                    accept={field.accept}
                    busy={uploading === field.key}
                    label={format(uploading === field.key ? m.entryFileUploading : m.entryFilePick)}
                    onPick={async (file) => {
                      setUploadError(null)
                      setUploading(field.key)
                      try {
                        const done = await uploadFile(doors, where, file)
                        setUploaded((previous) => ({ ...previous, [done.attachmentId]: done }))
                        setField(field.key, [...cited, done.attachmentId])
                      } catch {
                        setUploadError(format(m.entryFileFailed))
                      } finally {
                        setUploading(null)
                      }
                    }}
                  />
                )}
                {uploadError !== null && uploading === null && (
                  <p className="text-sm text-destructive">{uploadError}</p>
                )}
              </div>
            )}
          </Field>
        )
      })}
    </div>
  )
}

function FilePick({
  accept,
  busy,
  label,
  onPick,
}: {
  accept?: readonly string[] | undefined
  busy: boolean
  label: string
  onPick: (file: File) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <div>
      <input
        ref={input}
        type="file"
        className="hidden"
        accept={accept?.join(',')}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) onPick(file)
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        {label}
      </Button>
    </div>
  )
}
