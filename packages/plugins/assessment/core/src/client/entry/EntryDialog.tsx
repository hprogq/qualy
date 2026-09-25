import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { useApi, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { ConfirmDialog, Feedback, Field, FormDialog } from '@qualy/ui/admin'
import { RefreshCwIcon } from 'lucide-react'
import { Button } from '@qualy/ui/button'
import { Textarea } from '@qualy/ui/textarea'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@qualy/ui/tooltip'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentApi } from '../api.ts'
import { entryRefusalMessage, entryRefusalReason } from './refusals.ts'
import { issueSentence } from './issues.ts'
import { toast } from '@qualy/ui/toast'
import { assessmentMessages as m } from '../i18n.ts'
import { Basis } from './Basis.tsx'
import { EntryStanding } from './EntryStanding.tsx'
import { EvidenceForm, type EvidencePayload } from './EvidenceForm.tsx'
import { carryPayload, chainNamesOf } from './standing.ts'
import { useCalcLine } from './workspace/calc.ts'
import {
  answerOf,
  displayValueOf,
  fieldsOf,
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

const lg = '@media (min-width: 1024px)'

const spin = stylex.keyframes({
  '100%': { transform: 'rotate(360deg)' },
})

const styles = stylex.create({
  footer: {
    display: 'flex',
    width: '100%',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
  },
  quietNote: {
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  // on a phone the two keys need the whole row: the standing reminder
  // gives way, a file still uploading does not
  quietIdle: {
    display: { default: 'block', '@media (max-width: 767.98px)': 'none' },
  },
  spacer: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  noPointer: {
    pointerEvents: 'none',
  },
  // Above the work and never over it: the standing colour carries the
  // warning, mixed over the scheme's own ground so both modes read it
  notice: {
    marginBottom: 20,
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 16,
    rowGap: 8,
    borderRadius: `calc(${tokens.radiusLg} + 4px)`,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: `color-mix(in oklab, ${tokens.warning} 35%, ${tokens.background})`,
    backgroundColor: `color-mix(in oklab, ${tokens.warning} 12%, ${tokens.background})`,
    paddingInline: 16,
    paddingBlock: 14,
  },
  noticeWords: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 2,
  },
  noticeTitle: {
    fontSize: 14,
    fontWeight: 500,
    color: tokens.foreground,
  },
  noticeBody: {
    fontSize: 13,
    lineHeight: 1.625,
    color: `color-mix(in oklab, ${tokens.foreground} 75%, transparent)`,
  },
  noticeButton: {
    borderColor: `color-mix(in oklab, ${tokens.warning} 45%, ${tokens.background})`,
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in oklab, ${tokens.warning} 20%, ${tokens.background})`,
    },
    color: {
      default: tokens.foreground,
      ':hover': tokens.foreground,
    },
  },
  spinning: {
    animationName: spin,
    animationDuration: '1s',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
  },
  body: {
    display: 'grid',
    gap: 24,
    gridTemplateColumns: {
      default: null,
      [lg]: 'minmax(0, 1fr) 16.5rem',
    },
  },
  form: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 20,
  },
  issueList: {
    borderRadius: tokens.radiusMd,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: `color-mix(in oklab, ${tokens.danger} 40%, transparent)`,
    padding: 12,
    fontSize: 14,
    color: tokens.danger,
  },
  // what was said when it came back: above the work, in the reader's hand
  returned: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    borderRadius: 12,
    backgroundColor: `color-mix(in oklab, ${tokens.warning} 12%, ${tokens.background})`,
    paddingInline: 14,
    paddingBlock: 12,
  },
  returnedHead: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  returnedTitle: { margin: 0, fontSize: 13.5, fontWeight: 600, color: tokens.warningForeground },
  returnedReason: {
    display: 'inline-flex',
    alignItems: 'center',
    height: 20,
    borderRadius: 6,
    backgroundColor: tokens.background,
    boxShadow: `inset 0 0 0 1px ${tokens.border}`,
    paddingInline: 7,
    fontSize: 12,
    color: tokens.surfaceMutedForeground,
  },
  returnedWords: {
    margin: 0,
    fontSize: 13.5,
    lineHeight: 1.6,
    overflowWrap: 'anywhere',
    whiteSpace: 'pre-line',
  },
  versionNote: { margin: 0, fontSize: 12.5, lineHeight: 1.6, color: tokens.mutedForeground },
  aside: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    alignSelf: 'start',
    overflow: 'hidden',
    borderRadius: 12,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 45%, ${tokens.background})`,
  },
  asideBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    paddingInline: 18,
    paddingBlock: 16,
  },
  asideRuled: {
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
  },
  asideLabel: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 6,
    margin: 0,
    fontSize: 12,
    fontWeight: 600,
    color: tokens.mutedForeground,
  },
  asideCount: { fontWeight: 400, fontVariantNumeric: 'tabular-nums' },
  asideStrong: { margin: 0, fontSize: 14, fontWeight: 500 },
  quotaLine: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
    fontSize: 12.5,
    fontVariantNumeric: 'tabular-nums',
  },
  quotaWord: { flexGrow: 1, color: tokens.mutedForeground },
  quotaValue: { fontWeight: 600 },
  bar: {
    display: 'flex',
    height: 4,
    overflow: 'hidden',
    borderRadius: 2,
    backgroundColor: tokens.surfaceMuted,
  },
  barFill: { borderRadius: 2, backgroundColor: tokens.foreground },
  filed: {
    display: 'flex',
    maxHeight: 216,
    flexDirection: 'column',
    overflowY: 'auto',
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  filedLine: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 8,
    minHeight: 30,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  filedWords: {
    minWidth: 0,
    flexGrow: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 13,
    color: tokens.surfaceMutedForeground,
  },
  asideFoot: {
    margin: 0,
    fontSize: 12.5,
    lineHeight: 1.6,
    color: tokens.mutedForeground,
  },
  steps: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  stepLine: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 },
  stepNo: {
    display: 'inline-flex',
    width: 20,
    height: 20,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9999,
    backgroundColor: tokens.background,
    boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${tokens.foreground} 14%, transparent)`,
    fontSize: 11,
    fontWeight: 600,
    color: tokens.surfaceMutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  stepName: { minWidth: 0 },
  escalationLine: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: 8,
    rowGap: 2,
    margin: 0,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  keepShort: {
    flexShrink: 0,
  },
  escalationSteps: {
    minWidth: 0,
    lineHeight: 1.625,
  },
})

type EntryDialogProps = {
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
  /** the claim was saved elsewhere since this opened; the page reads it again */
  onChangedElsewhere?: () => void
}

/**
 * The filing dialog, drawn afresh on every opening.
 *
 * The page keeps it mounted after it closes so it can animate out, and the
 * next opening of the same claim used to find the last one's state: the
 * version it was opened on, what it had written, what was typed. After a
 * save made elsewhere was refused, reopening to see the latest showed the
 * same old version and was refused again. Each opening now starts from the
 * claim as the page holds it at that moment.
 */
export function EntryDialog(props: EntryDialogProps) {
  const [opening, setOpening] = useState(0)
  const [wasOpen, setWasOpen] = useState(props.open)
  if (props.open !== wasOpen) {
    setWasOpen(props.open)
    if (props.open) setOpening((count) => count + 1)
  }
  return <EntryDialogBody key={opening} {...props} />
}

function EntryDialogBody({
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
  onChangedElsewhere,
}: EntryDialogProps) {
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const { format, formatError } = useI18n()
  const [payload, setPayload] = useState<EvidencePayload>(
    () => (entry?.currentRevision?.payload as EvidencePayload | null) ?? {},
  )
  // a half-typed number must hold the doors shut, not submit as omitted
  const [evidenceValid, setEvidenceValid] = useState(true)
  // a file still on its way up is not in the payload yet: both ways out wait
  const [uploading, setUploading] = useState(false)
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
  const calc = useCalcLine()
  const chain = chainNamesOf(asked)
  // what else stands under this question, and how many of its places are
  // taken - this claim's own included, where it already exists
  const filed = siblings.filter((one) => one.status !== 'voided')
  const used = filed.length + (entry === null ? 0 : 1)
  // handing it in again after it came back, rather than for the first time
  const resubmitting = entry !== null && entry.status !== 'draft'
  // What the reviewer suggested writing instead, field by field, for the
  // owner to apply by hand - the form never fills itself from it. Only the
  // fields it would change; a suggestion equal to what is filed says nothing.
  const suggested = entry?.refusal?.suggestedPayload
  const filedPayload = (entry?.currentRevision?.payload ?? {}) as Record<string, unknown>
  const advice: Record<string, string> = {}
  if (suggested !== null && typeof suggested === 'object' && suggested !== undefined) {
    const proposal = suggested as Record<string, unknown>
    for (const field of fields) {
      if (field.type === 'attachment' || !Object.hasOwn(proposal, field.key)) continue
      const proposed = answerOf(proposal, field.key)
      if (String(proposed ?? '') === String(answerOf(filedPayload, field.key) ?? '')) continue
      const said = displayValueOf(field, proposed, {
        yes: format(m.recognitionYes),
        no: format(m.recognitionNo),
      })
      if (said !== '') advice[field.key] = format(m.entriesAdvice, { value: said })
    }
  }

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
  // What this dialog has already written, when it wrote it and the handing
  // on then failed. Saving and submitting is two calls: the first one
  // succeeding and the second one refusing left a draft nobody could see
  // from here, and the next press created a SECOND one - or was refused for
  // using up the places, which is the first one talking.
  const [created, setCreated] = useState<string | null>(null)
  // The version of the claim this screen last saw: the one it was opened
  // on, or the one it wrote itself since. A save made meanwhile in another
  // tab is refused rather than written over, and this screen's own earlier
  // write never counts as somebody else's.
  const [openedOn] = useState(() => entry?.currentRevision?.id)
  const [lastWritten, setLastWritten] = useState<string | null>(null)

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
      const writing = entry?.id ?? created
      const drawn = lastWritten ?? openedOn
      const saved =
        writing === null || writing === undefined
          ? await run(
              api.assessment.createEntry({ payload: { itemId: asked.id, participantId, ...body } }),
            )
          : await run(
              api.assessment.reviseEntry({
                params: { entryId: writing },
                payload: {
                  ...body,
                  ...(drawn === undefined ? {} : { expectedEntryRevisionId: drawn }),
                },
              }),
            )
      const written = (
        saved as { entry?: { id?: string; currentRevision?: { id?: string } | null } }
      ).entry
      const entryId = written?.id ?? writing ?? null
      if (entryId !== null) setCreated(entryId)
      const handed = written?.currentRevision?.id
      if (handed !== undefined) setLastWritten(handed)
      if (!andSubmit) return saved
      if (entryId === null) return saved
      return run(
        api.assessment.setEntryStatus({
          params: { entryId },
          payload: {
            status: 'in_review',
            ...(seen === undefined ? {} : { expectedItemRevisionId: seen }),
            // exactly the version just written goes to the reviewers
            ...(handed === undefined ? {} : { expectedEntryRevisionId: handed }),
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
      // saved elsewhere meanwhile: the page reads the claim again, so the
      // next opening starts from the version that stands now
      const refused = error as { _tag?: string; reason?: string }
      if (
        refused._tag === 'ASSESSMENT_ENTRY_ACTION_REFUSED' &&
        refused.reason === 'entry-changed'
      ) {
        onChangedElsewhere?.()
      }
      const refusal = entryRefusalMessage(error)
      const said = refusal === null ? formatError(error) : format(refusal)
      // the write went through and the handing on did not: say so, or the
      // screen reads as though nothing was kept
      setProblem(
        entry === null && created !== null
          ? `${said} ${format(m.entrySubmitFailedDraftKept)}`
          : said,
      )
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
      whole
      size="wide"
      title={format(entry === null ? m.entriesNewTitle : m.entriesEditTitle)}
      description={[...trail, asked.title].join(' › ')}
      onClose={onClose}
      footer={
        <div {...stylex.props(styles.footer)}>
          <p
            {...stylex.props(styles.quietNote, !uploading && styles.quietIdle)}
            data-uploading={uploading || undefined}
          >
            {format(uploading ? m.entrySaveAfterUpload : m.entryDraftKept)}
          </p>
          <span {...stylex.props(styles.spacer)} />
          {/* while the question is out of date both ways out are shut: either
              would file an answer under rules its author has not seen */}
          <Button
            variant="outline"
            disabled={save.isPending || stale || !evidenceValid || uploading}
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
                      className={stylex.props(styles.noPointer).className}
                    >
                      {format(resubmitting ? m.entryResubmit : m.entrySaveAndSubmit)}
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{format(submitWhy ?? m.entryBlockedNow)}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <Button
              data-testid="save-and-submit"
              disabled={save.isPending || stale || !evidenceValid || uploading}
              onClick={() => setAsking(true)}
            >
              {format(resubmitting ? m.entryResubmit : m.entrySaveAndSubmit)}
            </Button>
          )}
        </div>
      }
    >
      {/* Above the work and never over it: what has been typed stays on
          screen and stays in state, and the only press that changes the
          form is the reader's own. */}
      {stale && (
        <div ref={notice} data-testid="rules-changed" {...stylex.props(styles.notice)}>
          <div {...stylex.props(styles.noticeWords)}>
            <p {...stylex.props(styles.noticeTitle)}>{format(m.entryRulesChangedTitle)}</p>
            <p {...stylex.props(styles.noticeBody)}>{format(m.entryRulesChangedBody)}</p>
          </div>
          <span {...stylex.props(styles.spacer)} />
          <Button
            variant="outline"
            size="sm"
            className={stylex.props(styles.noticeButton).className}
            disabled={awaiting}
            onClick={() => {
              if (item.currentRevision?.id !== asked.currentRevision?.id) adopt(item)
              else {
                setAwaiting(true)
                onStale?.()
              }
            }}
          >
            <RefreshCwIcon
              aria-hidden
              className={stylex.props(awaiting && styles.spinning).className}
            />
            {format(m.entryRulesChangedAction)}
          </Button>
        </div>
      )}

      <div {...stylex.props(styles.body)}>
        <div {...stylex.props(styles.form)}>
          {entry?.refusal != null &&
            (entry.status === 'needs_revision' || entry.status === 'rejected') && (
              <div data-testid="form-returned" {...stylex.props(styles.returned)}>
                <div {...stylex.props(styles.returnedHead)}>
                  <p {...stylex.props(styles.returnedTitle)}>
                    {format(
                      entry.refusal.kind === 'rejected'
                        ? m.entryRefusedTitle
                        : m.entryReturnedTitle,
                    )}
                  </p>
                  {entry.refusal.reason !== null && (
                    <span {...stylex.props(styles.returnedReason)}>{entry.refusal.reason}</span>
                  )}
                </div>
                {(entry.refusal.comment ?? '') !== '' && (
                  <p {...stylex.props(styles.returnedWords)}>{entry.refusal.comment}</p>
                )}
              </div>
            )}
          {entry !== null && entry.status !== 'draft' && entry.currentRevision !== null && (
            <p {...stylex.props(styles.versionNote)} data-testid="form-version">
              {format(m.entriesVersionNote, {
                now: entry.currentRevision.revisionNo,
                next: entry.currentRevision.revisionNo + 1,
              })}
            </p>
          )}
          <EvidenceForm
            advice={advice}
            session={asked.currentRevision?.id ?? asked.id}
            onValidityChange={setEvidenceValid}
            onBusyChange={setUploading}
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
            <ul {...stylex.props(styles.issueList)}>
              {issues.map((issue, index) => (
                <li key={index}>
                  {labelOf(issue.field)}{' '}
                  {format(
                    issueSentence(
                      issue.reason,
                      fields.find((field) => field.key === issue.field),
                    ),
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <aside {...stylex.props(styles.aside)} data-testid="form-aside">
          <Basis compact />
          <div {...stylex.props(styles.asideBlock)}>
            <p {...stylex.props(styles.asideLabel)}>{format(m.entriesScoring)}</p>
            <p {...stylex.props(styles.asideStrong)}>{calc(asked)}</p>
            {asked.maxEntries !== null && (
              <>
                <div {...stylex.props(styles.quotaLine)} data-testid="form-quota" data-used={used}>
                  <span {...stylex.props(styles.quotaWord)}>{format(m.myEntriesQuota)}</span>
                  <span {...stylex.props(styles.quotaValue)}>
                    {used} / {asked.maxEntries}
                  </span>
                </div>
                <span {...stylex.props(styles.bar)}>
                  <span
                    {...stylex.props(styles.barFill)}
                    style={{
                      width: `${Math.min(100, (used / Math.max(1, asked.maxEntries)) * 100)}%`,
                    }}
                  />
                </span>
                {/* what is left once this one is kept, for a new claim */}
                {entry === null && (
                  <p {...stylex.props(styles.asideFoot)} data-testid="form-room">
                    {format(m.entriesRoomAfter, {
                      count: Math.max(0, asked.maxEntries - used - 1),
                    })}
                  </p>
                )}
              </>
            )}
          </div>

          <div {...stylex.props(styles.asideBlock, styles.asideRuled)}>
            <p {...stylex.props(styles.asideLabel)}>
              {format(m.entryAlreadyFiled)}
              <span {...stylex.props(styles.asideCount)}>
                {format(m.entriesFiledShort, { count: filed.length })}
              </span>
            </p>
            {filed.length === 0 ? (
              <p {...stylex.props(styles.asideFoot)}>{format(m.entriesNoneFiled)}</p>
            ) : (
              <ul {...stylex.props(styles.filed)}>
                {filed.map((one) => (
                  <li key={one.id} {...stylex.props(styles.filedLine)}>
                    <span {...stylex.props(styles.filedWords)}>{summary(one, item)}</span>
                    <EntryStanding
                      status={one.status}
                      source={one.source}
                      revised={one.currentReviewInstanceId !== null}
                      asked={one.supplement !== null}
                      openRound={one.openRound}
                    />
                  </li>
                ))}
              </ul>
            )}
            <p {...stylex.props(styles.asideFoot)}>{format(m.entryNoDuplicates)}</p>
          </div>

          {chain.normal.length > 0 && (
            <div {...stylex.props(styles.asideBlock, styles.asideRuled)}>
              <p {...stylex.props(styles.asideLabel)}>{format(m.entriesAfterSubmit)}</p>
              {/* Steps by the names the administrator gave them, and only
                  the names: who each step lands on is the round's business
                  and not this reader's to be told. */}
              <ol {...stylex.props(styles.steps)}>
                {chain.normal.map((label, index) => (
                  <li key={index} {...stylex.props(styles.stepLine)}>
                    <span aria-hidden {...stylex.props(styles.stepNo)}>
                      {index + 1}
                    </span>
                    <span {...stylex.props(styles.stepName)}>
                      {label ?? format(m.entryFlowStep, { n: index + 1 })}
                    </span>
                  </li>
                ))}
              </ol>
              {chain.escalation.length > 0 && (
                <p {...stylex.props(styles.escalationLine)}>
                  <span {...stylex.props(styles.keepShort)}>{format(m.reviewRouteEscalation)}</span>
                  <span {...stylex.props(styles.escalationSteps)}>
                    {chain.escalation
                      .map((label, index) => label ?? format(m.entryFlowStep, { n: index + 1 }))
                      .join(' → ')}
                  </span>
                </p>
              )}
              <p {...stylex.props(styles.asideFoot)}>{format(m.entriesCountsAfterAll)}</p>
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
        pending={save.isPending || uploading}
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
  // through the one reading of a value: a chosen option prints its words,
  // never the stable value behind them
  const said = fields
    .filter((field) => field.type !== 'attachment' && field.type !== 'boolean')
    .map((field) => displayValueOf(field, answerOf(payload, field.key)))
    .filter((value) => value.trim() !== '')
  return said.length === 0 ? item.title : said.join('　')
}
