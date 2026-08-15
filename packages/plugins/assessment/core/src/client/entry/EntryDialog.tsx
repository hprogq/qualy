import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useApi, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import type { MessageDescriptor } from '@qualy/i18n-contract'
import { Feedback, Field, FormDialog } from '@qualy/ui/admin'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { Textarea } from '@qualy/ui/textarea'
import { assessmentApi } from '../api.ts'
import { entryRefusalMessage } from './refusals.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { Basis } from './Basis.tsx'
import { EvidenceForm, type EvidencePayload } from './EvidenceForm.tsx'
import { chainLength, eachWorth, roomLeft } from './standing.ts'
import { fieldsOf, trimAmount, type EntryDto, type ItemDto } from './model.ts'

// Filing or revising one claim, without leaving the question it belongs to.
//
// The form is whatever the administrator composed; this adds the note, the
// terms of the question beside it, and the two ways out - keep it as a draft,
// or hand it to the first reviewer. Both are one press, because a claim saved
// but not submitted is the common case and should not need explaining.

/** the payload refusals the driver can raise, as sentences about one field */
const ISSUE_SENTENCES: Record<string, MessageDescriptor> = {
  required: m.entryIssueRequired,
  'out-of-range': m.entryIssueOutOfRange,
  'not-a-date': m.entryIssueNotADate,
  'too-long': m.entryIssueTooLong,
  'too-many': m.entryIssueTooMany,
  'attachment-too-large': m.entryIssueFileTooLarge,
  'attachment-type': m.entryIssueFileType,
  'attachment-not-found': m.entryIssueFileMissing,
  'attachment-retired': m.entryIssueFileMissing,
  'attachment-not-yours': m.entryIssueFileNotYours,
  'attachment-cross-entry': m.entryIssueFileElsewhere,
  'duplicate-attachment': m.entryIssueFileElsewhere,
}

