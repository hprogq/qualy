import { Fragment, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ListOrderedIcon, PlusIcon } from 'lucide-react'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, ConfirmDialog, Feedback } from '@qualy/ui/admin'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@qualy/ui/table'
import { useIsMobile } from '@qualy/ui/use-mobile'
import { Button } from '@qualy/ui/button'
import { toast } from '@qualy/ui/toast'
import { Skeleton } from '@qualy/ui/skeleton'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentMessages as m } from './i18n.ts'
import { useBatchLive } from './live.ts'
import { assessmentApi } from './api.ts'
import { refusalMessage, refusalsOf, type PlanRefusalLike } from './refusals.ts'
import {
  countChanges,
  draftOf,
  freshDraft,
  shapeOf,
  type BatchDto,
  type PhaseDraft,
} from './phase/model.ts'
import { PhaseCard, PhaseRow, type PhaseRowProps } from './phase/PhaseRow.tsx'
import { PhaseDetailsPanel } from './phase/PhaseDetailsPanel.tsx'
import { ScheduleDialog, TemplateDialog, UnscheduleDialog } from './phase/PhaseDialogs.tsx'

// The stage plan: the ordered list of business states a batch passes through,
// and the two commands that change it.
//
// Editing what the phases are is a whole-plan write; committing when one
// begins is a single sub-resource write. They share one ordered list, so they
// share one screen - but they never share a control, and the plan's shape
// (model.ts) decides which row offers which. This file is the composition
// root: queries, mutations and the modes; the row, the panel and the dialogs
// live next to it.

