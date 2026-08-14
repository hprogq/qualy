import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import {
  ArrowRightIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  XIcon,
} from 'lucide-react'
import { Feedback, Field } from '@qualy/ui/admin'
import { cn } from '@qualy/ui/cn'
import { Button } from '@qualy/ui/button'
import { Checkbox } from '@qualy/ui/checkbox'
import { Input } from '@qualy/ui/input'
import { NativeSelect } from '@qualy/ui/native-select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@qualy/ui/tabs'
import { Textarea } from '@qualy/ui/textarea'
import { toast } from '@qualy/ui/toast'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { trimAmount, type ItemDto } from '../entry/model.ts'
import { FieldList, FieldSheet, type FieldDraft } from './FieldSheet.tsx'
import { StageSheet, type StageDraft } from './StageSheet.tsx'
import { ReasonDialog } from './ReasonDialog.tsx'
import type { ItemOptions } from './options.ts'

const blankField = (key: string): FieldDraft => ({
  key,
  type: 'text',
  label: '',
  required: false,
  maxLength: '',
  min: '',
  max: '',
  maxCount: '1',
  maxSizeMb: '',
  accept: '',
})

let minted = 0
const blankStage = (options: ItemOptions, chain: 'normal' | 'escalation'): StageDraft => ({
  key: `s${(minted += 1)}`,
  kind: 'roleAt',
  nodeTypeId: options.orgTypes[0]?.id ?? '',
  roleIds: [],
  roleId: options.roles[0]?.id ?? '',
  chain,
})

// One question, composed rather than typed: the fields participants will
// fill, what each approved entry counts, and who reviews at which level.
// The editor builds the same configuration object the api validates, so the
// server stays the judge and this stays a pen.
//
// The review chain is drawn as what it is - a path from submission to a
// finished review - with one step open for editing at a time and the rest
// folded to what they resolve to.

/**
 * The key is the payload's own word for a field, so it is minted once and
 * never reused: renaming one would leave every filed answer pointing at a
 * field that no longer exists. Numbering walks forward past deleted fields
 * for the same reason. Nobody types it - the label is what a person writes.
 */
const nextKey = (fields: readonly FieldDraft[]): string => {
  const used = fields.map((field) => Number(/^f(\d+)$/.exec(field.key)?.[1] ?? 0))
  return `f${Math.max(0, ...used) + 1}`
}

interface Draft {
  title: string
  scoreGroupId: string
  maxEntries: string
  entrySource: 'student' | 'administrative'
  description: string
  fields: FieldDraft[]
  fixedValue: string
  stages: StageDraft[]
}

