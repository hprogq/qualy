import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import {
  AsyncSection,
  ConfirmDialog,
  Feedback,
  Field,
  FormDialog,
  RadioGroup,
  SidePanel,
} from '@qualy/ui/admin'
import { Badge } from '@qualy/ui/badge'
import { Steps } from '@qualy/ui/steps'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { Skeleton } from '@qualy/ui/skeleton'
import { NativeSelect } from '@qualy/ui/native-select'
import type { ApiResult } from '@qualy/web-runtime/api'
import { assessmentMessages as m } from './i18n.ts'
import { assessmentApi } from './api.ts'
import { PermissionProfileEditor } from './PermissionProfileEditor.tsx'
import { refusalMessage, refusalsOf } from './refusals.ts'

// The stage plan: a readable list, and a side panel that edits one stage at
// a time.
//
// The list states plainly when each stage runs; every form control lives in
// the panel, which submits the whole plan on save and shows what was refused
// as sentences. Templates come in two flavours and neither is ever required:
// a timeline replaces a draft's whole plan, a stage preset fills in one
// stage's name and actions inside the panel. A plan can just as well be built
// from nothing, one stage at a time.

type PhaseDto = ApiResult<typeof assessmentApi, 'assessment', 'getPhases'>['phases'][number]
type BatchDto = ApiResult<typeof assessmentApi, 'assessment', 'getBatch'>['batch']

/** the editable half of one stage, as the panel holds it while typing */
interface Draft {
  id?: string
  phaseKey: string
  displayName: string
  entryTrigger: PhaseDto['entryTrigger']
  plannedEntryAt: string | null
  entryOffset: PhaseDto['entryOffset']
  estimatedEntryAt: string | null
  permissionProfile: readonly string[]
  itemScope: readonly string[]
  participantScope: readonly string[]
}

interface PanelState {
  index: number
  isNew: boolean
  draft: Draft
  /** which part of the stage is on screen; the header jumps between them */
  step: number
}

const specOf = (phase: PhaseDto): Draft => ({
  id: phase.id,
  phaseKey: phase.phaseKey,
  displayName: phase.displayName,
  entryTrigger: phase.entryTrigger,
  plannedEntryAt: phase.plannedEntryAt,
  entryOffset: phase.entryOffset,
  estimatedEntryAt: phase.estimatedEntryAt,
  permissionProfile: phase.permissionProfile,
  itemScope: phase.itemScope,
  participantScope: phase.participantScope,
})

/** a key no other stage in the plan uses yet */
const freshKey = (taken: readonly { phaseKey: string }[]) => {
  const used = new Set(taken.map((spec) => spec.phaseKey))
  let n = taken.length + 1
  while (used.has(`stage-${n}`)) n += 1
  return `stage-${n}`
}