const styles = stylex.create({
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  controlsRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  controlsSeat: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 8,
  },
  pendingNote: {
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
  boneStack: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  bone: {
    height: 48,
    width: '100%',
  },
  emptyPlan: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: tokens.border,
    padding: 32,
    textAlign: 'center',
  },
  emptyNote: {
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    color: tokens.mutedForeground,
  },
  emptyActions: {
    display: 'flex',
    justifyContent: 'center',
    gap: 8,
  },
  planStack: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  tableShell: {
    overflow: 'hidden',
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
  },
  // fixed tracks, so a long stage name cannot take the width the other
  // columns need
  fixedTable: {
    tableLayout: 'fixed',
  },
  stillRow: {
    backgroundColor: {
      default: null,
      ':hover': null,
    },
  },
  colStage: { width: '26%' },
  colOpens: { width: '26%' },
  colStart: { width: '26%' },
  colStatus: { width: '22%', textAlign: 'right' },
  boundaryCell: {
    borderBottomWidth: 0,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 30%, transparent)`,
    paddingBlock: 4,
    textAlign: 'center',
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
  seamRow: {
    height: 0,
    borderBottomWidth: 0,
    backgroundColor: {
      default: null,
      ':hover': null,
    },
  },
  seamCell: {
    position: 'relative',
    height: 0,
    borderBottomWidth: 0,
    padding: 0,
  },
  seamStrip: {
    position: 'absolute',
    insetInline: 0,
    top: -6,
    zIndex: 10,
    display: 'flex',
    height: 12,
    alignItems: 'center',
    gap: 8,
    paddingInline: 12,
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
    backgroundColor: tokens.background,
    paddingInline: 8,
    fontSize: '0.75rem',
    lineHeight: '1rem',
  },
  seamGlyph: {
    width: 12,
    height: 12,
  },
  addCell: {
    padding: 8,
  },
  wideGhost: {
    width: '100%',
    color: tokens.mutedForeground,
  },
  cardList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  cardBoundary: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    paddingTop: 4,
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
  cardSeamButton: {
    height: 28,
    width: '100%',
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
  fullGhost: {
    width: '100%',
  },
})

/** the gap between two rows, which offers to become a stage when pointed at */
function SeamRow({
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
    <TableRow xstyle={styles.seamRow}>
      {/* the strip takes no height of its own: it straddles the seam the two
          neighbouring rows already draw, so revealing it moves nothing.
          movement decides what is shown, not :hover - inserting a row moves
          the strip under a pointer that has not moved, and css would leave it
          lit until the pointer did */}
      <TableCell colSpan={4} xstyle={styles.seamCell}>
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
      </TableCell>
    </TableRow>
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

  const rows = phases.data?.phases ?? []
  const serverDrafts = useMemo(() => rows.map(draftOf), [rows])
  const shape = useMemo(() => shapeOf(rows), [rows])

  const [edited, setEdited] = useState<readonly PhaseDraft[] | null>(null)
  const drafts = edited ?? serverDrafts
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
  const sentenceOf = (refusal: PlanRefusalLike) => {
    const message = refusalMessage(refusal.reason)
    return message ? format(message) : refusal.reason
  }

  const savePlan = useMutation({
    mutationFn: (submitted: readonly PhaseDraft[]) =>
      run(
        api.assessment.putPhases({
          params: { batchId: batch.id },
          payload: {
            phases: submitted.map((row) => ({
              ...(row.id !== undefined ? { id: row.id } : {}),
              phaseKey: row.phaseKey,
              displayName: row.displayName,
              description: row.description,
              entryNote: row.entryNote,
              permissionProfile: row.permissionProfile,
            })),
          },
        }),
      ),
    onMutate: clear,
    onSuccess: async () => {
      toast.success(format(m.toastPlanSaved))
      await settle()
      setEdited(null)
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
      setEdited(null)
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

  const saveAll = () => {
    if (blockers.length > 0) {
      setPlanRefusals(blockers)
      return
    }
    savePlan.mutate(drafts)
  }

  const addPhase = () => insertAt(drafts.length)

  const insertAt = (index: number) => {
    clear()
    setEdited([...drafts.slice(0, index), freshDraft(drafts), ...drafts.slice(index)])
    setEditing(true)
  }

  const move = (index: number, by: number) => {
    const to = index + by
    if (to < shape.scheduled || to >= drafts.length) return
    const next = [...drafts]
    const [row] = next.splice(index, 1)
    next.splice(to, 0, row!)
    clear()
    setEdited(next)
  }

  const setDraftAt = (index: number, next: PhaseDraft) =>
    setEdited(drafts.map((row, at) => (at === index ? next : row)))

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

  const rowProps = (row: PhaseDraft, index: number): PhaseRowProps => ({
    draft: row,
    phase: row.id !== undefined ? rows.find((r) => r.id === row.id) : undefined,
    index,
    shape,
    total: drafts.length,
    editing,
    readOnly,
    refusals: refusalsFor(row, index),
    sentenceOf,
    onOpens: () => setActionsAt(index),
    onDetails: () => setActionsAt(index),
    onSchedule: () => {
      setPlannedAt(null)
      setScheduling({
        id: row.id!,
        name: named(row),
        // entering now only means anything at the very front of the queue
        canStartNow: index === shape.entered,
      })
    },
    onUnschedule: () => setUnscheduling({ id: row.id!, name: named(row) }),
    onMove: (by) => move(index, by),
    onRemove: () => {
      clear()
      setEdited(drafts.filter((_, at) => at !== index))
    },
  })

  return (
    <div {...stylex.props(styles.stack)}>
      {/* the page header says what a stage plan is; this row is only the
          controls that act on it */}
      <div {...stylex.props(styles.controlsRow)}>
        <div {...stylex.props(styles.controlsSeat)}>
          {editing && dirty > 0 && (
            <span {...stylex.props(styles.pendingNote)}>
              {format(m.pendingShort, { count: dirty })}
            </span>
          )}
          {!readOnly && editing && (
            <>
              <Button size="sm" variant="ghost" onClick={() => setTemplateOpen(true)}>
                {format(m.templateAdd)}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={savePlan.isPending}
                onClick={() => (dirty > 0 ? setDiscarding(true) : setEditing(false))}
              >
                {format(m.cancel)}
              </Button>
              <Button size="sm" disabled={savePlan.isPending} onClick={saveAll}>
                {format(m.saveShort)}
              </Button>
            </>
          )}
          {!readOnly && !editing && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                clear()
                setEditing(true)
              }}
            >
              <ListOrderedIcon aria-hidden />
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
          <div {...stylex.props(styles.boneStack)}>
            <Skeleton className={stylex.props(styles.bone).className} />
            <Skeleton className={stylex.props(styles.bone).className} />
            <Skeleton className={stylex.props(styles.bone).className} />
          </div>
        }
      >
        {drafts.length === 0 ? (
          <div data-testid="phase-plan-empty" {...stylex.props(styles.emptyPlan)}>
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
        ) : (
          <div {...stylex.props(styles.planStack)}>
            {/* a table where there are columns to be had, stacked cards where
                there are not - the same four facts either way */}
            {!isMobile && (
              <div {...stylex.props(styles.tableShell)}>
                <Table xstyle={styles.fixedTable}>
                  <TableHeader>
                    <TableRow xstyle={styles.stillRow}>
                      <TableHead xstyle={styles.colStage}>{format(m.colStage)}</TableHead>
                      <TableHead xstyle={styles.colOpens}>{format(m.colOpens)}</TableHead>
                      <TableHead xstyle={styles.colStart}>{format(m.colPlannedStart)}</TableHead>
                      <TableHead xstyle={styles.colStatus}>{format(m.colStatus)}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {drafts.map((row, index) => (
                      <Fragment key={row.id ?? `new-${row.phaseKey}`}>
                        {index === shape.scheduled && index > 0 && (
                          <TableRow xstyle={styles.stillRow}>
                            <TableCell colSpan={4} xstyle={styles.boundaryCell}>
                              {format(m.unscheduledFrom)}
                            </TableCell>
                          </TableRow>
                        )}
                        {editing && !readOnly && index > shape.scheduled && (
                          <SeamRow
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
                      <TableRow xstyle={styles.stillRow}>
                        <TableCell colSpan={4} xstyle={styles.addCell}>
                          <Button
                            size="sm"
                            variant="ghost"
                            className={stylex.props(styles.wideGhost).className}
                            onClick={addPhase}
                          >
                            <PlusIcon aria-hidden />
                            {format(m.addPhase)}
                          </Button>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}

            {isMobile && (
              <ol {...stylex.props(styles.cardList)}>
                {drafts.map((row, index) => (
                  <Fragment key={row.id ?? `new-${row.phaseKey}`}>
                    {index === shape.scheduled && index > 0 && (
                      <li {...stylex.props(styles.cardBoundary)}>
                        <span aria-hidden {...stylex.props(styles.seamLine)} />
                        {format(m.unscheduledFrom)}
                        <span aria-hidden {...stylex.props(styles.seamLine)} />
                      </li>
                    )}
                    <PhaseCard {...rowProps(row, index)} />
                    {editing && !readOnly && index >= shape.scheduled && (
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
          </div>
        )}
      </AsyncSection>

      <PhaseDetailsPanel
        draft={actionsAt !== null ? drafts[actionsAt] : undefined}
        presets={presets.data?.items ?? []}
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
          clear()
          setEdited(null)
          setEditing(false)
          setDiscarding(false)
        }}
        onCancel={() => setDiscarding(false)}
      />
    </div>
  )
}