/** the stored configuration back into the pen; a shape this pen cannot hold starts fresh */
const draftOf = (
  item: ItemDto | null,
  groups: readonly { id: string }[],
  options: ItemOptions,
): Draft => {
  const revision = item?.currentRevision ?? null
  const config = revision as {
    entrySource?: 'student' | 'administrative'
    formConfig?: unknown
    scoringConfig?: unknown
    reviewPolicy?: unknown
    displayConfig?: unknown
  } | null
  const fields = Array.isArray((config?.formConfig as { fields?: unknown[] })?.fields)
    ? ((config!.formConfig as { fields: Record<string, unknown>[] }).fields.map(
        (field): FieldDraft => ({
          key: String(field['key'] ?? ''),
          type: (field['type'] as FieldDraft['type']) ?? 'text',
          label: String(field['label'] ?? ''),
          required: field['required'] === true,
          maxLength: field['maxLength'] === undefined ? '' : String(field['maxLength']),
          min: String(field['min'] ?? ''),
          max: String(field['max'] ?? ''),
          maxCount: field['maxCount'] === undefined ? '1' : String(field['maxCount']),
          maxSizeMb:
            field['maxFileBytes'] === undefined
              ? ''
              : String(Math.round(Number(field['maxFileBytes']) / (1024 * 1024))),
          accept: Array.isArray(field['accept']) ? (field['accept'] as string[]).join(', ') : '',
        }),
      ) ?? [])
    : []
  const scoring = config?.scoringConfig as
    { calculator?: { config?: { value?: string } } } | undefined
  const policy = config?.reviewPolicy as
    | {
        stages?: {
          selector?: { kind?: string; nodeTypeId?: string; roleIds?: string[]; roleId?: string }
        }[]
        normalTerminal?: number
      }
    | undefined
  const terminal = policy?.normalTerminal ?? 0
  const stages = (policy?.stages ?? []).map((stage, index): StageDraft => {
    const selector = stage.selector ?? {}
    // the stored form is one list with a marker; the screen shows two paths,
    // because "where does the ordinary flow end" is not a thing anybody
    // should have to hold in their head as an index
    const chain = index <= terminal ? ('normal' as const) : ('escalation' as const)
    return selector.kind === 'nearestRole'
      ? {
          key: `s${(minted += 1)}`,
          kind: 'nearestRole',
          nodeTypeId: options.orgTypes[0]?.id ?? '',
          roleIds: [],
          roleId: selector.roleId ?? options.roles[0]?.id ?? '',
          chain,
        }
      : {
          key: `s${(minted += 1)}`,
          kind: 'roleAt',
          nodeTypeId: selector.nodeTypeId ?? options.orgTypes[0]?.id ?? '',
          roleIds: selector.roleIds ?? [],
          roleId: options.roles[0]?.id ?? '',
          chain,
        }
  })
  return {
    title: item?.title ?? '',
    scoreGroupId:
      item !== null && item.scoreGroupId !== '' ? item.scoreGroupId : (groups[0]?.id ?? ''),
    maxEntries: item === null ? '1' : item.maxEntries === null ? '' : String(item.maxEntries),
    entrySource: config?.entrySource ?? 'student',
    description: String((config?.displayConfig as { description?: unknown })?.description ?? ''),
    fields: fields.length > 0 ? fields : [blankField('f1')],
    fixedValue: scoring?.calculator?.config?.value ?? '1.00',
    stages: stages.length > 0 ? stages : [blankStage(options, 'normal')],
  }
}

/** the pen back into the configuration the api validates */
const configOf = (draft: Draft) => ({
  entrySource: draft.entrySource,
  formConfig: {
    fields: draft.fields.map((field) => ({
      key: field.key.trim(),
      type: field.type,
      label: field.label.trim(),
      ...(field.required ? { required: true } : {}),
      ...(field.type === 'text' && field.maxLength.trim() !== ''
        ? { maxLength: Number(field.maxLength) }
        : {}),
      ...(field.type === 'date' && field.min.trim() !== '' ? { min: field.min.trim() } : {}),
      ...(field.type === 'date' && field.max.trim() !== '' ? { max: field.max.trim() } : {}),
      ...(field.type === 'attachment'
        ? {
            maxCount: Number(field.maxCount) > 0 ? Number(field.maxCount) : 1,
            ...(field.maxSizeMb.trim() !== ''
              ? { maxFileBytes: Number(field.maxSizeMb) * 1024 * 1024 }
              : {}),
            ...(field.accept.trim() !== ''
              ? {
                  accept: field.accept
                    .split(',')
                    .map((kind) => kind.trim())
                    .filter((kind) => kind !== ''),
                }
              : {}),
          }
        : {}),
    })),
  },
  scoringConfig: {
    calculator: { ref: 'fixed@1', config: { value: draft.fixedValue.trim() } },
    aggregator: { ref: 'sum@1', config: {} },
  },
  ...(draft.description.trim() !== ''
    ? { displayConfig: { description: draft.description.trim() } }
    : {}),
  reviewPolicy: (() => {
    const normal = draft.stages.filter((stage) => stage.chain === 'normal')
    const escalation = draft.stages.filter((stage) => stage.chain === 'escalation')
    return {
      stages: [...normal, ...escalation].map((stage) => ({
        selector:
          stage.kind === 'roleAt'
            ? { kind: 'roleAt', nodeTypeId: stage.nodeTypeId, roleIds: stage.roleIds }
            : { kind: 'nearestRole', roleId: stage.roleId },
        quorum: { type: 'any' },
      })),
      // where the ordinary flow ends is the last ordinary step; the author
      // never sees this number, they see two paths
      normalTerminal: Math.max(0, normal.length - 1),
    }
  })(),
})

