import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, Feedback, Field, Panel } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import type { ApiResult } from '@qualy/web-runtime/api'
import { assessmentMessages as m } from './i18n.ts'
import { assessmentApi } from './api.ts'
import { PermissionProfileEditor } from './PermissionProfileEditor.tsx'
import { refusalMessage, refusalsOf } from './refusals.ts'

// The phase plan, as an administrator edits it.
//
// The screen's whole job is to show which of the three time shapes a phase
// has and to let only the legal one be edited: a fixed date where the queue
// can promise one, a duration where it can only be measured from an event,
// and a display-only estimate anywhere. It does not re-implement the rules -
// it submits the plan and renders what the engine refused, which is why a
// refusal reads as a sentence about this phase rather than a form that
// silently forbids a field.

type PhaseDto = ApiResult<typeof assessmentApi, 'assessment', 'getPhases'>['phases'][number]
type BatchDto = ApiResult<typeof assessmentApi, 'assessment', 'getBatch'>['batch']

/** the editable half of a phase, as this screen holds it while typing */
interface Draft {
  id?: string
  phaseKey: string
  displayName: string
  entryTrigger: PhaseDto['entryTrigger']
  plannedEntryAt: string | null
  entryOffset: { days?: number; hours?: number } | null
  estimatedEntryAt: string | null
  permissionProfile: readonly string[]
  itemScope: readonly string[]
  participantScope: readonly string[]
  actualEntryAt: string | null
}

const toDraft = (phase: PhaseDto): Draft => ({
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
  actualEntryAt: phase.actualEntryAt,
})

