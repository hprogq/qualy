import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { DownloadIcon, FileTextIcon, UploadIcon, XIcon } from 'lucide-react'
import { useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { entryRefusalMessage } from './refusals.ts'
import { parseDecimal } from '@qualy/value-schema'
import { VisuallyHidden } from '@qualy/ui/visually-hidden'
import { Button } from '@qualy/ui/button'
import { DatePicker } from '@qualy/ui/date-picker'
import { usePickerWords } from '@qualy/web-i18n/picker-words'
import { Choice } from '../items/Choice.tsx'
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
  offeredOptions,
} from './model.ts'

// The form an administrator composed, drawn field by field. The page hands
// in the item's form configuration and gets back exactly the payload shape
// the server's driver reads: text and dates as strings, attachments as the
// ids of files this person just put in or already cited.

const styles = stylex.create({
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

/**
 * One field's answer in a payload: its own, never something every object
 * inherits. A field keyed `constructor` read the plain way found `Object`,
 * and the attachment list crashed the whole form trying to map it.
 */
const own = (record: Record<string, unknown>, key: string): unknown =>
  Object.hasOwn(record, key) ? record[key] : undefined

export interface EvidenceFieldSpec {
  /** what this field is called across versions of the form; older forms have none */
  readonly id?: string
  readonly key: string
  readonly type: 'text' | 'date' | 'integer' | 'decimal' | 'choice' | 'boolean' | 'attachment'
  readonly label: string
  /** the administrator's words under the field on how to fill it in */
  readonly description?: string
  readonly required?: boolean
  readonly minLength?: number
  readonly maxLength?: number
  readonly pattern?: string
  /** integer bounds arrive as numbers; date and decimal bounds as strings */
  readonly min?: string | number
  readonly max?: string | number
  /** date only: whether the round's material window binds this field too */
  readonly inMaterialRange?: boolean
  readonly maxScale?: number
  readonly options?: readonly EvidenceChoiceOptionSpec[]
  readonly maxCount?: number
  /** the largest one file may be; the round's own rule, in bytes */
  readonly maxFileBytes?: number
  readonly accept?: readonly string[]
}

/** one option as the form receives it; a retired one keeps its words and is not offered */
export interface EvidenceChoiceOptionSpec {
  readonly id?: string
  readonly value: string
  readonly label: string
  readonly enabled?: boolean
}

/** the options a new filing may pick from: everything not retired */
export type EvidencePayload = Record<string, string | number | boolean | readonly string[]>

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

/**
 * A number mid-edit: "", "-", "1." are legitimate keyboards-worth of state
 * that no payload may carry. The draft lives here; only a lexically whole
 * value is written through, and a draft that will not materialize keeps its
 * key OUT of the payload while reporting the form invalid - because for an
 * optional field, "invalid" quietly read as "omitted" is how a typo submits
 * as an empty answer.
 */
const INTEGER_DRAFT = /^-?\d+$/

/**
 * The pick that un-answers an optional choice.
 *
 * The product's select has no empty row, so a field nobody has to answer
 * offers its unanswered state as a choice of its own; it never reaches the
 * payload, it only takes the key back out.
 */
const UNANSWERED = '\u0000unanswered'

/**
 * The words under a field: what the administrator wrote for it, and after
 * that whatever the field's own rule has to say - a date's window, say.
 * The two are one line each; a field with neither has no hint at all.
 */
const hintOf = (field: EvidenceFieldSpec, rule?: string): string | undefined => {
  const said = [field.description?.trim() ?? '', rule ?? ''].filter((one) => one !== '')
  return said.length === 0 ? undefined : said.join(' ')
}

export function EvidenceForm({
  session,
  fields,
  value,
  onChange,
  doors,
  where,
  materialRange,
  knownFiles = {},
  disabled = false,
  onValidityChange,
}: {
  /**
   * Whose sheet this is. The form holds local state the payload does not -
   * numeric drafts, upload leftovers - and the caller's payload reset alone
   * cannot clear it; a stale "5" would keep rendering over an empty payload
   * and file on the next save. Any change here wipes every local trace, so
   * the identity must name everything a sheet is about (at least the item
   * revision, plus the subject where one form serves many people).
   */
  session: string
  fields: readonly EvidenceFieldSpec[]
  value: EvidencePayload
  onChange: (next: EvidencePayload) => void
  doors: UploadDoors
  where: { batchId: string; itemId: string }
  /** the round's window; what the server will accept is this ∩ the field's own */
  materialRange?: { start: string; end: string } | undefined
  knownFiles?: KnownFiles
  disabled?: boolean
  /** false while any draft cannot materialize; submit gates listen here */
  onValidityChange?: (valid: boolean) => void
}) {
  const { format, formatError, locale } = useI18n()
  const words = usePickerWords()
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

  /**
   * The payload as it stands right now, for a write that lands later.
   *
   * An upload finishes long after the drop that began it, and the handler
   * closes over the render it was made in - so writing the whole payload
   * back from that render erased everything typed while the bytes were in
   * flight. Reads, never renders from: what draws is `value`.
   */
  const latest = useRef(value)
  latest.current = value

  const setField = (key: string, next: EvidencePayload[string]) =>
    onChange({ ...value, [key]: next })
  const dropField = (key: string) => {
    const { [key]: gone, ...rest } = value
    void gone
    onChange(rest)
  }

  // numeric drafts, per field: what is typed, not yet what is filed
  const [numberDrafts, setNumberDrafts] = useState<Record<string, string>>({})

  // a new session wipes every local trace during this very render (the
  // sanctioned derived-state reset): nothing typed for the previous item
  // revision or the previous person may survive into this sheet
  const lastSession = useRef(session)
  if (lastSession.current !== session) {
    lastSession.current = session
    setNumberDrafts({})
    setUploaded({})
    setUploading(null)
    setUploadError(null)
    setTurnedAway(null)
  }
  const draftInvalid = (field: EvidenceFieldSpec, draft: string): boolean => {
    const trimmed = draft.trim()
    if (trimmed === '') return false
    if (field.type === 'integer')
      return !INTEGER_DRAFT.test(trimmed) || !Number.isSafeInteger(Number(trimmed))
    return parseDecimal(trimmed) === null
  }
  const invalidDrafts = fields.filter((field) => {
    if (field.type !== 'integer' && field.type !== 'decimal') return false
    const draft = numberDrafts[field.key]
    return draft !== undefined && draftInvalid(field, draft)
  })
  const valid = invalidDrafts.length === 0
  const reportedValid = useRef<boolean | null>(null)
  useEffect(() => {
    if (reportedValid.current === valid) return
    reportedValid.current = valid
    onValidityChange?.(valid)
  }, [valid, onValidityChange])

  const numberField = (field: EvidenceFieldSpec) => {
    const stored = own(value, field.key)
    const draft = numberDrafts[field.key] ?? (stored === undefined ? '' : String(stored))
    const invalid = draftInvalid(field, draft)
    return (
      <Field
        key={field.key}
        label={field.label}
        required={field.required === true}
        hint={invalid ? format(m.entryNumberUnreadable) : hintOf(field)}
      >
        {(id) => (
          <Input
            id={id}
            value={draft}
            disabled={disabled}
            inputMode={field.type === 'integer' ? 'numeric' : 'decimal'}
            aria-invalid={invalid ? true : undefined}
            onChange={(event) => {
              const next = event.target.value
              setNumberDrafts((current) => ({ ...current, [field.key]: next }))
              const trimmed = next.trim()
              if (trimmed === '') {
                dropField(field.key)
                return
              }
              if (draftInvalid(field, next)) {
                // the key leaves the payload but the form says why: a typo
                // must block the submit, never read as "left blank"
                dropField(field.key)
                return
              }
              setField(field.key, field.type === 'integer' ? Number(trimmed) : trimmed)
            }}
          />
        )}
      </Field>
    )
  }

  return (
    <div {...stylex.props(styles.form)}>
      {fields.map((field) => {
        if (field.type === 'text') {
          return (
            <Field
              key={field.key}
              label={field.label}
              required={field.required === true}
              hint={hintOf(field)}
            >
              {(id) => (
                <Input
                  id={id}
                  value={(own(value, field.key) as string | undefined) ?? ''}
                  maxLength={field.maxLength}
                  disabled={disabled}
                  onChange={(event) => setField(field.key, event.target.value)}
                />
              )}
            </Field>
          )
        }
        if (field.type === 'boolean') {
          // Three states, not two: an optional yes-or-no left alone is
          // unanswered, and a switch has no way to say so. '' is the
          // unanswered state and leaves the payload, like an unpicked choice.
          const held = own(value, field.key)
          const chosen = held === true ? 'true' : held === false ? 'false' : ''
          return (
            <Field
              key={field.key}
              label={field.label}
              required={field.required === true}
              hint={hintOf(field)}
            >
              {(id) => (
                <Choice
                  id={id}
                  value={chosen}
                  disabled={disabled}
                  placeholder={words.unanswered}
                  options={[
                    ...(field.required === true
                      ? []
                      : [{ value: UNANSWERED, label: words.unanswered }]),
                    { value: 'true', label: format(m.recognitionYes) },
                    { value: 'false', label: format(m.recognitionNo) },
                  ]}
                  onChange={(next) => {
                    if (next === UNANSWERED) dropField(field.key)
                    else setField(field.key, next === 'true')
                  }}
                />
              )}
            </Field>
          )
        }
        if (field.type === 'date') {
          // The picker offers exactly what the server will take: the field's
          // own bounds, narrowed by the round's material window only where
          // the question answers to it. A question about when somebody
          // enrolled is true outside the window, and a picker that refused
          // those days taught people to file the wrong date.
          const bounded = field.inMaterialRange === true && materialRange !== undefined
          const floor = [field.min, bounded ? materialRange.start : undefined]
            .filter((day): day is string => Boolean(day))
            .sort()
            .at(-1)
          const ceiling = [field.max, bounded ? lastDay(materialRange.end) : undefined]
            .filter((day): day is string => Boolean(day))
            .sort()
            .at(0)
          const window =
            floor === undefined || ceiling === undefined
              ? undefined
              : format(m.entryDateWithin, { start: floor, end: ceiling })
          return (
            <Field
              key={field.key}
              label={field.label}
              required={field.required === true}
              hint={hintOf(field, window)}
            >
              {(id) => (
                <DatePicker
                  id={id}
                  value={(own(value, field.key) as string | undefined) ?? null}
                  min={floor === undefined ? undefined : String(floor)}
                  max={ceiling === undefined ? undefined : String(ceiling)}
                  disabled={disabled}
                  placeholder={words.unanswered}
                  {...(field.required === true ? {} : { clearLabel: words.clear })}
                  localeTag={locale}
                  monthLabel={words.month}
                  yearLabel={words.year}
                  onChange={(next) => {
                    if (next === null) dropField(field.key)
                    else setField(field.key, next)
                  }}
                />
              )}
            </Field>
          )
        }

        if (field.type === 'integer' || field.type === 'decimal') {
          return numberField(field)
        }

        if (field.type === 'choice') {
          const chosen =
            typeof own(value, field.key) === 'string' ? (own(value, field.key) as string) : ''
          const offered = offeredOptions(field)
          // an answer naming an option since retired stays readable: it is
          // listed, disabled, so the words are there and nobody re-picks it
          const retired = (field.options ?? []).find(
            (option) => option.value === chosen && option.enabled === false,
          )
          return (
            <Field
              key={field.key}
              label={field.label}
              required={field.required === true}
              hint={hintOf(field)}
            >
              {(id) => (
                <Choice
                  id={id}
                  value={chosen}
                  disabled={disabled}
                  placeholder={words.unanswered}
                  options={[
                    ...(field.required === true
                      ? []
                      : [{ value: UNANSWERED, label: words.unanswered }]),
                    ...offered.map((option) => ({ value: option.value, label: option.label })),
                    ...(retired === undefined
                      ? []
                      : [{ value: retired.value, label: retired.label, disabled: true }]),
                  ]}
                  onChange={(next) => {
                    // unanswered takes the key out of the payload rather
                    // than filing an empty string as a chosen value
                    if (next === UNANSWERED) dropField(field.key)
                    else setField(field.key, next)
                  }}
                />
              )}
            </Field>
          )
        }

        const cited = (own(value, field.key) as readonly string[] | undefined) ?? []
        const kinds = fileKindLabels(field.accept, (family) =>
          format(
            family === 'image'
              ? m.fileKindImage
              : family === 'video'
                ? m.fileKindVideo
                : family === 'audio'
                  ? m.fileKindAudio
                  : m.fileKindText,
          ),
        )
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
          } catch (error) {
            // the round's own refusal, when it gave one: a file too large
            // for this field, a type it does not take, a quota reached. The
            // bare catch threw all ten of them away and said "try again",
            // which is advice that cannot work.
            const refusal = entryRefusalMessage(error)
            setUploadError(refusal === null ? formatError(error) : format(refusal))
          } finally {
            setUploading(null)
            if (landed.length > 0) {
              // read the payload as it stands now, not as it stood at the drop
              const current = latest.current
              const already = current[field.key]
              onChange({
                ...current,
                [field.key]: [...(Array.isArray(already) ? (already as string[]) : []), ...landed],
              })
            }
          }
        }

        return (
          <Field
            key={field.key}
            label={field.label}
            required={field.required === true}
            hint={hintOf(field)}
          >
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
              <VisuallyHidden>{name}</VisuallyHidden>
            </a>
          </Button>
          {onRemove !== undefined && (
            <Button variant="ghost" size="icon-sm" type="button" onClick={onRemove}>
              <XIcon aria-hidden />
              <VisuallyHidden>{format(m.entryFileRemove)}</VisuallyHidden>
            </Button>
          )}
        </>
      }
    />
  )
}
