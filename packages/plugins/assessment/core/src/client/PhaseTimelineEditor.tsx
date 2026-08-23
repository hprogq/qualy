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
import { cn } from '@qualy/ui/cn'
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
    <TableRow className="h-0 border-0 hover:bg-transparent">
      {/* the strip takes no height of its own: it straddles the seam the two
          neighbouring rows already draw, so revealing it moves nothing.
          movement decides what is shown, not :hover - inserting a row moves
          the strip under a pointer that has not moved, and css would leave it
          lit until the pointer did */}
      <TableCell colSpan={4} className="relative h-0 border-0 p-0">
        <div
          onMouseMove={() => onPoint(true)}
          onMouseLeave={() => onPoint(false)}
          className={cn(
            'absolute inset-x-0 -top-1.5 z-10 flex h-3 items-center gap-2 px-3 transition-opacity focus-within:opacity-100',
            shown ? 'opacity-100' : 'opacity-0',
          )}
        >
          <span aria-hidden className="h-px flex-1 bg-border" />
          <Button
            variant="outline"
            className="h-6 gap-1 bg-background px-2 text-xs"
            onClick={(event) => {
              // the strip is also held open by focus, and the row it just
              // added has moved it out from under the pointer
              event.currentTarget.blur()
              onInsert()
            }}
          >
            <PlusIcon aria-hidden className="size-3" />
            {label}
          </Button>
          <span aria-hidden className="h-px flex-1 bg-border" />
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
    <div className="space-y-3">
      {/* the page header says what a stage plan is; this row is only the
          controls that act on it */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="flex shrink-0 items-center gap-2">
          {editing && dirty > 0 && (
            <span className="text-xs text-muted-foreground">
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
          <div className="flex flex-col gap-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        }
      >
        {drafts.length === 0 ? (
          <div
            data-testid="phase-plan-empty"
            className="space-y-4 rounded-lg border border-dashed p-8 text-center"
          >
            <p className="text-sm text-muted-foreground">{format(m.phasesEmpty)}</p>
            {!readOnly && (
              <div className="flex justify-center gap-2">
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
          <div className="space-y-2">
            {/* a table where there are columns to be had, stacked cards where
                there are not - the same four facts either way */}
            {!isMobile && (
              <div className="overflow-hidden rounded-lg border">
                {/* fixed tracks, so a long stage name cannot take the width
                  the other columns need */}
                <Table className="table-fixed">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-[26%]">{format(m.colStage)}</TableHead>
                      <TableHead className="w-[26%]">{format(m.colOpens)}</TableHead>
                      <TableHead className="w-[26%]">{format(m.colPlannedStart)}</TableHead>
                      <TableHead className="w-[22%] text-right">{format(m.colStatus)}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {drafts.map((row, index) => (
                      <Fragment key={row.id ?? `new-${row.phaseKey}`}>
                        {index === shape.scheduled && index > 0 && (
                          <TableRow className="hover:bg-transparent">
                            <TableCell
                              colSpan={4}
                              className="border-b-0 bg-muted/30 py-1 text-center text-xs text-muted-foreground"
                            >
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
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={4} className="p-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="w-full text-muted-foreground"
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
              <ol className="space-y-2">
                {drafts.map((row, index) => (
                  <Fragment key={row.id ?? `new-${row.phaseKey}`}>
                    {index === shape.scheduled && index > 0 && (
                      <li className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
                        <span aria-hidden className="h-px flex-1 bg-border" />
                        {format(m.unscheduledFrom)}
                        <span aria-hidden className="h-px flex-1 bg-border" />
                      </li>
                    )}
                    <PhaseCard {...rowProps(row, index)} />
                    {editing && !readOnly && index >= shape.scheduled && (
                      <li>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-full text-xs text-muted-foreground"
                          onClick={() => insertAt(index + 1)}
                        >
                          <PlusIcon aria-hidden className="size-3" />
                          {format(m.insertHere)}
                        </Button>
                      </li>
                    )}
                  </Fragment>
                ))}
                {editing && !readOnly && (
                  <li>
                    <Button size="sm" variant="outline" className="w-full" onClick={addPhase}>
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