export function ItemConfigEditor({
  batchId,
  batchStatus,
  materialRange,
  item,
  groups,
  defaultGroupId,
  options,
  actions,
  onTitleChange,
  onCancel,
  onSaved,
}: {
  batchId: string
  batchStatus: string
  /** the round's own window; a date field can only narrow it, never widen it */
  materialRange: { start: string; end: string }
  /** null while a question is being composed and has never been saved */
  item: ItemDto | null
  groups: readonly { id: string; name: string }[]
  /** the group a new question was opened inside */
  defaultGroupId?: string | undefined
  options: ItemOptions
  /** what can be done to the question as a whole, drawn beside its title */
  actions?: React.ReactNode
  /** told the name as it is typed, so a row standing for this reads true */
  onTitleChange?: ((title: string) => void) | undefined
  onCancel: () => void
  onSaved: (itemId: string) => void
}) {
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const { format, formatError } = useI18n()
  const [draft, setDraft] = useState<Draft>(() => {
    const seeded = draftOf(item, groups, options)
    return defaultGroupId === undefined ? seeded : { ...seeded, scoreGroupId: defaultGroupId }
  })
  const [problem, setProblem] = useState<string | null>(null)
  const [issues, setIssues] = useState<readonly { path: string; reason: string }[]>([])
  const [openField, setOpenField] = useState<string | null>(null)
  const [openStage, setOpenStage] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(true)
  const [askingReason, setAskingReason] = useState(false)

  const patch = (next: Partial<Draft>) => setDraft((previous) => ({ ...previous, ...next }))

  const patchField = (key: string, next: Partial<FieldDraft>) =>
    setDraft((previous) => ({
      ...previous,
      fields: previous.fields.map((field) => (field.key === key ? { ...field, ...next } : field)),
    }))

  const save = useMutation({
    mutationFn: (reason: string | null) => {
      const config = configOf(draft)
      const maxEntries =
        draft.maxEntries.trim() === '' ? null : Math.max(1, Number(draft.maxEntries))
      if (item === null) {
        return run(
          api.assessment.createItem({
            params: { batchId },
            payload: {
              itemType: 'evidence',
              title: draft.title.trim(),
              scoreGroupId: draft.scoreGroupId,
              maxEntries,
              config: config as never,
            },
          }),
        )
      }
      return run(
        api.assessment.updateItem({
          params: { itemId: item.id },
          payload: {
            title: draft.title.trim(),
            scoreGroupId: draft.scoreGroupId,
            maxEntries,
            config: config as never,
            ...(reason === null ? {} : { reason }),
          },
        }),
      )
    },
    onMutate: () => {
      setProblem(null)
      setIssues([])
    },
    onSuccess: (result: { item: { id: string } }) => {
      toast.success(format(m.itemsSaved))
      setAskingReason(false)
      onSaved(result.item.id)
    },
    onError: (error: unknown) => {
      const config = error as { issues?: readonly { path: string; reason: string }[] }
      if (Array.isArray(config.issues)) setIssues(config.issues)
      setProblem(formatError(error))
      setAskingReason(false)
    },
  })

  // by key, never by index: a step deleted above must not silently turn the
  // step below it into something else
  const patchStage = (key: string, next: Partial<StageDraft>) =>
    setDraft((previous) => ({
      ...previous,
      stages: previous.stages.map((stage) => (stage.key === key ? { ...stage, ...next } : stage)),
    }))

  const moveStage = (key: string, delta: -1 | 1) =>
    setDraft((previous) => {
      const stage = previous.stages.find((candidate) => candidate.key === key)
      if (stage === undefined) return previous
      const siblings = previous.stages.filter((candidate) => candidate.chain === stage.chain)
      const at = siblings.findIndex((candidate) => candidate.key === key)
      const target = at + delta
      if (target < 0 || target >= siblings.length) return previous
      const reordered = [...siblings]
      const [moved] = reordered.splice(at, 1)
      reordered.splice(target, 0, moved!)
      const others = previous.stages.filter((candidate) => candidate.chain !== stage.chain)
      return {
        ...previous,
        stages: stage.chain === 'normal' ? [...reordered, ...others] : [...others, ...reordered],
      }
    })

  const addStage = (chain: 'normal' | 'escalation') => {
    const stage = blankStage(options, chain)
    setDraft((previous) => ({ ...previous, stages: [...previous.stages, stage] }))
    setOpenStage(stage.key)
  }

  const stageReady = (stage: StageDraft) =>
    stage.kind === 'roleAt'
      ? stage.nodeTypeId !== '' && stage.roleIds.length > 0
      : stage.roleId !== ''

  const ready =
    draft.title.trim() !== '' &&
    draft.scoreGroupId !== '' &&
    draft.fixedValue.trim() !== '' &&
    draft.stages.some((stage) => stage.chain === 'normal') &&
    draft.stages.every(stageReady) &&
    draft.fields.every((field) => field.label.trim() !== '')

  // A live question's scoring or placement changing is a change to what a
  // round already promised, and the api refuses it without a sentence saying
  // why. One never published has promised nothing yet.
  const needsReason = item !== null && item.status !== 'draft' && batchStatus === 'active'

  const field = draft.fields.find((one) => one.key === openField) ?? null
  const stage = draft.stages.find((one) => one.key === openStage) ?? null

  return (
    <div className={previewOpen ? 'lg:grid lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-6' : ''}>
      <div className="flex min-w-0 flex-col gap-4">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">
              {item === null ? format(m.itemsNew) : format(m.itemsEditTitle)}
            </p>
            <h3 className="truncate text-lg font-semibold">
              {draft.title.trim() === '' ? format(m.itemsUntitled) : draft.title}
            </h3>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {actions}
            <Button variant="outline" onClick={onCancel}>
              {format(commonMessages.cancel)}
            </Button>
            <Button
              disabled={save.isPending || !ready}
              onClick={() => (needsReason ? setAskingReason(true) : save.mutate(null))}
            >
              {format(m.entrySave)}
            </Button>
          </div>
        </header>

        <Feedback message={problem} />
        {issues.length > 0 && (
          <ul className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
            {issues.map((issue, index) => (
              <li key={index}>
                {issue.path}: {issue.reason}
              </li>
            ))}
          </ul>
        )}

        <Tabs defaultValue="basics">
          <div className="flex items-center justify-between gap-2 border-b">
            <TabsList variant="line" className="justify-start">
              <TabsTrigger value="basics" className="flex-none">
                {format(m.itemsTabBasics)}
              </TabsTrigger>
              <TabsTrigger value="fields" className="flex-none">
                {format(m.itemsTabFields)}
              </TabsTrigger>
              <TabsTrigger value="scoring" className="flex-none">
                {format(m.itemsTabScoring)}
              </TabsTrigger>
              <TabsTrigger value="review" className="flex-none">
                {format(m.itemsTabReview)}
              </TabsTrigger>
            </TabsList>
            <Button
              variant="ghost"
              size="sm"
              className="mb-1 hidden shrink-0 text-xs text-muted-foreground lg:inline-flex"
              aria-expanded={previewOpen}
              onClick={() => setPreviewOpen((open) => !open)}
            >
              {format(previewOpen ? m.itemsPreviewHide : m.itemsPreviewShow)}
            </Button>
          </div>

          <TabsContent value="basics" className="pt-4">
            <div className="flex max-w-2xl flex-col gap-5">
              <Field label={format(m.itemsFieldTitle)}>
                {(id) => (
                  <Input
                    id={id}
                    value={draft.title}
                    placeholder={format(m.itemsTitlePlaceholder)}
                    onChange={(event) => {
                      patch({ title: event.target.value })
                      onTitleChange?.(event.target.value)
                    }}
                  />
                )}
              </Field>
              <Field
                label={format(m.itemsFieldDescription)}
                hint={format(m.itemsFieldDescriptionHint)}
              >
                {(id) => (
                  <Textarea
                    id={id}
                    rows={3}
                    value={draft.description}
                    onChange={(event) => patch({ description: event.target.value })}
                  />
                )}
              </Field>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label={format(m.itemsFieldGroup)}>
                  {(id) => (
                    <NativeSelect
                      id={id}
                      value={draft.scoreGroupId}
                      onChange={(event) => patch({ scoreGroupId: event.target.value })}
                    >
                      {groups.map((group) => (
                        <option key={group.id} value={group.id}>
                          {group.name}
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                </Field>
                <Field label={format(m.itemsFieldEntrySource)}>
                  {(id) => (
                    <NativeSelect
                      id={id}
                      value={draft.entrySource}
                      onChange={(event) =>
                        patch({ entrySource: event.target.value as Draft['entrySource'] })
                      }
                    >
                      <option value="student">{format(m.itemsEntrySourceStudent)}</option>
                      <option value="administrative">
                        {format(m.itemsEntrySourceAdministrative)}
                      </option>
                    </NativeSelect>
                  )}
                </Field>
                <Field label={format(m.itemsFieldMax)}>
                  {(id) => (
                    <Input
                      id={id}
                      type="number"
                      min={1}
                      value={draft.maxEntries}
                      placeholder={format(m.itemsFieldMaxUnlimited)}
                      onChange={(event) => patch({ maxEntries: event.target.value })}
                    />
                  )}
                </Field>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="fields" className="pt-4">
            <FieldList
              fields={draft.fields}
              onReorder={(orderedKeys) =>
                setDraft((previous) => ({
                  ...previous,
                  fields: orderedKeys.flatMap((key) => {
                    const found = previous.fields.find((one) => one.key === key)
                    return found === undefined ? [] : [found]
                  }),
                }))
              }
              onEdit={setOpenField}
              onRemove={(key) =>
                setDraft((previous) => ({
                  ...previous,
                  fields: previous.fields.filter((one) => one.key !== key),
                }))
              }
              onAdd={() => {
                const key = nextKey(draft.fields)
                patch({ fields: [...draft.fields, blankField(key)] })
                setOpenField(key)
              }}
            />
          </TabsContent>

          <TabsContent value="scoring" className="pt-4">
            <div className="max-w-xs">
              <Field label={format(m.itemsFixedValue)} hint={format(m.itemsFixedValueHint)}>
                {(id) => (
                  <Input
                    id={id}
                    value={draft.fixedValue}
                    onChange={(event) => patch({ fixedValue: event.target.value })}
                  />
                )}
              </Field>
            </div>
          </TabsContent>

          <TabsContent value="review" className="pt-4">
            <div className="flex flex-col gap-8">
              {(['normal', 'escalation'] as const).map((chain) => {
                const steps = draft.stages.filter((one) => one.chain === chain)
                return (
                  <section key={chain} className="flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <h4 className="text-sm font-medium">
                          {format(chain === 'normal' ? m.itemsReviewTitle : m.itemsDoubtTitle)}
                        </h4>
                        {chain === 'escalation' && (
                          <p className="pt-0.5 text-xs text-muted-foreground">
                            {format(m.itemsDoubtHint)}
                          </p>
                        )}
                      </div>
                      <Button variant="outline" size="sm" onClick={() => addStage(chain)}>
                        <PlusIcon aria-hidden className="size-3.5" />
                        {format(m.itemsStageAdd)}
                      </Button>
                    </div>
                    {steps.length === 0 && chain === 'escalation' ? (
                      <p className="text-sm text-muted-foreground">{format(m.itemsDoubtEmpty)}</p>
                    ) : (
                      // a long chain runs off the side rather than wrapping into
                      // something that no longer reads as one path
                      <div className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-2">
                        {chain === 'normal' && (
                          <>
                            <FlowNode
                              title={format(m.itemsFlowSubmit)}
                              sub={format(m.itemsFlowSubmitBy)}
                            />
                            <FlowArrow />
                          </>
                        )}
                        {steps.map((one, index) => (
                          <div key={one.key} className="flex shrink-0 items-center gap-2">
                            {index > 0 && <FlowArrow />}
                            <StageCard
                              index={index}
                              last={index === steps.length - 1}
                              chain={chain}
                              stage={one}
                              options={options}
                              removable={chain === 'escalation' || steps.length > 1}
                              onOpen={() => setOpenStage(one.key)}
                              onMove={(delta) => moveStage(one.key, delta)}
                              onRemove={() =>
                                setDraft((previous) => ({
                                  ...previous,
                                  stages: previous.stages.filter((s) => s.key !== one.key),
                                }))
                              }
                            />
                          </div>
                        ))}
                        {chain === 'normal' && (
                          <>
                            <FlowArrow />
                            <FlowNode
                              title={format(m.itemsFlowDone)}
                              sub={format(m.itemsFlowDoneSub)}
                              tone="done"
                            />
                          </>
                        )}
                      </div>
                    )}
                  </section>
                )
              })}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {previewOpen && (
        <aside className="mt-6 border-t pt-6 lg:mt-0 lg:border-t-0 lg:pt-0">
          <ParticipantPreview draft={draft} options={options} />
        </aside>
      )}

      {field !== null && (
        <FieldSheet
          field={field}
          materialRange={materialRange}
          onChange={(next) => patchField(field.key, next)}
          onClose={() => setOpenField(null)}
        />
      )}

      {stage !== null && (
        <StageSheet
          batchId={batchId}
          stage={stage}
          options={options}
          onChange={(next) => patchStage(stage.key, next)}
          onClose={() => setOpenStage(null)}
        />
      )}

      {askingReason && (
        <ReasonDialog
          title={format(m.itemsReasonTitle)}
          description={format(m.itemsReasonHint)}
          busy={save.isPending}
          onConfirm={(reason) => save.mutate(reason)}
          onClose={() => setAskingReason(false)}
        />
      )}
    </div>
  )
}

/** one step of the chain, as the path reads it; its settings are a panel away */
function StageCard({
  index,
  last,
  chain,
  stage,
  options,
  removable,
  onOpen,
  onMove,
  onRemove,
}: {
  index: number
  last: boolean
  chain: 'normal' | 'escalation'
  stage: StageDraft
  options: ItemOptions
  removable: boolean
  onOpen: () => void
  onMove: (delta: -1 | 1) => void
  onRemove: () => void
}) {
  const { format } = useI18n()
  const levelName = options.orgTypes.find((one) => one.id === stage.nodeTypeId)?.name ?? ''
  const roleNames =
    stage.kind === 'roleAt'
      ? options.roles
          .filter((role) => stage.roleIds.includes(role.id))
          .map((role) => role.name)
          .join('、')
      : (options.roles.find((role) => role.id === stage.roleId)?.name ?? '')

  return (
    <div className="w-52 shrink-0 rounded-lg border bg-card p-3">
      <div className="flex items-center gap-1.5">
        <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-foreground text-[10px] font-medium text-background">
          {index + 1}
        </span>
        <span className="text-sm font-medium">{format(m.itemsStageNumber, { n: index + 1 })}</span>
        {chain === 'normal' && last && (
          <span className="text-xs text-primary">{format(m.itemsTerminalHere)}</span>
        )}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 pt-2 text-sm">
        {stage.kind === 'roleAt' ? (
          <>
            <dt className="text-muted-foreground">{format(m.itemsStageLevelShort)}</dt>
            <dd className="truncate">{levelName}</dd>
          </>
        ) : (
          <>
            <dt className="text-muted-foreground">{format(m.itemsStageKindShort)}</dt>
            <dd className="truncate">{format(m.itemsStageWalkUp)}</dd>
          </>
        )}
        <dt className="text-muted-foreground">{format(m.itemsStageRolesShort)}</dt>
        <dd className="truncate">{roleNames === '' ? '—' : roleNames}</dd>
      </dl>
      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          className="text-xs text-primary underline-offset-2 hover:underline"
          onClick={onOpen}
        >
          {format(m.itemsStageExpand)}
        </button>
        <span className="flex items-center">
          <Button
            variant="ghost"
            size="sm"
            className="size-6 p-0"
            disabled={index === 0}
            onClick={() => onMove(-1)}
            aria-label={format(m.itemsFieldUp)}
          >
            <ChevronLeftIcon aria-hidden className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="size-6 p-0"
            disabled={last}
            onClick={() => onMove(1)}
            aria-label={format(m.itemsFieldDown)}
          >
            <ChevronRightIcon aria-hidden className="size-3.5" />
          </Button>
          {removable && (
            <Button
              variant="ghost"
              size="sm"
              className="size-6 p-0"
              onClick={onRemove}
              aria-label={format(m.itemsStageRemove)}
            >
              <XIcon aria-hidden className="size-3.5" />
            </Button>
          )}
        </span>
      </div>
    </div>
  )
}

/** an endpoint of the path: where a submission enters, where it leaves */
function FlowNode({ title, sub, tone }: { title: string; sub: string; tone?: 'done' }) {
  return (
    <div className="flex shrink-0 flex-col px-1 text-center">
      <p className={cn('text-sm font-medium', tone === 'done' && 'text-primary')}>{title}</p>
      <p className="text-xs text-muted-foreground">{sub}</p>
    </div>
  )
}

function FlowArrow() {
  return <ArrowRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground/50" />
}

/**
 * The filing screen this draft produces, drawn from the draft alone: the
 * participant's card with its fields, and the path a submission takes. It
 * answers "what will they see" without saving anything.
 */
function ParticipantPreview({ draft, options }: { draft: Draft; options: ItemOptions }) {
  const { format } = useI18n()
  const normal = draft.stages.filter((stage) => stage.chain === 'normal')
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">{format(m.itemsPreviewTitle)}</p>
        <p className="text-xs text-muted-foreground">{format(m.itemsPreviewLive)}</p>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border bg-background p-4 shadow-sm">
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold">
            {draft.title.trim() === '' ? format(m.itemsUntitled) : draft.title}
          </h4>
          <div className="flex flex-wrap gap-1.5">
            <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {draft.maxEntries.trim() === ''
                ? format(m.itemsPreviewNoMax)
                : format(m.itemsPreviewMax, { count: Number(draft.maxEntries) })}
            </span>
            <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {format(m.itemsPreviewValue, { value: trimAmount(draft.fixedValue.trim()) })}
            </span>
          </div>
          {draft.description.trim() !== '' && (
            <p className="text-xs text-muted-foreground">{draft.description}</p>
          )}
        </div>
        <div className="flex flex-col gap-2.5 border-t pt-3">
          {draft.fields.map((field) => (
            <div key={field.key} className="flex flex-col gap-1">
              <p className="text-xs text-muted-foreground">
                {field.label.trim() === '' ? '—' : field.label}
                {field.required && <span className="pl-0.5 text-destructive">*</span>}
              </p>
              {field.type === 'attachment' ? (
                <div className="flex h-9 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
                  {format(m.itemsPreviewUpload, { count: Number(field.maxCount) || 1 })}
                </div>
              ) : (
                <div className="h-8 rounded-md border bg-muted/20" />
              )}
            </div>
          ))}
        </div>
      </div>

      {normal.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border p-3">
          <p className="text-xs font-medium">{format(m.itemsPreviewChain)}</p>
          {normal.map((stage, index) => {
            const levelName =
              options.orgTypes.find((one) => one.id === stage.nodeTypeId)?.name ?? ''
            const roleNames =
              stage.kind === 'roleAt'
                ? options.roles
                    .filter((role) => stage.roleIds.includes(role.id))
                    .map((role) => role.name)
                    .join('，')
                : (options.roles.find((role) => role.id === stage.roleId)?.name ?? '')
            return (
              <p key={stage.key} className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium">
                  {index + 1}
                </span>
                {stage.kind === 'roleAt'
                  ? `${levelName}\u3000${roleNames}`
                  : `${format(m.itemsStageWalkUp)}\u3000${roleNames}`}
              </p>
            )
          })}
        </div>
      )}
    </div>
  )
}