// `datetime-local` speaks local wall time without a zone; the api speaks
// instants. Both conversions live here so no other component has to know.
const toLocalInput = (iso: string | null): string => {
  if (iso === null) return ''
  const at = new Date(iso)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`
}

const fromLocalInput = (value: string): string | null =>
  value === '' ? null : new Date(value).toISOString()

export function PhaseTimelineEditor({ batch }: { batch: BatchDto }) {
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const query = useApiQuery(assessmentApi)
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()

  const phases = useQuery(
    query.assessment.getPhases.queryOptions({ params: { batchId: batch.id } }),
  )
  const templates = useQuery(query.assessment.listTemplates.queryOptions({ query: {} }))

  const [drafts, setDrafts] = useState<readonly Draft[] | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [refusals, setRefusals] = useState<readonly { reason: string; index?: number }[]>([])
  const [templateId, setTemplateId] = useState('')
  const [reason, setReason] = useState('')

  const server = phases.data?.phases ?? []
  const editing = drafts ?? server.map(toDraft)
  const readOnly = batch.status === 'archived'
  const draftBatch = batch.status === 'draft'

  // which phase the clock says is current, from the entries the server
  // materialized; the badge follows the same rule the gate does
  const currentIndex = useMemo(
    () => server.reduce((found, phase, at) => (phase.actualEntryAt !== null ? at : found), -1),
    [server],
  )

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: query.assessment.key() })
    setDrafts(null)
  }

  const failed = (error: unknown) => {
    const found = refusalsOf(error)
    setRefusals(found)
    setFailure(found.length > 0 ? null : formatError(error))
  }

  const savePlan = useMutation({
    mutationFn: (next: readonly Draft[]) =>
      run(
        api.assessment.putPhases({
          params: { batchId: batch.id },
          payload: {
            phases: next.map((draft) => ({
              ...(draft.id !== undefined ? { id: draft.id } : {}),
              phaseKey: draft.phaseKey,
              displayName: draft.displayName,
              entryTrigger: draft.entryTrigger,
              plannedEntryAt: draft.plannedEntryAt,
              entryOffset: draft.entryOffset,
              estimatedEntryAt: draft.estimatedEntryAt,
              permissionProfile: draft.permissionProfile,
              itemScope: draft.itemScope,
              participantScope: draft.participantScope,
            })),
          },
        }),
      ),
    onMutate: () => {
      setFailure(null)
      setRefusals([])
    },
    onSuccess: invalidate,
    onError: failed,
  })

  const applyTemplate = useMutation({
    mutationFn: () =>
      run(
        api.assessment.putPhases({
          params: { batchId: batch.id },
          payload: { fromTemplateId: templateId },
        }),
      ),
    onMutate: () => {
      setFailure(null)
      setRefusals([])
    },
    onSuccess: invalidate,
    onError: failed,
  })

  const advance = useMutation({
    mutationFn: (input: { to: string; force: boolean }) =>
      run(
        api.assessment.advancePhase({
          params: { batchId: batch.id },
          payload: {
            to: input.to,
            ...(input.force ? { force: true, reason } : {}),
          },
        }),
      ),
    onMutate: () => {
      setFailure(null)
      setRefusals([])
    },
    onSuccess: async () => {
      setReason('')
      await invalidate()
    },
    onError: failed,
  })

  const edit = (at: number, change: Partial<Draft>) =>
    setDrafts(editing.map((draft, index) => (index === at ? { ...draft, ...change } : draft)))

  const insertAfter = (at: number) =>
    setDrafts([
      ...editing.slice(0, at + 1),
      {
        phaseKey: 'supplementary-entry',
        displayName: format(m.insertPhase),
        entryTrigger: 'manual',
        plannedEntryAt: null,
        entryOffset: null,
        estimatedEntryAt: null,
        permissionProfile: [],
        itemScope: [],
        participantScope: [],
        actualEntryAt: null,
      },
      ...editing.slice(at + 1),
    ])

  // a refusal about the plan as a whole rather than about one row
  const planRefusals = refusals.filter((refusal) => refusal.index === undefined)
  const refusalsAt = (index: number) => refusals.filter((refusal) => refusal.index === index)

  return (
    <Panel
      title={format(m.phasesTitle)}
      description={format(m.phasesHint)}
      actions={
        <div className="flex items-end gap-2">
          <Field label={format(m.templateLabel)}>
            {(id) => (
              <select
                id={id}
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={templateId}
                disabled={!draftBatch}
                onChange={(event) => setTemplateId(event.target.value)}
              >
                <option value="">{format(m.templateEmpty)}</option>
                {(templates.data?.items ?? []).map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Button
            size="sm"
            variant="outline"
            disabled={!draftBatch || templateId === '' || applyTemplate.isPending}
            onClick={() => applyTemplate.mutate()}
          >
            {format(m.templateApply)}
          </Button>
        </div>
      }
    >
      <Feedback message={failure} />
      {planRefusals.length > 0 && (
        <Feedback
          message={`${format(m.planRefused)} ${planRefusals
            .map((refusal) => {
              const sentence = refusalMessage(refusal.reason)
              return sentence ? format(sentence) : refusal.reason
            })
            .join(' ')}`}
        />
      )}
      {!draftBatch && templateId !== '' && <p className="text-xs">{format(m.templateDraftOnly)}</p>}

      <AsyncSection
        pending={phases.isPending}
        error={phases.isError ? formatError(phases.error) : null}
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => void phases.refetch()}
      >
        {editing.length === 0 ? (
          <p className="text-sm text-muted-foreground">{format(m.phasesEmpty)}</p>
        ) : (
          <ol className="space-y-4">
            {editing.map((draft, index) => {
              const entered = draft.actualEntryAt !== null
              const ended = index < currentIndex
              const rowRefusals = refusalsAt(index)
              return (
                <li
                  key={draft.id ?? `new-${index}`}
                  className="space-y-3 rounded-md border p-3"
                  aria-label={draft.displayName}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Field label={format(m.displayNameLabel)}>
                      {(id) => (
                        <Input
                          id={id}
                          value={draft.displayName}
                          disabled={readOnly}
                          onChange={(event) => edit(index, { displayName: event.target.value })}
                        />
                      )}
                    </Field>
                    <span className="text-xs text-muted-foreground">
                      {format(
                        draft.entryTrigger === 'scheduled'
                          ? m.triggerScheduled
                          : draft.entryTrigger === 'manual'
                            ? m.triggerManual
                            : m.triggerPublication,
                      )}
                    </span>
                    {index === currentIndex && (
                      <span className="rounded bg-primary/10 px-2 py-0.5 text-xs">
                        {format(m.currentBadge)}
                      </span>
                    )}
                    {ended && (
                      <span className="text-xs text-muted-foreground">{format(m.endedBadge)}</span>
                    )}
                  </div>

                  {/* the three time shapes: exactly one is editable per row */}
                  {entered ? (
                    <p className="text-sm">
                      {format(m.enteredLabel)}:{' '}
                      <time dateTime={draft.actualEntryAt ?? undefined}>
                        {new Date(draft.actualEntryAt!).toLocaleString()}
                      </time>
                    </p>
                  ) : draft.entryTrigger === 'publication' ? (
                    <p className="text-sm text-muted-foreground">{format(m.pendingLabel)}</p>
                  ) : draft.entryOffset !== null ? (
                    <div className="flex flex-wrap items-end gap-2">
                      <Field label={format(m.offsetLabel)}>
                        {(id) => (
                          <Input
                            id={id}
                            type="number"
                            min={0}
                            className="w-24"
                            value={draft.entryOffset?.days ?? 0}
                            disabled={readOnly || draft.plannedEntryAt !== null}
                            onChange={(event) =>
                              edit(index, {
                                entryOffset: {
                                  ...draft.entryOffset,
                                  days: Number(event.target.value),
                                },
                              })
                            }
                          />
                        )}
                      </Field>
                      <span className="pb-2 text-xs">{format(m.offsetDays)}</span>
                      {draft.plannedEntryAt !== null && (
                        <p className="pb-2 text-xs text-muted-foreground">
                          {format(m.offsetFrozen)}
                        </p>
                      )}
                    </div>
                  ) : (
                    <Field
                      label={format(
                        draft.entryTrigger === 'manual' ? m.plannedSlaLabel : m.plannedLabel,
                      )}
                      {...(draft.entryTrigger === 'manual'
                        ? { hint: format(m.plannedSlaHint) }
                        : {})}
                    >
                      {(id) => (
                        <Input
                          id={id}
                          type="datetime-local"
                          value={toLocalInput(draft.plannedEntryAt)}
                          disabled={readOnly}
                          onChange={(event) =>
                            edit(index, { plannedEntryAt: fromLocalInput(event.target.value) })
                          }
                        />
                      )}
                    </Field>
                  )}

                  <PermissionProfileEditor
                    legend={format(m.profileTitle)}
                    profile={draft.permissionProfile}
                    disabled={readOnly || ended}
                    onChange={(next) => edit(index, { permissionProfile: next })}
                  />

                  {rowRefusals.map((refusal) => {
                    const sentence = refusalMessage(refusal.reason)
                    return (
                      <Feedback
                        key={refusal.reason}
                        message={sentence ? format(sentence) : refusal.reason}
                      />
                    )
                  })}

                  <div className="flex flex-wrap items-center gap-2">
                    {!readOnly && (
                      <Button size="sm" variant="ghost" onClick={() => insertAfter(index)}>
                        {format(m.insertPhase)}
                      </Button>
                    )}
                    {batch.status === 'active' && index === currentIndex + 1 && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={advance.isPending || draft.id === undefined}
                          onClick={() =>
                            advance.mutate({
                              to: draft.id!,
                              force: draft.entryTrigger !== 'manual',
                            })
                          }
                        >
                          {format(draft.entryTrigger === 'manual' ? m.advance : m.advanceForce)}
                        </Button>
                        {draft.entryTrigger !== 'manual' && (
                          <Field label={format(m.advanceReason)} hint={format(m.advanceForceHint)}>
                            {(id) => (
                              <Input
                                id={id}
                                value={reason}
                                onChange={(event) => setReason(event.target.value)}
                              />
                            )}
                          </Field>
                        )}
                      </>
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
        )}

        {!readOnly && editing.length > 0 && (
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={savePlan.isPending}
              onClick={() => savePlan.mutate(editing)}
            >
              {format(m.save)}
            </Button>
            {drafts !== null && (
              <Button size="sm" variant="outline" onClick={() => setDrafts(null)}>
                {format(m.cancel)}
              </Button>
            )}
          </div>
        )}
      </AsyncSection>
    </Panel>
  )
}
