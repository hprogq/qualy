import { useEffect, useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { GripVerticalIcon, PlusIcon, RotateCcwIcon, Trash2Icon, XIcon } from 'lucide-react'
import { useApi, useApiQuery, usePageNavigate, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { visuallyHidden } from '@qualy/ui/visually-hidden'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { ConfirmDialog, Feedback, Field } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { DateRangePicker } from '@qualy/ui/date-range-picker'
import { FieldGroup } from '@qualy/ui/field'
import { Input } from '@qualy/ui/input'
import { Badge } from '@qualy/ui/badge'
import { Textarea } from '@qualy/ui/textarea'
import { toast } from '@qualy/ui/toast'
import { assessmentApi } from '../api.ts'
import { DEFAULT_REVIEW_REASONS } from '../../review/reasons.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { refusalMessage, refusalsOf } from '../refusals.ts'
import { ReopenDialog } from './ReopenDialog.tsx'
import type { BatchDto } from '../phase/model.ts'

// What the batch is, and what may happen to the batch as a whole.
//
// The lifecycle actions live here rather than in the bar above the rail: they
// are rare, they are the kind that asks twice, and a row of them across the
// top of every section made the section itself look like the smaller subject.

const styles = stylex.create({
  column: {
    display: 'flex',
    flexDirection: 'column',
  },
  section: {
    display: 'grid',
    gridTemplateColumns: {
      default: null,
      '@media (min-width: 768px)': '15rem minmax(0, 1fr)',
    },
    columnGap: 40,
    rowGap: 16,
    borderBottomWidth: {
      default: 1,
      ':last-child': 0,
    },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    paddingTop: {
      default: 24,
      ':first-child': 0,
    },
    paddingBottom: {
      default: 24,
      ':last-child': 0,
    },
  },
  sectionWords: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 500,
  },
  sectionHint: {
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  sectionBody: {
    minWidth: 0,
    maxWidth: '36rem',
  },
  lifecycleRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: 24,
    rowGap: 8,
    paddingBlock: 16,
  },
  lifecycleWords: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 2,
  },
  lifecycleTitle: {
    fontSize: 14,
    fontWeight: 500,
  },
  lifecycleHint: {
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  lifecycleAction: {
    flexShrink: 0,
  },
  reasonColumn: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  reasonNote: {
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  chipRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    gap: 4,
    paddingRight: 4,
  },
  chipGrabbable: {
    cursor: 'grab',
  },
  chipMarkBefore: {
    boxShadow: `inset 2px 0 0 0 ${tokens.primary}`,
  },
  chipMarkAfter: {
    boxShadow: `inset -2px 0 0 0 ${tokens.primary}`,
  },
  chipGrip: {
    width: 12,
    height: 12,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 60%, transparent)`,
  },
  chipRemove: {
    borderRadius: '9999px',
    padding: 2,
    color: {
      default: tokens.mutedForeground,
      ':hover': tokens.foreground,
    },
  },
  chipRemoveIcon: {
    width: 12,
    height: 12,
  },
  addRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  addInput: {
    height: 32,
    maxWidth: 224,
    fontSize: 14,
  },
  formGaps: {
    gap: 20,
  },
  saveRow: {
    marginTop: 20,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 12,
  },
  unsavedNote: {
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  deleteButton: {
    borderColor: `color-mix(in oklab, ${tokens.danger} 30%, transparent)`,
    color: {
      default: tokens.danger,
      ':hover': tokens.danger,
    },
    backgroundColor: {
      default: null,
      ':hover': `color-mix(in oklab, ${tokens.danger} 5%, transparent)`,
    },
  },
})

/**
 * One subject of the screen: what it is on the left, what to do about it on
 * the right.
 *
 * No card. A card is a thing lifted off the page because it stands beside
 * others like it; a settings screen is one column of subjects read top to
 * bottom, and boxing each of them only adds edges to count.
 */
function Section({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section {...stylex.props(styles.section)}>
      <div {...stylex.props(styles.sectionWords)}>
        <h3 {...stylex.props(styles.sectionTitle)}>{title}</h3>
        <p {...stylex.props(styles.sectionHint)}>{description}</p>
      </div>
      <div {...stylex.props(styles.sectionBody)}>{children}</div>
    </section>
  )
}

/** one thing that can happen to the round, what it does, and the way to do it */
function LifecycleRow({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action: ReactNode
}) {
  return (
    <div {...stylex.props(styles.lifecycleRow)}>
      <div {...stylex.props(styles.lifecycleWords)}>
        <p {...stylex.props(styles.lifecycleTitle)}>{title}</p>
        <p {...stylex.props(styles.lifecycleHint)}>{description}</p>
      </div>
      <div {...stylex.props(styles.lifecycleAction)}>{action}</div>
    </div>
  )
}

/**
 * One list of pickable labels: chips with a remove, and a box to add one.
 * Order is presentation order in the reviewer's dialog; duplicates fold.
 */
function ReasonList({
  id,
  reasons,
  disabled,
  emptyNote,
  defaults,
  onChange,
}: {
  id: string
  reasons: readonly string[]
  disabled: boolean
  /** what an empty list means for the reviewer, said instead of nothing */
  emptyNote: string
  /** the system's list, offered back whenever this one has drifted from it */
  defaults: readonly string[]
  onChange: (next: readonly string[]) => void
}) {
  const { format } = useI18n()
  const [draft, setDraft] = useState('')
  // where a dragged label would land, marked while it hovers
  const [drop, setDrop] = useState<{ reason: string; edge: 'before' | 'after' } | null>(null)
  const add = () => {
    const label = draft.trim()
    if (label === '') return
    if (!reasons.includes(label)) onChange([...reasons, label])
    setDraft('')
  }
  const edgeOf = (event: React.DragEvent) => {
    const box = event.currentTarget.getBoundingClientRect()
    return event.clientX < box.left + box.width / 2 ? ('before' as const) : ('after' as const)
  }
  const move = (dragged: string, target: string, edge: 'before' | 'after') => {
    if (dragged === target) return
    const order = reasons.filter((one) => one !== dragged)
    const at = order.indexOf(target)
    order.splice(edge === 'before' ? at : at + 1, 0, dragged)
    onChange(order)
  }
  return (
    <div {...stylex.props(styles.reasonColumn)}>
      {/* an empty list is a configuration, not a blank: say what it does */}
      {reasons.length === 0 && <p {...stylex.props(styles.reasonNote)}>{emptyNote}</p>}
      {reasons.length > 0 && (
        // the order here is the order the reviewer's dialog offers, and the
        // digits it hands out; a chip drags to its place the way the form
        // fields do
        <div {...stylex.props(styles.chipRow)}>
          {reasons.map((reason) => {
            const marked = drop?.reason === reason ? drop.edge : null
            return (
              <Badge
                key={reason}
                variant="outline"
                draggable={!disabled}
                onDragStart={(event) => {
                  event.dataTransfer.setData('qualy/reason', reason)
                  event.dataTransfer.effectAllowed = 'move'
                }}
                onDragOver={(event) => {
                  if (!event.dataTransfer.types.includes('qualy/reason')) return
                  event.preventDefault()
                  setDrop({ reason, edge: edgeOf(event) })
                }}
                onDragLeave={() => setDrop((mark) => (mark?.reason === reason ? null : mark))}
                onDrop={(event) => {
                  event.preventDefault()
                  setDrop(null)
                  const dragged = event.dataTransfer.getData('qualy/reason')
                  if (dragged !== '') move(dragged, reason, edgeOf(event))
                }}
                className={
                  stylex.props(
                    styles.chip,
                    !disabled && styles.chipGrabbable,
                    marked === 'before' && styles.chipMarkBefore,
                    marked === 'after' && styles.chipMarkAfter,
                  ).className
                }
              >
                {!disabled && (
                  <GripVerticalIcon
                    aria-hidden
                    className={stylex.props(styles.chipGrip).className}
                  />
                )}
                {reason}
                {!disabled && (
                  <button
                    type="button"
                    {...stylex.props(styles.chipRemove)}
                    onClick={() => onChange(reasons.filter((one) => one !== reason))}
                  >
                    <XIcon aria-hidden className={stylex.props(styles.chipRemoveIcon).className} />
                    <span {...stylex.props(visuallyHidden.text)}>{reason}</span>
                  </button>
                )}
              </Badge>
            )
          })}
        </div>
      )}
      <div {...stylex.props(styles.addRow)}>
        <Input
          id={id}
          className={stylex.props(styles.addInput).className}
          value={draft}
          disabled={disabled}
          placeholder={format(m.settingsReasonPlaceholder)}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              add()
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || draft.trim() === ''}
          onClick={add}
        >
          <PlusIcon aria-hidden />
          {format(m.settingsReasonAdd)}
        </Button>
        {/* the way back to the shipped list, only while this one differs;
            it changes the draft like any edit, so saving is still the act */}
        {!disabled && JSON.stringify(reasons) !== JSON.stringify(defaults) && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(defaults)}>
            {format(m.settingsReasonRestore)}
          </Button>
        )}
      </div>
    </div>
  )
}

export function BatchSettingsForm({ batch }: { batch: BatchDto }) {
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const query = useApiQuery(assessmentApi)
  const queryClient = useQueryClient()
  const { format, formatError, locale } = useI18n()
  const navigate = usePageNavigate()

  const [name, setName] = useState(batch.name)
  const [description, setDescription] = useState(batch.descriptionMd ?? '')
  const [range, setRange] = useState(batch.materialRange)
  const [rejectReasons, setRejectReasons] = useState<readonly string[]>(batch.reviewReasons.reject)
  const [escalateReasons, setEscalateReasons] = useState<readonly string[]>(
    batch.reviewReasons.escalate,
  )
  const [failure, setFailure] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<'archive' | 'delete' | null>(null)
  const [reopening, setReopening] = useState(false)

  // the batch as it is now, whoever changed it: a form holding the values
  // from the request that opened the page would silently write them back
  useEffect(() => {
    setName(batch.name)
    setDescription(batch.descriptionMd ?? '')
    setRange(batch.materialRange)
    setRejectReasons(batch.reviewReasons.reject)
    setEscalateReasons(batch.reviewReasons.escalate)
  }, [batch])

  const settle = () => queryClient.invalidateQueries({ queryKey: query.assessment.key() })
  // the plan answers with its own reasons; anything else is a sentence the
  // error catalog already has
  const said = (error: unknown) => {
    const refusals = refusalsOf(error)
    return refusals.length > 0
      ? refusals
          .map((refusal) => {
            const sentence = refusalMessage(refusal.reason)
            return sentence ? format(sentence) : refusal.reason
          })
          .join(' ')
      : formatError(error)
  }

  const save = useMutation({
    mutationFn: () =>
      run(
        api.assessment.updateBatch({
          params: { batchId: batch.id },
          payload: {
            name,
            descriptionMd: description.trim() === '' ? null : description,
            materialRange: range,
            reviewReasons: { reject: rejectReasons, escalate: escalateReasons },
          },
        }),
      ),
    onMutate: () => setFailure(null),
    onSuccess: async () => {
      toast.success(format(m.toastBatchSaved))
      await settle()
    },
    onError: (error: unknown) => setFailure(said(error)),
  })

  const archive = useMutation({
    mutationFn: () =>
      run(
        api.assessment.setBatchStatus({
          params: { batchId: batch.id },
          payload: { status: 'archived' },
        }),
      ),
    onMutate: () => setFailure(null),
    onSuccess: async () => {
      toast.success(format(m.toastBatchArchived))
      await settle()
      setConfirming(null)
    },
    onError: (error: unknown) => {
      setConfirming(null)
      setFailure(said(error))
    },
  })

  const reopen = useMutation({
    mutationFn: (input: { reason: string; displayName: string }) =>
      run(
        api.assessment.setBatchStatus({
          params: { batchId: batch.id },
          payload: {
            status: 'active',
            reason: input.reason,
            phase: { displayName: input.displayName },
            // a reopening that waits has nothing to wait for yet: the new
            // phase is scheduled from the plan afterwards
            plannedEntryAt: null,
          },
        }),
      ),
    onMutate: () => setFailure(null),
    onSuccess: async () => {
      toast.success(format(m.toastBatchReopened))
      await settle()
      setReopening(false)
    },
    onError: (error: unknown) => {
      setReopening(false)
      setFailure(said(error))
    },
  })

  const remove = useMutation({
    mutationFn: () => run(api.assessment.deleteBatch({ params: { batchId: batch.id } })),
    onMutate: () => setFailure(null),
    onSuccess: () => {
      toast.success(format(m.toastBatchDeleted))
      setConfirming(null)
      // the batch this workspace is about no longer exists
      navigate('assessment/batches', { replace: true })
      void settle()
    },
    onError: (error: unknown) => {
      setConfirming(null)
      setFailure(said(error))
    },
  })

  const editable = batch.manageable && batch.status !== 'archived'
  const unchanged =
    name === batch.name &&
    description === (batch.descriptionMd ?? '') &&
    range.start === batch.materialRange.start &&
    range.end === batch.materialRange.end &&
    JSON.stringify(rejectReasons) === JSON.stringify(batch.reviewReasons.reject) &&
    JSON.stringify(escalateReasons) === JSON.stringify(batch.reviewReasons.escalate)

  return (
    <div {...stylex.props(styles.column)}>
      <Feedback message={failure} />

      <Section title={format(m.settingsBasics)} description={format(m.settingsBasicsHint)}>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            save.mutate()
          }}
        >
          <FieldGroup xstyle={styles.formGaps}>
            <Field label={format(m.nameLabel)}>
              {(id) => (
                <Input
                  id={id}
                  value={name}
                  disabled={!editable}
                  placeholder={format(m.namePlaceholder)}
                  onChange={(event) => setName(event.target.value)}
                />
              )}
            </Field>
            <Field label={format(m.materialRange)}>
              {(id) => (
                <DateRangePicker
                  id={id}
                  value={range}
                  disabled={!editable}
                  onChange={setRange}
                  placeholder={format(m.pickDateRange)}
                  localeTag={locale}
                  monthLabel={format(commonMessages.calendarMonth)}
                  yearLabel={format(commonMessages.calendarYear)}
                />
              )}
            </Field>
            <Field label={format(m.settingsNote)} hint={format(m.settingsNoteHint)}>
              {(id) => (
                <Textarea
                  id={id}
                  rows={4}
                  value={description}
                  disabled={!editable}
                  onChange={(event) => setDescription(event.target.value)}
                />
              )}
            </Field>
            <Field label={format(m.settingsRejectReasons)} hint={format(m.settingsReasonsHint)}>
              {(id) => (
                <ReasonList
                  id={id}
                  reasons={rejectReasons}
                  disabled={!editable}
                  emptyNote={format(m.settingsRejectReasonsNone)}
                  defaults={DEFAULT_REVIEW_REASONS.reject}
                  onChange={setRejectReasons}
                />
              )}
            </Field>
            <Field label={format(m.settingsEscalateReasons)} hint={format(m.settingsEscalateHint)}>
              {(id) => (
                <ReasonList
                  id={id}
                  reasons={escalateReasons}
                  disabled={!editable}
                  emptyNote={format(m.settingsEscalateReasonsNone)}
                  defaults={DEFAULT_REVIEW_REASONS.escalate}
                  onChange={setEscalateReasons}
                />
              )}
            </Field>
          </FieldGroup>
          <div {...stylex.props(styles.saveRow)}>
            {!unchanged && (
              <span {...stylex.props(styles.unsavedNote)}>{format(m.settingsUnsaved)}</span>
            )}
            <Button type="submit" disabled={!editable || unchanged || save.isPending}>
              {format(m.saveShort)}
            </Button>
          </div>
        </form>
      </Section>

      {batch.manageable && (
        <Section title={format(m.settingsLifecycle)} description={format(m.settingsLifecycleHint)}>
          {/* one row at a time: the batch is in exactly one status, so only
              the action that status allows is on the page */}
          <div>
            {batch.status === 'active' && (
              <LifecycleRow
                title={format(m.archive)}
                description={format(m.archiveConfirmBody)}
                action={
                  <Button
                    variant="outline"
                    disabled={archive.isPending}
                    onClick={() => setConfirming('archive')}
                  >
                    {format(m.archive)}
                  </Button>
                }
              />
            )}
            {batch.status === 'archived' && (
              <LifecycleRow
                title={format(m.reopen)}
                description={format(m.reopenBody)}
                action={
                  <Button
                    variant="outline"
                    disabled={reopen.isPending}
                    onClick={() => setReopening(true)}
                  >
                    <RotateCcwIcon />
                    {format(m.reopen)}
                  </Button>
                }
              />
            )}
            {batch.status === 'draft' && (
              <LifecycleRow
                title={format(m.deleteBatch)}
                description={format(m.deleteConfirmBody)}
                action={
                  <Button
                    variant="outline"
                    className={stylex.props(styles.deleteButton).className}
                    disabled={remove.isPending}
                    onClick={() => setConfirming('delete')}
                  >
                    <Trash2Icon />
                    {format(m.deleteBatch)}
                  </Button>
                }
              />
            )}
          </div>
        </Section>
      )}

      <ConfirmDialog
        open={confirming === 'archive'}
        title={format(m.archiveConfirmTitle)}
        description={format(m.archiveConfirmBody)}
        confirmLabel={format(m.archive)}
        cancelLabel={format(m.cancel)}
        pending={archive.isPending}
        tone="destructive"
        onConfirm={() => archive.mutate()}
        onCancel={() => setConfirming(null)}
      />
      <ConfirmDialog
        open={confirming === 'delete'}
        title={format(m.deleteConfirmTitle)}
        description={format(m.deleteConfirmBody)}
        confirmLabel={format(m.deleteBatch)}
        cancelLabel={format(m.cancel)}
        pending={remove.isPending}
        tone="destructive"
        onConfirm={() => remove.mutate()}
        onCancel={() => setConfirming(null)}
      />
      <ReopenDialog
        open={reopening}
        pending={reopen.isPending}
        onCancel={() => setReopening(false)}
        onReopen={(input) => reopen.mutate(input)}
      />
    </div>
  )
}
