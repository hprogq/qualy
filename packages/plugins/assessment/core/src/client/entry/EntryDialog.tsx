import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useApi, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import type { MessageDescriptor } from '@qualy/i18n-contract'
import { ConfirmDialog, Feedback, Field, FormDialog } from '@qualy/ui/admin'
import { RefreshCwIcon } from 'lucide-react'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { Textarea } from '@qualy/ui/textarea'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@qualy/ui/tooltip'
import { assessmentApi } from '../api.ts'
import { entryRefusalMessage, entryRefusalReason } from './refusals.ts'
import { toast } from '@qualy/ui/toast'
import { assessmentMessages as m } from '../i18n.ts'
import { Basis } from './Basis.tsx'
import { EvidenceForm, type EvidencePayload } from './EvidenceForm.tsx'
import { carryPayload, chainNamesOf, eachWorth, roomLeft } from './standing.ts'
import {
  fieldsOf,
  trimAmount,
  type ActionAvailability,
  type EntryDto,
  type ItemDto,
} from './model.ts'

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
  submitGate,
  trail,
  siblings,
  onClose,
  onSaved,
  onStale,
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
  /**
   * The phase gate's word on submitting into this question: a phase may
   * take drafts without taking submissions, and then the handing-on half
   * of this footer is shut with its reason, not a refusal after the work.
   */
  submitGate: ActionAvailability | undefined
  /** the sections above the question, so the modal says where it is */
  trail: readonly string[]
  /** what this person has already put into this question, to not repeat it */
  siblings: readonly EntryDto[]
  onClose: () => void
  onSaved: () => void
  /** ask the page for the item again; the fresh one arrives as a new prop */
  onStale?: () => void
}) {
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const { format, formatError } = useI18n()
  const [payload, setPayload] = useState<EvidencePayload>(
    () => (entry?.currentRevision?.payload as EvidencePayload | null) ?? {},
  )
  const [note, setNote] = useState(entry?.currentRevision?.note ?? '')
  const [problem, setProblem] = useState<string | null>(null)
  // handing it on waits on an answer; keeping a draft does not
  const [asking, setAsking] = useState(false)
  const [issues, setIssues] = useState<readonly { field: string; reason: string }[]>([])
  /**
   * The question as this dialog drew it, held still.
   *
   * The page goes on refetching underneath - it must, the claim is saved
   * through it - and a form that swapped its fields mid-sentence would be
   * changing the question while somebody answers it. So the fields come
   * from this snapshot, and the snapshot only advances when the reader asks
   * for it.
   */
  const [asked, setAsked] = useState(item)
  const [stale, setStale] = useState(false)
  const [awaiting, setAwaiting] = useState(false)
  const notice = useRef<HTMLDivElement | null>(null)

  const fields = fieldsOf(asked.currentRevision?.formConfig)
  const labelOf = (key: string) => fields.find((field) => field.key === key)?.label ?? key
  const each = eachWorth(asked)
  const chain = chainNamesOf(asked)
  const room = roomLeft(asked, siblings)
  // an absent word from the server is not a shut gate; only a spoken refusal is
  const submitShut = submitGate !== undefined && submitGate.state !== 'available'
  const submitWhy = submitGate?.reason == null ? null : entryRefusalReason(submitGate.reason)

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
      // every call names the question this screen was drawn from, submission
      // included: handing it on is a decision about the rules in front of
      // the person pressing, not about the ones the draft was written under
      const seen = asked.currentRevision?.id
      const body = {
        payload,
        ...(seen === undefined ? {} : { expectedItemRevisionId: seen }),
        ...(note.trim() === '' ? {} : { note: note.trim() }),
      }
      const saved =
        entry === null
          ? await run(
              api.assessment.createEntry({ payload: { itemId: asked.id, participantId, ...body } }),
            )
          : await run(api.assessment.reviseEntry({ params: { entryId: entry.id }, payload: body }))
      if (!andSubmit) return saved
      const entryId = (saved as { entry?: { id?: string } }).entry?.id ?? entry?.id
      if (entryId === undefined) return saved
      return run(
        api.assessment.setEntryStatus({
          params: { entryId },
          payload: {
            status: 'in_review',
            ...(seen === undefined ? {} : { expectedItemRevisionId: seen }),
          },
        }),
      )
    },
    onMutate: () => {
      setProblem(null)
      setIssues([])
    },
    // which of its two jobs the press did: kept a draft, or handed it on
    onSuccess: (_result, andSubmit) => {
      toast.success(format(andSubmit ? m.entrySubmittedToast : m.entryDraftSavedToast))
      onSaved()
    },
    onError: (error: unknown) => {
      // The question moved while this was being written. Nothing was saved
      // and nothing here is thrown away: the dialog says so where the work
      // is, and the way on is the reader's press, not a reload.
      if ((error as { _tag?: string })._tag === 'ASSESSMENT_ITEM_REVISION_CONFLICT') {
        setStale(true)
        onStale?.()
        return
      }
      const raised = error as { issues?: readonly { field: string; reason: string }[] }
      if (Array.isArray(raised.issues)) setIssues(raised.issues)
      const refusal = entryRefusalMessage(error)
      setProblem(refusal === null ? formatError(error) : format(refusal))
    },
  })

  /** show the new question, keeping every answer the new form still asks for */
  const adopt = (fresh: ItemDto) => {
    setPayload((held) => carryPayload(asked, fresh, held))
    setAsked(fresh)
    setStale(false)
    setAwaiting(false)
    toast.info(format(m.entryRulesRefreshed))
  }

  // the page answered the refetch: if it brought a different question, and
  // the reader asked to see it, this is the moment it arrives
  useEffect(() => {
    if (!awaiting) return
    if (item.currentRevision?.id === asked.currentRevision?.id) return
    adopt(item)
    // adopt closes over this render's snapshot on purpose: it is the form
    // the held answers were written against
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaiting, item])

  // The wake-up path: the page under this dialog re-reads the questions on
  // its own, so a changed requirement arrives here as a new prop long
  // before any save is pressed. Mark - never adopt: the form holds still
  // until its reader asks, exactly as when the server says 409.
  const askedRevision = asked.currentRevision?.id
  const liveRevision = item.currentRevision?.id
  useEffect(() => {
    if (!stale && !awaiting && liveRevision !== askedRevision) setStale(true)
  }, [stale, awaiting, liveRevision, askedRevision])

  // the notice is worth nothing unmet: the body may be scrolled anywhere
  // when the press comes back refused
  useEffect(() => {
    if (stale) notice.current?.scrollIntoView({ block: 'nearest' })
  }, [stale])

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
      description={[...trail, asked.title].join(' › ')}
      onClose={onClose}
      footer={
        <div className="flex w-full flex-wrap items-center gap-3">
          <p className="text-xs text-muted-foreground">{format(m.entryDraftKept)}</p>
          <span className="flex-1" />
          {/* while the question is out of date both ways out are shut: either
              would file an answer under rules its author has not seen */}
          <Button
            variant="outline"
            disabled={save.isPending || stale}
            onClick={() => save.mutate(false)}
          >
            {format(m.entrySaveDraft)}
          </Button>
          {/* a phase may take drafts without taking submissions; then this
              half is shut with its reason on hover, and the draft half works */}
          {submitShut ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0}>
                    <Button
                      data-testid="save-and-submit"
                      data-gate={submitGate?.state}
                      disabled
                      className="pointer-events-none"
                    >
                      {format(m.entrySaveAndSubmit)}
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{format(submitWhy ?? m.entryBlockedNow)}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <Button
              data-testid="save-and-submit"
              disabled={save.isPending || stale}
              onClick={() => setAsking(true)}
            >
              {format(m.entrySaveAndSubmit)}
            </Button>
          )}
        </div>
      }
    >
      {/* Above the work and never over it: what has been typed stays on
          screen and stays in state, and the only press that changes the
          form is the reader's own. */}
      {stale && (
        <div
          ref={notice}
          data-testid="rules-changed"
          className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3.5 dark:border-amber-900/50 dark:bg-amber-950/25"
        >
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-sm font-medium text-amber-950 dark:text-amber-100">
              {format(m.entryRulesChangedTitle)}
            </p>
            <p className="text-[13px] leading-relaxed text-amber-900/80 dark:text-amber-200/70">
              {format(m.entryRulesChangedBody)}
            </p>
          </div>
          <span className="flex-1" />
          <Button
            variant="outline"
            size="sm"
            className="border-amber-300 bg-transparent text-amber-950 hover:bg-amber-100/60 dark:border-amber-800 dark:text-amber-100 dark:hover:bg-amber-900/40"
            disabled={awaiting}
            onClick={() => {
              if (item.currentRevision?.id !== asked.currentRevision?.id) adopt(item)
              else {
                setAwaiting(true)
                onStale?.()
              }
            }}
          >
            <RefreshCwIcon aria-hidden className={awaiting ? 'animate-spin' : undefined} />
            {format(m.entryRulesChangedAction)}
          </Button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <EvidenceForm
            fields={fields}
            value={payload}
            onChange={setPayload}
            doors={doors}
            where={{ batchId, itemId: asked.id }}
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

          {chain.normal.length > 0 && (
            <div className="flex flex-col gap-2.5 rounded-xl border p-4">
              <p className="text-sm font-semibold">{format(m.entryFlow)}</p>
              {/* Steps by the names the administrator gave them, and only
                  the names: who each step lands on is the round's business
                  and not this reader's to be told. */}
              {chain.normal.map((label, index) => (
                <span key={index} className="flex items-center gap-2 text-xs">
                  <span
                    aria-hidden
                    className="flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-[0.625rem] font-medium"
                  >
                    {index + 1}
                  </span>
                  <span className="min-w-0">
                    {label ?? format(m.entryFlowStep, { n: index + 1 })}
                  </span>
                </span>
              ))}
              {chain.escalation.length > 0 && (
                <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-t pt-2 text-xs text-muted-foreground">
                  <span className="shrink-0">{format(m.reviewRouteEscalation)}</span>
                  <span className="min-w-0 leading-relaxed">
                    {chain.escalation
                      .map((label, index) => label ?? format(m.entryFlowStep, { n: index + 1 }))
                      .join(' → ')}
                  </span>
                </p>
              )}
              <p className="text-xs leading-relaxed text-muted-foreground">
                {format(m.entryFlowNote)}
              </p>
            </div>
          )}
        </aside>
      </div>

      {/* Handing it on is the act that takes the claim out of the writer's
          hands, so it is a question here as it is in the drawer - and the
          press behind it writes the claim down either way, so the question
          offers that on its own key rather than sending the reader back to
          the form to find it. */}
      <ConfirmDialog
        open={asking}
        title={format(m.entrySubmitConfirm)}
        description={format(m.entrySubmitConfirmHint)}
        confirmLabel={format(m.entrySaveThenSubmit)}
        otherLabel={format(m.entrySaveOnly)}
        cancelLabel={format(commonMessages.cancel)}
        pending={save.isPending}
        onCancel={() => setAsking(false)}
        onOther={() => {
          setAsking(false)
          save.mutate(false)
        }}
        onConfirm={() => {
          setAsking(false)
          save.mutate(true)
        }}
      />
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
