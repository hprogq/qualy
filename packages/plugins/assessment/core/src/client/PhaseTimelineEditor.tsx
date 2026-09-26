import { Fragment, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PencilLineIcon, PlusIcon } from 'lucide-react'
import { useApi, useApiQuery, useLeaveGuard, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, ConfirmDialog, Feedback } from '@qualy/ui/admin'
import { Card, Table, TableHead, TableSkeleton, UnsavedMark } from '@qualy/ui/screen'
import { useIsMobile } from '@qualy/ui/use-mobile'
import { Button } from '@qualy/ui/button'
import { toast } from '@qualy/ui/toast'
import * as stylex from '@stylexjs/stylex'
import { Appear } from '@qualy/ui/reveal'
import { Ticker } from '@qualy/ui/ticker'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentMessages as m } from './i18n.ts'
import { useBatchLive } from './live.ts'
import { assessmentApi } from './api.ts'
import { planRefusalWords, refusalsOf, type PlanRefusalLike } from './refusals.ts'
import {
  countChanges,
  draftOf,
  edits,
  freshDraft,
  movedIds,
  scopesToSend,
  shapeOf,
  type BatchDto,
  type PhaseDraft,
} from './phase/model.ts'
import { scopeSections, titlesOf } from './phase/scope.ts'
import { PhaseCard, PhaseRow, type PhaseRowProps } from './phase/PhaseRow.tsx'
import { PhaseDetailsPanel } from './phase/PhaseDetailsPanel.tsx'
import { ScheduleDialog, TemplateDialog, UnscheduleDialog } from './phase/PhaseDialogs.tsx'
import { ZoneNote } from './batch/BatchZone.tsx'

// The stage plan: the ordered list of business states a batch passes through,
// and the two commands that change it.
//
// Editing what the phases are is a whole-plan write; committing when one
// begins is a single sub-resource write. They share one ordered list, so they
// share one screen - but they never share a control, and the plan's shape
// (model.ts) decides which row offers which. This file is the composition
// root: queries, mutations and the modes; the row, the panel and the dialogs
// live next to it.

// The columns a stage is read in, and the one more an edit needs for the
// controls that move and remove it. The head and every row take the same
// template, so a column cannot drift out of line with its heading.
const COLUMNS = 'minmax(0, 1.9fr) minmax(0, 0.95fr) minmax(0, 1.4fr) 5.5rem'
const EDITING_COLUMNS = `${COLUMNS} 6rem`

const styles = stylex.create({
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  controlsRow: {
    display: 'flex',
    minHeight: 32,
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  // while a plan is being edited its save stays in reach, however long the
  // plan is: the row holds to the top of the scroll as the rows go past
  controlsHeld: {
    position: 'sticky',
    top: 0,
    zIndex: 20,
    marginBlock: -8,
    paddingBlock: 8,
    backgroundColor: tokens.background,
  },
  // the plan's clock, at the far end from the controls
  zoneNote: {
    marginInlineEnd: 'auto',
  },
  controlsSeat: {
    display: 'flex',
    flexShrink: 0,
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  emptyPlan: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 14,
    paddingInline: 24,
    paddingBlock: 36,
    textAlign: 'center',
  },
  emptyNote: {
    margin: 0,
    fontSize: 13,
    color: tokens.mutedForeground,
  },
  emptyActions: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  // where the plan stops having times: a strip in the head's own grey, so
  // it reads as a second heading over the rows under it rather than a row
  boundary: {
    display: 'flex',
    alignItems: 'center',
    height: 28,
    paddingInline: 16,
    backgroundColor: tokens.surfaceInset,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    fontSize: 11,
    fontWeight: 500,
    color: tokens.mutedForeground,
  },
  seam: {
    position: 'relative',
    height: 0,
  },
  seamStrip: {
    position: 'absolute',
    insetInline: 0,
    top: -12,
    zIndex: 10,
    display: 'flex',
    height: 24,
    alignItems: 'center',
    gap: 8,
    paddingInline: 16,
    transitionProperty: 'opacity',
    transitionDuration: '150ms',
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
    opacity: {
      default: 0,
      ':focus-within': 1,
    },
  },
  seamShown: {
    opacity: 1,
  },
  seamLine: {
    height: 1,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    backgroundColor: tokens.border,
  },
  seamButton: {
    height: 24,
    gap: 4,
    backgroundColor: tokens.surface,
    paddingInline: 8,
    fontSize: 12,
  },
  seamGlyph: {
    width: 12,
    height: 12,
  },
  addRow: {
    display: 'flex',
    paddingInline: 8,
    paddingBlock: 6,
  },
  wideGhost: {
    width: '100%',
    color: tokens.mutedForeground,
  },
  cardList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    margin: 0,
    paddingInlineStart: 0,
    listStyleType: 'none',
  },
  cardBoundary: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    paddingTop: 4,
    fontSize: 11.5,
    color: tokens.mutedForeground,
  },
  cardSeamButton: {
    height: 28,
    width: '100%',
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  fullGhost: {
    width: '100%',
  },
})