// `datetime-local` speaks local wall time without a zone; the api speaks
// instants. Both conversions live here so nothing else has to know.
const toLocalInput = (iso: string | null): string => {
  if (iso === null) return ''
  const at = new Date(iso)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`
}

const fromLocalInput = (value: string): string | null =>
  value === '' ? null : new Date(value).toISOString()

const timeOf = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

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

  // which overlay is open; the panel holds the one stage being edited
  const [panel, setPanel] = useState<PanelState | null>(null)
  const [timelineDialog, setTimelineDialog] = useState(false)
  const [timelineId, setTimelineId] = useState('')
  const [presetId, setPresetId] = useState('')
  const [removing, setRemoving] = useState(false)
  const [starting, setStarting] = useState<{ id: string; name: string; force: boolean } | null>(
    null,
  )
  const [reason, setReason] = useState('')
  const [failure, setFailure] = useState<string | null>(null)
  const [refused, setRefused] = useState<readonly string[]>([])

  const server = phases.data?.phases ?? []
  const readOnly = batch.status === 'archived'
  const active = batch.status === 'active'
  const currentIndex = server.reduce(
    (found, phase, at) => (phase.actualEntryAt !== null ? at : found),
    -1,
  )

  const clear = () => {
    setFailure(null)
    setRefused([])
  }

  const failed = (error: unknown) => {
    const sentences = refusalsOf(error).map((refusal) => {
      const sentence = refusalMessage(refusal.reason)
      return sentence ? format(sentence) : refusal.reason
    })
    setRefused(sentences)
    setFailure(sentences.length > 0 ? null : formatError(error))
  }

  const settle = () => queryClient.invalidateQueries({ queryKey: query.assessment.key() })

  const savePlan = useMutation({
    mutationFn: (specs: readonly Draft[]) =>
      run(
        api.assessment.putPhases({
          params: { batchId: batch.id },
          payload: {
            phases: specs.map((spec) => ({
              ...(spec.id !== undefined ? { id: spec.id } : {}),
              phaseKey: spec.phaseKey,
              displayName: spec.displayName,
              entryTrigger: spec.entryTrigger,
              plannedEntryAt: spec.plannedEntryAt,
              entryOffset: spec.entryOffset,
              estimatedEntryAt: spec.estimatedEntryAt,
              permissionProfile: spec.permissionProfile,
              itemScope: spec.itemScope,
              participantScope: spec.participantScope,
            })),
          },
        }),
      ),
    onMutate: clear,
    onSuccess: async () => {
      await settle()
      setPanel(null)
      setRemoving(false)
    },
    onError: failed,
  })

  const applyTimeline = useMutation({
    mutationFn: (templateId: string) =>
      run(
        api.assessment.putPhases({
          params: { batchId: batch.id },
          payload: { fromTemplateId: templateId },
        }),
      ),
    onMutate: clear,
    onSuccess: async () => {
      await settle()
      setTimelineDialog(false)
      setTimelineId('')
    },
    onError: failed,
  })

  const advance = useMutation({
    mutationFn: (input: { to: string; force: boolean; reason: string }) =>
      run(
        api.assessment.advancePhase({
          params: { batchId: batch.id },
          payload: {
            to: input.to,
            ...(input.force ? { force: true, reason: input.reason } : {}),
          },
        }),
      ),
    onMutate: clear,
    onSuccess: async () => {
      await settle()
      setStarting(null)
      setReason('')
    },
    onError: (error: unknown) => {
      setStarting(null)
      setFailure(formatError(error))
    },
  })

  const openEditor = (index: number) => {
    clear()
    setPresetId('')
    setPanel({ index, isNew: false, step: 0, draft: specOf(server[index]!) })
  }

  const openNew = () => {
    clear()
    setPresetId('')
    const specs = server.map(specOf)
    // while the batch runs, the only legal place is right after the stage
    // happening now; a draft simply grows at the end
    const index = active ? currentIndex + 1 : specs.length
    setPanel({
      index,
      isNew: true,
      step: 0,
      draft: {
        phaseKey: freshKey(specs),
        displayName: '',
        entryTrigger: 'manual',
        plannedEntryAt: null,
        entryOffset: null,
        estimatedEntryAt: null,
        permissionProfile: [],
        itemScope: [],
        participantScope: [],
      },
    })
  }

  const saveFromPanel = (state: PanelState) => {
    if (state.draft.displayName.trim() === '') {
      setRefused([format(m.phaseNameRequired)])
      setPanel((current) => (current ? { ...current, step: 0 } : current))
      return
    }
    const specs = server.map(specOf)
    if (state.isNew) specs.splice(state.index, 0, state.draft)
    else specs[state.index] = state.draft
    savePlan.mutate(specs)
  }

  const removeFromPanel = (state: PanelState) => {
    savePlan.mutate(server.map(specOf).filter((_, at) => at !== state.index))
  }

  const edit = (change: Partial<Draft>) =>
    setPanel((current) =>
      current ? { ...current, draft: { ...current.draft, ...change } } : current,
    )

  const applyPreset = () => {
    const preset = (presets.data?.items ?? []).find((row) => row.id === presetId)
    const spec = preset?.phases[0]
    if (!spec) return
    // a preset is a starting point: it fills the name and the actions, and
    // everything stays editable afterwards
    edit({ displayName: spec.displayName, permissionProfile: spec.permissionProfile ?? [] })
  }

  const triggerLabelOf = (trigger: PhaseDto['entryTrigger']) =>
    trigger === 'scheduled'
      ? m.triggerScheduled
      : trigger === 'manual'
        ? m.triggerManual
        : m.triggerPublication

  // what one row of the list says about when its stage runs
  const startLine = (phase: PhaseDto) => {
    if (phase.actualEntryAt !== null)
      return format(m.startedAt, { time: timeOf(phase.actualEntryAt) })
    if (phase.entryTrigger === 'publication') return format(m.publicationStart)
    if (phase.plannedEntryAt !== null)
      return format(m.startsAt, { time: timeOf(phase.plannedEntryAt) })
    if (phase.entryOffset !== null)
      return format(m.offsetDaysAfter, { days: phase.entryOffset.days ?? 0 })
    if (phase.entryTrigger === 'manual')
      return phase.estimatedEntryAt !== null
        ? format(m.targetAt, { time: timeOf(phase.estimatedEntryAt) })
        : format(m.manualStart)
    return format(m.timeUndecided)
  }

  const panelBody = (state: PanelState) => {
    const draft = state.draft
    const entered = !state.isNew && server[state.index]?.actualEntryAt != null
    const ended = !state.isNew && state.index < currentIndex
    const triggerFrozen = readOnly || (active && !state.isNew)
    // an interval that has already produced a calendar time is settled
    const offsetSettled = draft.entryOffset !== null && draft.plannedEntryAt !== null
    const stepped = (
      <>
        <Steps
          steps={[format(m.stepPhaseBasics), format(m.stepPhaseOpens)]}
          current={state.step}
          onSelect={(index) =>
            setPanel((current) => (current ? { ...current, step: index } : current))
          }
        />
        {refused.length > 0 && (
          <Feedback message={`${format(m.planRefusedIntro)} ${refused.join(' ')}`} />
        )}
        <Feedback message={failure} />
      </>
    )

    const basics = (
      <>
        <Field label={format(m.displayNameLabel)}>
          {(id) => (
            <Input
              id={id}
              value={draft.displayName}
              disabled={readOnly}
              onChange={(event) => edit({ displayName: event.target.value })}
            />
          )}
        </Field>

        {!readOnly && !entered && (presets.data?.items ?? []).length > 0 && (
          <fieldset className="space-y-2 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">{format(m.phaseTemplateLegend)}</legend>
            <p className="text-xs text-muted-foreground">{format(m.phaseTemplateHint)}</p>
            <div className="flex gap-2">
              <NativeSelect
                aria-label={format(m.phaseTemplateLegend)}
                value={presetId}
                onChange={(event) => setPresetId(event.target.value)}
              >
                <option value="">{format(m.phaseTemplateChoose)}</option>
                {(presets.data?.items ?? []).map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </NativeSelect>
              <Button size="sm" variant="outline" disabled={presetId === ''} onClick={applyPreset}>
                {format(m.phaseTemplateApply)}
              </Button>
            </div>
          </fieldset>
        )}
      </>
    )

    const timing = (
      <>
        {entered ? (
          // a started stage still shows what it is and when it began - just
          // as a record rather than as controls
          <>
            <RadioGroup
              legend={format(m.triggerLegend)}
              name="entry-trigger-entered"
              variant="cards"
              options={[
                {
                  value: 'scheduled',
                  label: format(m.triggerScheduled),
                  hint: format(m.triggerScheduledHint),
                },
                {
                  value: 'manual',
                  label: format(m.triggerManual),
                  hint: format(m.triggerManualHint),
                },
                {
                  value: 'publication',
                  label: format(m.triggerPublication),
                  hint: format(m.triggerPublicationHint),
                },
              ]}
              selected={draft.entryTrigger}
              disabled
              onChange={() => undefined}
            />
            <Field label={format(m.startedLabel)} hint={format(m.startedNotice)}>
              {(id) => (
                <Input
                  id={id}
                  type="datetime-local"
                  value={toLocalInput(server[state.index]!.actualEntryAt)}
                  disabled
                  readOnly
                />
              )}
            </Field>
          </>
        ) : (
          <>
            <div className="space-y-2">
              <RadioGroup
                legend={format(m.triggerLegend)}
                name="entry-trigger"
                variant="cards"
                options={[
                  {
                    value: 'scheduled',
                    label: format(m.triggerScheduled),
                    hint: format(m.triggerScheduledHint),
                  },
                  {
                    value: 'manual',
                    label: format(m.triggerManual),
                    hint: format(m.triggerManualHint),
                  },
                  {
                    value: 'publication',
                    label: format(m.triggerPublication),
                    hint: format(m.triggerPublicationHint),
                  },
                ]}
                selected={draft.entryTrigger}
                disabled={triggerFrozen}
                onChange={(next) =>
                  edit({
                    entryTrigger: next as Draft['entryTrigger'],
                    plannedEntryAt: null,
                    entryOffset: null,
                  })
                }
              />
              {active && !state.isNew && !readOnly && (
                <p className="text-xs text-muted-foreground">{format(m.triggerFrozen)}</p>
              )}
            </div>

            {draft.entryTrigger === 'scheduled' && offsetSettled && (
              <>
                <Field label={format(m.plannedLabel)}>
                  {(id) => (
                    <Input
                      id={id}
                      type="datetime-local"
                      value={toLocalInput(draft.plannedEntryAt)}
                      disabled
                    />
                  )}
                </Field>
                <p className="text-xs text-muted-foreground">{format(m.offsetFrozen)}</p>
              </>
            )}
            {draft.entryTrigger === 'scheduled' && !offsetSettled && (
              <>
                <RadioGroup
                  legend={format(m.timeModeLegend)}
                  name="time-mode"
                  variant="cards"
                  options={[
                    {
                      value: 'date',
                      label: format(m.timeModeDate),
                      hint: format(m.timeModeDateHint),
                    },
                    {
                      value: 'offset',
                      label: format(m.timeModeOffset),
                      hint: format(m.offsetHint),
                    },
                  ]}
                  selected={draft.entryOffset !== null ? 'offset' : 'date'}
                  disabled={readOnly}
                  onChange={(next) =>
                    edit(
                      next === 'offset'
                        ? { entryOffset: { days: 1 }, plannedEntryAt: null }
                        : { entryOffset: null },
                    )
                  }
                />
                {draft.entryOffset !== null ? (
                  <Field label={format(m.offsetLabel)}>
                    {(id) => (
                      <Input
                        id={id}
                        type="number"
                        min={1}
                        className="w-28"
                        value={draft.entryOffset?.days ?? 0}
                        disabled={readOnly}
                        onChange={(event) =>
                          edit({ entryOffset: { days: Number(event.target.value) } })
                        }
                      />
                    )}
                  </Field>
                ) : (
                  <Field label={format(m.plannedLabel)}>
                    {(id) => (
                      <Input
                        id={id}
                        type="datetime-local"
                        value={toLocalInput(draft.plannedEntryAt)}
                        disabled={readOnly}
                        onChange={(event) =>
                          edit({ plannedEntryAt: fromLocalInput(event.target.value) })
                        }
                      />
                    )}
                  </Field>
                )}
              </>
            )}

            {draft.entryTrigger === 'manual' && (
              <Field label={format(m.plannedSlaLabel)} hint={format(m.plannedSlaHint)}>
                {(id) => (
                  <Input
                    id={id}
                    type="datetime-local"
                    value={toLocalInput(draft.estimatedEntryAt)}
                    disabled={readOnly}
                    onChange={(event) =>
                      edit({ estimatedEntryAt: fromLocalInput(event.target.value) })
                    }
                  />
                )}
              </Field>
            )}
            {draft.entryTrigger === 'scheduled' && (
              <Field label={format(m.estimatedLabel)} hint={format(m.estimatedHint)}>
                {(id) => (
                  <Input
                    id={id}
                    type="datetime-local"
                    value={toLocalInput(draft.estimatedEntryAt)}
                    disabled={readOnly}
                    onChange={(event) =>
                      edit({ estimatedEntryAt: fromLocalInput(event.target.value) })
                    }
                  />
                )}
              </Field>
            )}
          </>
        )}
      </>
    )

    const opens = (
      <PermissionProfileEditor
        legend={format(m.profileTitle)}
        hint={format(m.profileHint)}
        profile={draft.permissionProfile}
        disabled={readOnly || ended}
        onChange={(next) => edit({ permissionProfile: next })}
      />
    )

    return (
      <>
        {stepped}
        {state.step === 0 ? (
          <>
            {basics}
            {timing}
          </>
        ) : (
          opens
        )}
      </>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{format(m.phasesHint)}</p>
        {!readOnly && (
          <div className="flex shrink-0 gap-2">
            {batch.status === 'draft' && (
              <Button size="sm" variant="outline" onClick={() => setTimelineDialog(true)}>
                {format(m.timelineTemplateApply)}
              </Button>
            )}
            <Button size="sm" onClick={openNew}>
              {format(m.addPhase)}
            </Button>
          </div>
        )}
      </div>

      {panel === null && <Feedback message={failure} />}
      {panel === null && refused.length > 0 && (
        <Feedback message={`${format(m.planRefusedIntro)} ${refused.join(' ')}`} />
      )}

      <AsyncSection
        pending={phases.isPending}
        error={phases.isError ? formatError(phases.error) : null}
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => void phases.refetch()}
        skeleton={
          <div className="flex flex-col gap-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        }
      >
        {server.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <p className="text-sm text-muted-foreground">{format(m.phasesEmpty)}</p>
          </div>
        ) : (
          <ol className="divide-y rounded-lg border">
            {server.map((phase, index) => {
              const ended = index < currentIndex
              const current = index === currentIndex
              const upNext = active && index === currentIndex + 1
              return (
                <li
                  key={phase.id}
                  aria-label={phase.displayName}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
                >
                  <span
                    className={
                      current
                        ? 'flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground'
                        : 'flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground'
                    }
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{phase.displayName}</span>
                      <Badge variant="outline">{format(triggerLabelOf(phase.entryTrigger))}</Badge>
                      {current && <Badge>{format(m.currentBadge)}</Badge>}
                      {ended && <Badge variant="secondary">{format(m.endedBadge)}</Badge>}
                      {upNext && <Badge variant="outline">{format(m.upNextBadge)}</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {format(m.opensCount, { count: phase.permissionProfile.length })}
                    </p>
                  </div>
                  {/* when it runs is the row's other half, not a footnote */}
                  <p className="shrink-0 text-sm text-muted-foreground max-sm:w-full">
                    {startLine(phase)}
                  </p>
                  <div className="flex shrink-0 items-center gap-2">
                    {upNext && phase.entryTrigger !== 'publication' && (
                      <Button
                        size="sm"
                        onClick={() =>
                          setStarting({
                            id: phase.id,
                            name: phase.displayName,
                            force: phase.entryTrigger !== 'manual',
                          })
                        }
                      >
                        {format(phase.entryTrigger === 'manual' ? m.advance : m.advanceForce)}
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => openEditor(index)}>
                      {format(readOnly ? m.viewPhase : m.editPhase)}
                    </Button>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </AsyncSection>

      {/* one stage, edited in place */}
      <SidePanel
        open={panel !== null}
        title={panel?.draft.displayName?.trim() || format(m.phasePanelTitle)}
        onClose={() => setPanel(null)}
        footer={
          <>
            <Button variant="ghost" className="mr-auto" onClick={() => setPanel(null)}>
              {format(readOnly ? m.close : m.cancel)}
            </Button>
            {!readOnly && panel !== null && !panel.isNew && batch.status === 'draft' && (
              <Button
                variant="ghost"
                className="text-destructive"
                onClick={() => setRemoving(true)}
              >
                {format(m.removePhase)}
              </Button>
            )}
            {!readOnly && panel !== null && (
              <Button
                variant={panel.step < 1 ? 'outline' : 'default'}
                disabled={savePlan.isPending}
                onClick={() => saveFromPanel(panel)}
              >
                {format(m.save)}
              </Button>
            )}
            {!readOnly && panel !== null && panel.step < 1 && (
              <Button
                onClick={() =>
                  setPanel((current) =>
                    current ? { ...current, step: current.step + 1 } : current,
                  )
                }
              >
                {format(m.next)}
              </Button>
            )}
          </>
        }
      >
        {panel !== null && panelBody(panel)}
      </SidePanel>

      {/* a ready-made timeline replaces a draft's whole plan */}
      <FormDialog
        open={timelineDialog}
        title={format(m.timelineTemplateTitle)}
        description={format(m.timelineTemplateBody)}
        onClose={() => setTimelineDialog(false)}
        footer={
          <>
            <Button variant="outline" onClick={() => setTimelineDialog(false)}>
              {format(m.cancel)}
            </Button>
            <Button
              disabled={timelineId === '' || applyTimeline.isPending}
              onClick={() => applyTimeline.mutate(timelineId)}
            >
              {format(m.timelineTemplateApply)}
            </Button>
          </>
        }
      >
        {(timelines.data?.items ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{format(m.timelineTemplateEmpty)}</p>
        ) : (
          <Field label={format(m.timelineTemplateLabel)}>
            {(id) => (
              <NativeSelect
                id={id}
                value={timelineId}
                onChange={(event) => setTimelineId(event.target.value)}
              >
                <option value="">{format(m.timelineTemplateChoose)}</option>
                {(timelines.data?.items ?? []).map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        )}
      </FormDialog>

      {/* starting a stage by hand, with a reason when it jumps its time */}
      <ConfirmDialog
        open={starting !== null && !starting.force}
        title={format(m.confirmStartPhase, { name: starting?.name ?? '' })}
        confirmLabel={format(m.advance)}
        cancelLabel={format(m.cancel)}
        pending={advance.isPending}
        onConfirm={() => starting && advance.mutate({ to: starting.id, force: false, reason: '' })}
        onCancel={() => setStarting(null)}
      />
      <FormDialog
        open={starting !== null && starting.force}
        title={format(m.advanceForceTitle)}
        description={format(m.advanceForceBody)}
        onClose={() => setStarting(null)}
        footer={
          <>
            <Button variant="outline" onClick={() => setStarting(null)}>
              {format(m.cancel)}
            </Button>
            <Button
              disabled={reason.trim() === '' || advance.isPending}
              onClick={() =>
                starting && advance.mutate({ to: starting.id, force: true, reason: reason.trim() })
              }
            >
              {format(m.advanceForce)}
            </Button>
          </>
        }
      >
        <Field label={format(m.advanceReason)}>
          {(id) => (
            <Input id={id} value={reason} onChange={(event) => setReason(event.target.value)} />
          )}
        </Field>
      </FormDialog>

      <ConfirmDialog
        open={removing}
        title={format(m.confirmRemovePhase, { name: panel?.draft.displayName ?? '' })}
        confirmLabel={format(m.removePhase)}
        cancelLabel={format(m.cancel)}
        pending={savePlan.isPending}
        onConfirm={() => panel && removeFromPanel(panel)}
        onCancel={() => setRemoving(false)}
      />
    </div>
  )
}