export function EntryDialog({
  open,
  batchId,
  materialRange,
  participantId,
  item,
  entry,
  trail,
  siblings,
  onClose,
  onSaved,
}: {
  /** false while it animates shut; it keeps drawing what it was showing */
  open: boolean
  batchId: string
  /** the round's window, so a date picker cannot offer a day this round refuses */
  materialRange: { start: string; end: string }
  /** the caller's own membership row, from the my-entries read */
  participantId: string
  item: ItemDto
  entry: EntryDto | null
  /** the sections above the question, so the modal says where it is */
  trail: readonly string[]
  /** what this person has already put into this question, to not repeat it */
  siblings: readonly EntryDto[]
  onClose: () => void
  onSaved: () => void
}) {
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const { format, formatError } = useI18n()
  const [payload, setPayload] = useState<EvidencePayload>(
    () => (entry?.currentRevision?.payload as EvidencePayload | null) ?? {},
  )
  const [note, setNote] = useState(entry?.currentRevision?.note ?? '')
  const [problem, setProblem] = useState<string | null>(null)
  const [issues, setIssues] = useState<readonly { field: string; reason: string }[]>([])

  const fields = fieldsOf(item.currentRevision?.formConfig)
  const labelOf = (key: string) => fields.find((field) => field.key === key)?.label ?? key
  const each = eachWorth(item)
  const steps = chainLength(item)
  const room = roomLeft(item, siblings)

  const doors = {
    prepare: (input: {
      batchId: string
      itemId: string
      filename: string
      declaredMime: string
      size: string
    }) => run(api.assessment.prepareAttachmentUpload({ payload: input })),
    complete: (reservationId: string) =>
      run(api.assessment.completeAttachmentUpload({ params: { reservationId } })),
  }

  /**
   * Writing it down, and then - if that is what was asked for - handing it on.
   *
   * Submitting is two calls because the round keeps them separate: a claim
   * exists before anybody is asked to look at it. Doing them in one press is
   * this screen's job, not the reader's.
   */
  const save = useMutation({
    mutationFn: async (andSubmit: boolean) => {
      const body = { payload, ...(note.trim() === '' ? {} : { note: note.trim() }) }
      const saved =
        entry === null
          ? await run(
              api.assessment.createEntry({ payload: { itemId: item.id, participantId, ...body } }),
            )
          : await run(api.assessment.reviseEntry({ params: { entryId: entry.id }, payload: body }))
      if (!andSubmit) return saved
      const entryId = (saved as { entry?: { id?: string } }).entry?.id ?? entry?.id
      if (entryId === undefined) return saved
      return run(
        api.assessment.setEntryStatus({
          params: { entryId },
          payload: { status: 'in_review' },
        }),
      )
    },
    onMutate: () => {
      setProblem(null)
      setIssues([])
    },
    onSuccess: onSaved,
    onError: (error: unknown) => {
      const raised = error as { issues?: readonly { field: string; reason: string }[] }
      if (Array.isArray(raised.issues)) setIssues(raised.issues)
      const refusal = entryRefusalMessage(error)
      setProblem(refusal === null ? formatError(error) : format(refusal))
    },
  })

  return (
    <FormDialog
      open={open}
      size="wide"
      title={
        <span className="flex flex-wrap items-center gap-2.5">
          {entry === null
            ? format(m.entryNth, {
                n: siblings.filter((one) => one.status !== 'voided').length + 1,
              })
            : format(m.entryEdit)}
          {each !== undefined && (
            <Badge variant="secondary" className="font-normal">
              {format(m.entryCountsFor, { value: trimAmount(each) })}
            </Badge>
          )}
        </span>
      }
      description={[...trail, item.title].join(' › ')}
      onClose={onClose}
      footer={
        <div className="flex w-full flex-wrap items-center gap-3">
          <p className="text-xs text-muted-foreground">{format(m.entryDraftKept)}</p>
          <span className="flex-1" />
          <Button variant="outline" disabled={save.isPending} onClick={() => save.mutate(false)}>
            {format(m.entrySaveDraft)}
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate(true)}>
            {format(m.entrySubmit)}
          </Button>
        </div>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <EvidenceForm
            fields={fields}
            value={payload}
            onChange={setPayload}
            doors={doors}
            where={{ batchId, itemId: item.id }}
            materialRange={materialRange}
          />
          <Field label={format(m.entryNote)}>
            {(id) => (
              <Textarea id={id} value={note} onChange={(event) => setNote(event.target.value)} />
            )}
          </Field>
          <Feedback message={problem} />
          {issues.length > 0 && (
            <ul className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
              {issues.map((issue, index) => (
                <li key={index}>
                  {labelOf(issue.field)}{' '}
                  {format(ISSUE_SENTENCES[issue.reason] ?? m.entryIssueOther)}
                </li>
              ))}
            </ul>
          )}
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          <Basis compact />

          {siblings.length > 0 && (
            <div className="flex flex-col gap-2 rounded-xl border p-4">
              <p className="text-sm font-semibold">{format(m.entryAlreadyFiled)}</p>
              {siblings.map((one) => (
                <p key={one.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span
                    aria-hidden
                    className="size-1.5 shrink-0 rounded-full bg-muted-foreground/60"
                  />
                  <span className="truncate">{summary(one, item)}</span>
                </p>
              ))}
              <p className="border-t pt-2 text-xs leading-relaxed text-muted-foreground">
                {format(m.entryNoDuplicates)}
                {room !== null && room <= 1 && entry === null && ` ${format(m.entryLastRoom)}`}
              </p>
            </div>
          )}

          {steps > 0 && (
            <div className="flex flex-col gap-2.5 rounded-xl border p-4">
              <p className="text-sm font-semibold">{format(m.entryFlow)}</p>
              {/* Who each step lands on is the round's business and not this
                  reader's to be told - the roles are named nowhere they can
                  read. How many hands it passes through before it counts is
                  what changes whether they submit now. */}
              {Array.from({ length: steps }, (_, index) => (
                <span key={index} className="flex items-center gap-2 text-xs">
                  <span
                    aria-hidden
                    className="flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-[0.625rem] font-medium"
                  >
                    {index + 1}
                  </span>
                  {format(m.entryFlowStep, { n: index + 1 })}
                </span>
              ))}
              <p className="text-xs leading-relaxed text-muted-foreground">
                {format(m.entryFlowNote)}
              </p>
            </div>
          )}
        </aside>
      </div>
    </FormDialog>
  )
}

const summary = (entry: EntryDto, item: ItemDto): string => {
  const fields = fieldsOf(item.currentRevision?.formConfig)
  const payload = (entry.currentRevision?.payload ?? {}) as Record<string, unknown>
  const said = fields
    .map((field) => payload[field.key])
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
  return said.length === 0 ? item.title : said.join('　')
}