/** the gap between two rows, which offers to become a stage when pointed at */
function Seam({
  label,
  shown,
  onPoint,
  onInsert,
}: {
  label: string
  shown: boolean
  onPoint: (over: boolean) => void
  onInsert: () => void
}) {
  return (
    <div {...stylex.props(styles.seam)}>
      {/* the strip takes no height of its own: it straddles the rule the two
          neighbouring rows already draw, so revealing it moves nothing.
          movement decides what is shown, not :hover - inserting a row moves
          the strip under a pointer that has not moved, and css would leave it
          lit until the pointer did */}
      <div
        onMouseMove={() => onPoint(true)}
        onMouseLeave={() => onPoint(false)}
        {...stylex.props(styles.seamStrip, shown && styles.seamShown)}
      >
        <span aria-hidden {...stylex.props(styles.seamLine)} />
        <Button
          variant="outline"
          className={stylex.props(styles.seamButton).className}
          onClick={(event) => {
            // the strip is also held open by focus, and the row it just
            // added has moved it out from under the pointer
            event.currentTarget.blur()
            onInsert()
          }}
        >
          <PlusIcon aria-hidden className={stylex.props(styles.seamGlyph).className} />
          {label}
        </Button>
        <span aria-hidden {...stylex.props(styles.seamLine)} />
      </div>
    </div>
  )
}

export function PhaseTimelineEditor({ batch }: { batch: BatchDto }) {
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const query = useApiQuery(assessmentApi)
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()

  const phases = useQuery(
    query.assessment.getPhases.queryOptions({ params: { batchId: batch.id } }),
  )
  const timelines = useQuery(
    query.assessment.listTemplates.queryOptions({ query: { kind: 'timeline' } }),
  )
  const presets = useQuery(
    query.assessment.listTemplates.queryOptions({ query: { kind: 'phase' } }),
  )
  // the paper an item allowance is chosen from, and the names a row's
  // allowance is said in
  const items = useQuery(query.assessment.listItems.queryOptions({ params: { batchId: batch.id } }))
  const groups = useQuery(
    query.assessment.listScoreGroups.queryOptions({ params: { batchId: batch.id } }),
  )
  const titles = useMemo(() => titlesOf(items.data?.items ?? []), [items.data])
  const paperOrder = useMemo(() => (items.data?.items ?? []).map((item) => item.id), [items.data])

  const rows = useMemo(() => phases.data?.phases ?? [], [phases.data])
  const serverDrafts = useMemo(() => rows.map(draftOf), [rows])
  const storedById = useMemo(
    () => new Map(serverDrafts.map((row) => [row.id!, row])),
    [serverDrafts],
  )
  const shape = useMemo(() => shapeOf(rows, batch.currentPhaseId), [rows, batch.currentPhaseId])

  const [edited, setEdited] = useState<readonly PhaseDraft[] | null>(null)
  const drafts = edited ?? serverDrafts
  /**
   * The plan the draft was begun from. Saving names it, so a plan somebody
   * else changed in the meantime is refused rather than overwritten by this
   * copy of it.
   */
  const serverFingerprint = phases.data?.planFingerprint
  const [baseline, setBaseline] = useState<string | null>(null)
  const edit = (next: readonly PhaseDraft[]) => {
    if (edited === null) setBaseline(serverFingerprint ?? null)
    setEdited(next)
  }
  const dropDraft = () => {
    setEdited(null)
    setBaseline(null)
  }
  const [editing, setEditing] = useState(false)
  /** the seam a pointer is currently over, if any */
  const [seamAt, setSeamAt] = useState<number | null>(null)
  const [actionsAt, setActionsAt] = useState<number | null>(null)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [templateId, setTemplateId] = useState('')
  const [scheduling, setScheduling] = useState<{
    id: string
    name: string
    canStartNow: boolean
  } | null>(null)
  const [plannedAt, setPlannedAt] = useState<string | null>(null)
  const [unscheduling, setUnscheduling] = useState<{ id: string; name: string } | null>(null)
  const [discarding, setDiscarding] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [planRefusals, setPlanRefusals] = useState<readonly PlanRefusalLike[]>([])

  // one renderer or the other, never both: duplicated controls in the dom
  // are duplicated for a screen reader too
  const isMobile = useIsMobile()
  const readOnly = batch.status === 'archived'
  const dirty = useMemo(() => countChanges(edited, serverDrafts), [edited, serverDrafts])
  const moved = useMemo(() => movedIds(edited, serverDrafts), [edited, serverDrafts])

  const clear = () => {
    setFailure(null)
    setPlanRefusals([])
  }
  const settle = () => queryClient.invalidateQueries({ queryKey: query.assessment.key() })
  // another administrator's edit, or a boundary turning: the plan on screen
  // is stale. Unsaved edits are not clobbered - the editor's own draft
  // shields the rows it is holding until saved or discarded.
  useBatchLive(batch.id, (kind) => {
    if (kind === 'plan-changed' || kind === 'phase-changed' || kind === 'sync') void settle()
  })
  const failed = (error: unknown) => {
    const refusals = refusalsOf(error)
    setPlanRefusals(refusals)
    setFailure(refusals.length > 0 ? null : formatError(error))
  }
  const sentenceOf = (refusal: PlanRefusalLike) => planRefusalWords(format, refusal.reason)

  const savePlan = useMutation({
    mutationFn: ({
      submitted,
      expected,
    }: {
      submitted: readonly PhaseDraft[]
      expected: string | undefined
    }) =>
      run(
        api.assessment.putPhases({
          params: { batchId: batch.id },
          payload: {
            ...(expected !== undefined ? { expectedPlanFingerprint: expected } : {}),
            phases: submitted.map((row) => ({
              ...(row.id !== undefined ? { id: row.id } : {}),
              phaseKey: row.phaseKey,
              displayName: row.displayName,
              description: row.description,
              entryNote: row.entryNote,
              permissionProfile: row.permissionProfile,
              ...scopesToSend(row, row.id !== undefined ? storedById.get(row.id) : undefined),
            })),
          },
        }),
      ),
    onMutate: clear,
    onSuccess: async () => {
      toast.success(format(m.toastPlanSaved))
      await settle()
      dropDraft()
      setEditing(false)
    },
    onError: failed,
  })

  const addFromTemplate = useMutation({
    mutationFn: (id: string) =>
      run(
        api.assessment.putPhases({
          params: { batchId: batch.id },
          payload: { fromTemplateId: id },
        }),
      ),
    onMutate: clear,
    onSuccess: async () => {
      toast.success(format(m.toastPlanSaved))
      await settle()
      dropDraft()
      setTemplateOpen(false)
      setTemplateId('')
    },
    onError: failed,
  })

  const schedule = useMutation({
    mutationFn: (input: { phaseId: string; at: string | null }) =>
      run(
        api.assessment.schedulePhase({
          params: { batchId: batch.id, phaseId: input.phaseId },
          payload: { plannedEntryAt: input.at },
        }),
      ),
    onMutate: clear,
    onSuccess: async () => {
      toast.success(format(m.toastPhaseScheduled))
      await settle()
      setScheduling(null)
      setUnscheduling(null)
      setPlannedAt(null)
    },
    onError: (error: unknown) => {
      setScheduling(null)
      setUnscheduling(null)
      failed(error)
    },
  })

  const advance = useMutation({
    mutationFn: (phaseId: string) =>
      run(
        api.assessment.advancePhase({
          params: { batchId: batch.id },
          payload: { to: phaseId },
        }),
      ),
    onMutate: clear,
    onSuccess: async () => {
      toast.success(format(m.toastPhaseAdvanced))
      await settle()
      setScheduling(null)
    },
    onError: (error: unknown) => {
      setScheduling(null)
      setFailure(formatError(error))
    },
  })

  // the one check worth spending a round trip on
  const blockers = useMemo(
    (): readonly PlanRefusalLike[] =>
      drafts.flatMap((row, index) =>
        row.displayName.trim() === ''
          ? [{ reason: 'display-name-blank', phaseId: row.id ?? null, index }]
          : [],
      ),
    [drafts],
  )

  /** saves the plan as edited; true once it is saved, false with the reason on the page */
  const saveAll = async (): Promise<boolean> => {
    if (blockers.length > 0) {
      setPlanRefusals(blockers)
      return false
    }
    try {
      await savePlan.mutateAsync({ submitted: drafts, expected: baseline ?? serverFingerprint })
      return true
    } catch {
      // said on the page by the mutation's own error handling
      return false
    }
  }

  // Leaving the page takes an unsaved plan with it, whether by a link, the
  // rail, the browser's own back or a closed tab: each asks first, and in
  // the application the question can save the plan on the way out.
  useLeaveGuard({ when: dirty > 0, onSave: saveAll })

  /** out of editing, with whatever the draft still held put down */
  const stopEditing = () => {
    clear()
    dropDraft()
    setEditing(false)
  }

  const addPhase = () => insertAt(drafts.length)

  const insertAt = (index: number) => {
    clear()
    edit([...drafts.slice(0, index), freshDraft(drafts), ...drafts.slice(index)])
    setEditing(true)
  }

  const move = (index: number, by: number) => {
    const to = index + by
    if (to < shape.scheduled || to >= drafts.length) return
    const next = [...drafts]
    const [row] = next.splice(index, 1)
    next.splice(to, 0, row!)
    clear()
    edit(next)
  }

  const setDraftAt = (index: number, next: PhaseDraft) =>
    edit(drafts.map((row, at) => (at === index ? next : row)))

  const refusalsFor = (row: PhaseDraft, index: number) =>
    planRefusals.filter(
      (refusal) =>
        (refusal.phaseId != null && refusal.phaseId === row.id) ||
        (refusal.phaseId == null && refusal.index === index),
    )
  // a refusal naming a row the draft no longer has - a removal the server
  // would not take - has nowhere to land, so it is said at the top instead
  const shownIds = new Set(drafts.flatMap((row) => (row.id !== undefined ? [row.id] : [])))
  const generalRefusals = planRefusals.filter(
    (refusal) =>
      (refusal.phaseId == null && refusal.index === undefined) ||
      (refusal.phaseId != null && !shownIds.has(refusal.phaseId)),
  )
  const named = (row: PhaseDraft) => row.displayName || format(m.unnamedSegment)

  /** the stage whose details are open, if any */
  const opened = actionsAt !== null ? drafts[actionsAt] : undefined

  const rowProps = (row: PhaseDraft, index: number): PhaseRowProps => ({
    draft: row,
    phase: row.id !== undefined ? rows.find((r) => r.id === row.id) : undefined,
    index,
    shape,
    total: drafts.length,
    editing,
    readOnly,
    unsaved:
      edited !== null &&
      (edits(row, row.id !== undefined ? storedById.get(row.id) : undefined) ||
        (row.id !== undefined && moved.has(row.id))),
    scopeTitles: paperOrder
      .filter((id) => row.itemScope.includes(id))
      .flatMap((id) => titles.get(id) ?? []),
    refusals: refusalsFor(row, index),
    sentenceOf,
    onDetails: () => setActionsAt(index),
    onSchedule: () => {
      setPlannedAt(null)
      setScheduling({
        id: row.id!,
        name: named(row),
        // entering now only means anything at the very front of the queue,
        // and the front is where the clock has reached rather than where
        // the writing down has: offering it on a stage already entered was
        // a button whose only answer was a refusal
        canStartNow: index === shape.currentIndex + 1,
      })
    },
    onUnschedule: () => setUnscheduling({ id: row.id!, name: named(row) }),
    onMove: (by) => move(index, by),
    onRemove: () => {
      clear()
      edit(drafts.filter((_, at) => at !== index))
    },
  })

  return (
    <div {...stylex.props(styles.stack)}>
      {/* the page header says what a stage plan is; this row is only the
          controls that act on it */}
      <div {...stylex.props(styles.controlsRow, editing && styles.controlsHeld)}>
        <ZoneNote xstyle={styles.zoneNote} />
        <div {...stylex.props(styles.controlsSeat)}>
          {/* how much is unsaved belongs to a moment that ends, and the
              count moves while somebody edits: the digit that changed is
              what ticks, and the words beside it stay still */}
          <Appear show={editing && dirty > 0}>
            <UnsavedMark>
              <Ticker value={format(m.pendingShort, { count: dirty })} />
            </UnsavedMark>
          </Appear>
          {!readOnly && editing && (
            <>
              <Button size="sm" variant="ghost" onClick={() => setTemplateOpen(true)}>
                {format(m.templateAdd)}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={savePlan.isPending}
                // a draft that came back to where it started - a stage moved
                // down and up again - has nothing to lose, and is put down
                // rather than carried out of editing
                onClick={() => (dirty > 0 ? setDiscarding(true) : stopEditing())}
              >
                {format(m.cancel)}
              </Button>
              <Button size="sm" disabled={savePlan.isPending} onClick={() => void saveAll()}>
                {format(m.saveShort)}
              </Button>
            </>
          )}
          {!readOnly && !editing && drafts.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                clear()
                setEditing(true)
              }}
            >
              <PencilLineIcon aria-hidden />
              {format(m.enterEditing)}
            </Button>
          )}
        </div>
      </div>

      <Feedback message={failure} />
      {generalRefusals.length > 0 && (
        <Feedback
          message={`${format(m.planRefusedIntro)} ${generalRefusals.map(sentenceOf).join(' ')}`}
        />
      )}

      <AsyncSection
        pending={phases.isPending}
        error={phases.isError ? formatError(phases.error) : null}
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => void phases.refetch()}
        skeleton={
          <Card>
            <TableSkeleton rows={4} />
          </Card>
        }
      >
        {drafts.length === 0 ? (
          <Card data-testid="phase-plan-empty">
            <div {...stylex.props(styles.emptyPlan)}>
              <p {...stylex.props(styles.emptyNote)}>{format(m.phasesEmpty)}</p>
              {!readOnly && (
                <div {...stylex.props(styles.emptyActions)}>
                  <Button size="sm" onClick={addPhase}>
                    {format(m.addPhase)}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setTemplateOpen(true)}>
                    {format(m.templateAdd)}
                  </Button>
                </div>
              )}
            </div>
          </Card>
        ) : !isMobile ? (
          // a table where there are columns to be had, stacked cards where
          // there are not - the same facts either way
          <Card data-testid="phase-plan">
            <Table columns={editing && !readOnly ? EDITING_COLUMNS : COLUMNS} openable>
              <TableHead>
                <span>{format(m.colStage)}</span>
                <span>{format(m.colOpens)}</span>
                <span>{format(m.colPlannedStart)}</span>
                <span>{format(m.colStatus)}</span>
                {editing && !readOnly && <span />}
              </TableHead>
              {drafts.map((row, index) => (
                <Fragment key={row.id ?? `new-${row.phaseKey}`}>
                  {index === shape.scheduled && index > 0 && (
                    <div data-testid="phase-boundary" {...stylex.props(styles.boundary)}>
                      {format(m.unscheduledFrom)}
                    </div>
                  )}
                  {editing && !readOnly && index > shape.scheduled && (
                    <Seam
                      label={format(m.insertHere)}
                      shown={seamAt === index}
                      onPoint={(over) => setSeamAt(over ? index : null)}
                      onInsert={() => {
                        setSeamAt(null)
                        insertAt(index)
                      }}
                    />
                  )}
                  <PhaseRow {...rowProps(row, index)} />
                </Fragment>
              ))}
              {editing && !readOnly && (
                <div {...stylex.props(styles.addRow)}>
                  <Button
                    size="sm"
                    variant="ghost"
                    className={stylex.props(styles.wideGhost).className}
                    onClick={addPhase}
                  >
                    <PlusIcon aria-hidden />
                    {format(m.addPhase)}
                  </Button>
                </div>
              )}
            </Table>
          </Card>
        ) : (
          <ol data-testid="phase-plan" {...stylex.props(styles.cardList)}>
            {drafts.map((row, index) => (
              <Fragment key={row.id ?? `new-${row.phaseKey}`}>
                {index === shape.scheduled && index > 0 && (
                  <li data-testid="phase-boundary" {...stylex.props(styles.cardBoundary)}>
                    <span aria-hidden {...stylex.props(styles.seamLine)} />
                    {format(m.unscheduledFrom)}
                    <span aria-hidden {...stylex.props(styles.seamLine)} />
                  </li>
                )}
                <PhaseCard {...rowProps(row, index)} />
                {editing && !readOnly && index >= shape.scheduled && index < drafts.length - 1 && (
                  <li>
                    <Button
                      size="sm"
                      variant="ghost"
                      className={stylex.props(styles.cardSeamButton).className}
                      onClick={() => insertAt(index + 1)}
                    >
                      <PlusIcon aria-hidden className={stylex.props(styles.seamGlyph).className} />
                      {format(m.insertHere)}
                    </Button>
                  </li>
                )}
              </Fragment>
            ))}
            {editing && !readOnly && (
              <li>
                <Button
                  size="sm"
                  variant="outline"
                  className={stylex.props(styles.fullGhost).className}
                  onClick={addPhase}
                >
                  <PlusIcon aria-hidden />
                  {format(m.addPhase)}
                </Button>
              </li>
            )}
          </ol>
        )}
      </AsyncSection>

      <PhaseDetailsPanel
        draft={opened}
        stored={opened?.id !== undefined ? storedById.get(opened.id) : undefined}
        presets={presets.data?.items ?? []}
        sections={scopeSections(
          groups.data?.groups ?? [],
          items.data?.items ?? [],
          opened?.itemScope ?? [],
        )}
        itemsPending={items.isPending || groups.isPending}
        readOnly={readOnly}
        frozen={actionsAt !== null && actionsAt < shape.currentIndex}
        onDraft={(next) => {
          if (actionsAt === null) return
          setDraftAt(actionsAt, next)
          setEditing(true)
        }}
        onClose={() => setActionsAt(null)}
      />

      <ScheduleDialog
        open={scheduling !== null}
        name={scheduling?.name ?? ''}
        canStartNow={scheduling?.canStartNow ?? false}
        value={plannedAt}
        pending={schedule.isPending || advance.isPending}
        onChange={setPlannedAt}
        onCancel={() => setScheduling(null)}
        onSchedule={() => scheduling && schedule.mutate({ phaseId: scheduling.id, at: plannedAt })}
        onStartNow={() => scheduling && advance.mutate(scheduling.id)}
      />
      <UnscheduleDialog
        open={unscheduling !== null}
        name={unscheduling?.name ?? ''}
        pending={schedule.isPending}
        onCancel={() => setUnscheduling(null)}
        onConfirm={() => unscheduling && schedule.mutate({ phaseId: unscheduling.id, at: null })}
      />
      <TemplateDialog
        open={templateOpen}
        templates={timelines.data?.items ?? []}
        value={templateId}
        pending={addFromTemplate.isPending}
        onChange={setTemplateId}
        onCancel={() => setTemplateOpen(false)}
        onConfirm={() => addFromTemplate.mutate(templateId)}
      />

      <ConfirmDialog
        open={discarding}
        title={format(m.discardTitle, { count: dirty })}
        confirmLabel={format(m.discardEdits)}
        cancelLabel={format(m.cancel)}
        tone="destructive"
        onConfirm={() => {
          stopEditing()
          setDiscarding(false)
        }}
        onCancel={() => setDiscarding(false)}
      />
    </div>
  )
}
