import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { ArrowRightIcon, ChevronLeftIcon, ChevronRightIcon, PlusIcon, XIcon } from 'lucide-react'
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
import { lastDay, type ItemDto } from '../entry/model.ts'

// One question, composed rather than typed: the fields participants will
// fill, what each approved entry counts, and who reviews at which level.
// The editor builds the same configuration object the api validates, so the
// server stays the judge and this stays a pen.
//
// The review chain is drawn as what it is - a path from submission to a
// finished review - with one step open for editing at a time and the rest
// folded to what they resolve to.

export interface ItemOptions {
  readonly orgTypes: readonly { id: string; code: string; name: string }[]
  readonly roles: readonly { id: string; name: string }[]
}

interface FieldDraft {
  key: string
  type: 'text' | 'date' | 'attachment'
  label: string
  required: boolean
  maxLength: string
  min: string
  max: string
  maxCount: string
  maxSizeMb: string
  accept: string
}

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

/** one step of the chain as the pen holds it */
interface StageDraft {
  /** stable while the editor is open, so identity never rides on an index */
  key: string
  kind: 'roleAt' | 'nearestRole'
  nodeTypeId: string
  roleIds: string[]
  roleId: string
  /** which list this step belongs to; the stored form is one list plus a terminal */
  chain: 'normal' | 'escalation'
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
  reason: string
}

let minted = 0
const blankStage = (options: ItemOptions, chain: 'normal' | 'escalation'): StageDraft => ({
  key: `s${(minted += 1)}`,
  kind: 'roleAt',
  nodeTypeId: options.orgTypes[0]?.id ?? '',
  roleIds: [],
  roleId: options.roles[0]?.id ?? '',
  chain,
})

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
    scoreGroupId: item?.scoreGroupId ?? groups[0]?.id ?? '',
    maxEntries: item === null ? '1' : item.maxEntries === null ? '' : String(item.maxEntries),
    entrySource: config?.entrySource ?? 'student',
    description: String((config?.displayConfig as { description?: unknown })?.description ?? ''),
    fields: fields.length > 0 ? fields : [blankField('f1')],
    fixedValue: scoring?.calculator?.config?.value ?? '1.00',
    stages: stages.length > 0 ? stages : [blankStage(options, 'normal')],
    reason: '',
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
  materialRange,
  item,
  groups,
  defaultGroupId,
  options,
  actions,
  onSaved,
}: {
  batchId: string
  /** the round's own window; a date field can only narrow it, never widen it */
  materialRange: { start: string; end: string }
  item: ItemDto | null
  groups: readonly { id: string; name: string }[]
  /** the group a new question was opened inside */
  defaultGroupId?: string | undefined
  options: ItemOptions
  /** what can be done to the question as a whole, drawn beside its title */
  actions?: React.ReactNode
  onSaved: () => void
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
  const [expandedStage, setExpandedStage] = useState<string | null>(
    item === null ? (draft.stages[0]?.key ?? null) : null,
  )

  const patch = (next: Partial<Draft>) => setDraft((previous) => ({ ...previous, ...next }))
  const patchField = (index: number, next: Partial<FieldDraft>) =>
    setDraft((previous) => ({
      ...previous,
      fields: previous.fields.map((field, at) => (at === index ? { ...field, ...next } : field)),
    }))
  const moveField = (index: number, delta: -1 | 1) =>
    setDraft((previous) => {
      const fields = [...previous.fields]
      const target = index + delta
      if (target < 0 || target >= fields.length) return previous
      const [moved] = fields.splice(index, 1)
      fields.splice(target, 0, moved!)
      return { ...previous, fields }
    })

  const save = useMutation({
    mutationFn: () => {
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
            ...(draft.reason.trim() === '' ? {} : { reason: draft.reason.trim() }),
          },
        }),
      )
    },
    onMutate: () => {
      setProblem(null)
      setIssues([])
    },
    onSuccess: () => {
      toast.success(format(m.itemsSaved))
      onSaved()
    },
    onError: (error: unknown) => {
      const config = error as { issues?: readonly { path: string; reason: string }[] }
      if (Array.isArray(config.issues)) setIssues(config.issues)
      setProblem(formatError(error))
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
    setExpandedStage(stage.key)
  }

  const removeStage = (key: string) =>
    setDraft((previous) => ({
      ...previous,
      stages: previous.stages.filter((stage) => stage.key !== key),
    }))

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

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{format(m.itemsEditTitle)}</p>
          <h3 className="truncate text-lg font-semibold">
            {draft.title.trim() === '' ? format(m.itemsNew) : draft.title}
          </h3>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {actions}
          <Button disabled={save.isPending || !ready} onClick={() => save.mutate()}>
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
        <TabsList variant="line" className="w-full justify-start border-b">
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

        <TabsContent value="basics" className="pt-3">
          <div className="flex max-w-2xl flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={format(m.itemsFieldTitle)}>
                {(id) => (
                  <Input
                    id={id}
                    value={draft.title}
                    onChange={(event) => patch({ title: event.target.value })}
                  />
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
            </div>
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
            {item !== null && (
              <Field label={format(m.itemsFieldReason)}>
                {(id) => (
                  <Input
                    id={id}
                    value={draft.reason}
                    onChange={(event) => patch({ reason: event.target.value })}
                  />
                )}
              </Field>
            )}
          </div>
        </TabsContent>

        <TabsContent value="fields" className="pt-3">
          <div className="flex max-w-2xl flex-col gap-3">
            {draft.fields.length === 0 && (
              <p className="text-sm text-muted-foreground">{format(m.itemsFormEmpty)}</p>
            )}
            {draft.fields.map((field, index) => (
              <div key={field.key} className="flex flex-col gap-3 rounded-lg border p-3">
                <div className="grid grid-cols-2 gap-3">
                  <Field label={format(m.itemsFieldLabel)}>
                    {(id) => (
                      <Input
                        id={id}
                        value={field.label}
                        onChange={(event) => patchField(index, { label: event.target.value })}
                      />
                    )}
                  </Field>
                  <Field label={format(m.itemsFieldType)}>
                    {(id) => (
                      <NativeSelect
                        id={id}
                        value={field.type}
                        onChange={(event) =>
                          patchField(index, { type: event.target.value as FieldDraft['type'] })
                        }
                      >
                        <option value="text">{format(m.itemsTypeText)}</option>
                        <option value="date">{format(m.itemsTypeDate)}</option>
                        <option value="attachment">{format(m.itemsTypeAttachment)}</option>
                      </NativeSelect>
                    )}
                  </Field>
                </div>
                {field.type === 'text' && (
                  <Field label={format(m.itemsFieldMaxLength)}>
                    {(id) => (
                      <Input
                        id={id}
                        type="number"
                        min={1}
                        value={field.maxLength}
                        onChange={(event) => patchField(index, { maxLength: event.target.value })}
                      />
                    )}
                  </Field>
                )}
                {field.type === 'date' && (
                  <div className="flex flex-col gap-1">
                    <div className="grid grid-cols-2 gap-3">
                      <Field label={format(m.itemsFieldMinDate)}>
                        {(id) => (
                          <Input
                            id={id}
                            type="date"
                            value={field.min}
                            min={materialRange.start}
                            max={lastDay(materialRange.end)}
                            onChange={(event) => patchField(index, { min: event.target.value })}
                          />
                        )}
                      </Field>
                      <Field label={format(m.itemsFieldMaxDate)}>
                        {(id) => (
                          <Input
                            id={id}
                            type="date"
                            value={field.max}
                            min={materialRange.start}
                            max={lastDay(materialRange.end)}
                            onChange={(event) => patchField(index, { max: event.target.value })}
                          />
                        )}
                      </Field>
                    </div>
                    {/* the round decides the outer window; a bound outside it
                        changes nothing, and silence about that is how a date
                        the form seemed to accept came back refused */}
                    <p className="text-xs text-muted-foreground">
                      {format(m.itemsDateWindow, {
                        from: materialRange.start,
                        until: lastDay(materialRange.end),
                      })}
                    </p>
                  </div>
                )}
                {field.type === 'attachment' && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label={format(m.itemsFieldMaxCount)}>
                        {(id) => (
                          <Input
                            id={id}
                            type="number"
                            min={1}
                            value={field.maxCount}
                            onChange={(event) =>
                              patchField(index, { maxCount: event.target.value })
                            }
                          />
                        )}
                      </Field>
                      <Field label={format(m.itemsFieldMaxSize)}>
                        {(id) => (
                          <Input
                            id={id}
                            type="number"
                            min={1}
                            value={field.maxSizeMb}
                            onChange={(event) =>
                              patchField(index, { maxSizeMb: event.target.value })
                            }
                          />
                        )}
                      </Field>
                    </div>
                    <Field label={format(m.itemsFieldAccept)} hint={format(m.itemsFieldAcceptHint)}>
                      {(id) => (
                        <Input
                          id={id}
                          value={field.accept}
                          placeholder=".pdf, image/*"
                          onChange={(event) => patchField(index, { accept: event.target.value })}
                        />
                      )}
                    </Field>
                  </>
                )}
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={field.required}
                      onCheckedChange={(next) => patchField(index, { required: next === true })}
                    />
                    {format(m.itemsFieldRequired)}
                  </label>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={index === 0}
                      onClick={() => moveField(index, -1)}
                    >
                      {format(m.itemsFieldUp)}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={index === draft.fields.length - 1}
                      onClick={() => moveField(index, 1)}
                    >
                      {format(m.itemsFieldDown)}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setDraft((previous) => ({
                          ...previous,
                          fields: previous.fields.filter((_, at) => at !== index),
                        }))
                      }
                    >
                      {format(m.itemsFieldRemove)}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setDraft((previous) => ({
                    ...previous,
                    fields: [...previous.fields, blankField(nextKey(previous.fields))],
                  }))
                }
              >
                <PlusIcon aria-hidden className="size-3.5" />
                {format(m.itemsFieldAdd)}
              </Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="scoring" className="pt-3">
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

        <TabsContent value="review" className="pt-3">
          <div className="flex flex-col gap-8">
            {(['normal', 'escalation'] as const).map((chain) => {
              const steps = draft.stages.filter((stage) => stage.chain === chain)
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
                    <div className="flex flex-wrap items-center gap-2">
                      {chain === 'normal' && (
                        <>
                          <FlowNode
                            title={format(m.itemsFlowSubmit)}
                            sub={format(m.itemsFlowSubmitBy)}
                          />
                          <FlowArrow />
                        </>
                      )}
                      {steps.map((stage, index) => (
                        <div key={stage.key} className="flex items-center gap-2">
                          {index > 0 && <FlowArrow />}
                          <StageCard
                            batchId={batchId}
                            index={index}
                            last={index === steps.length - 1}
                            chain={chain}
                            stage={stage}
                            options={options}
                            removable={chain === 'escalation' || steps.length > 1}
                            expanded={expandedStage === stage.key}
                            onToggle={() =>
                              setExpandedStage((open) => (open === stage.key ? null : stage.key))
                            }
                            onChange={(next) => patchStage(stage.key, next)}
                            onMove={(delta) => moveStage(stage.key, delta)}
                            onRemove={() => removeStage(stage.key)}
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
 * One step of the chain: folded, what it resolves to; open, the fields that
 * compose it, plus the one thing an author cannot know by looking - whether
 * anybody actually holds these roles at these units in this round. Asked
 * live, of the same definition the queue asks.
 */
function StageCard({
  batchId,
  index,
  last,
  chain,
  stage,
  options,
  removable,
  expanded,
  onToggle,
  onChange,
  onMove,
  onRemove,
}: {
  batchId: string
  index: number
  last: boolean
  chain: 'normal' | 'escalation'
  stage: StageDraft
  options: ItemOptions
  removable: boolean
  expanded: boolean
  onToggle: () => void
  onChange: (next: Partial<StageDraft>) => void
  onMove: (delta: -1 | 1) => void
  onRemove: () => void
}) {
  const query = useApiQuery(assessmentApi)
  const { format } = useI18n()
  const roleIds = stage.kind === 'roleAt' ? stage.roleIds : [stage.roleId]
  const coverage = useQuery({
    ...query.assessment.reviewCoverage.queryOptions({
      params: { batchId },
      query: { nodeTypeId: stage.nodeTypeId, roleIds },
    }),
    // only the level-anchored kind surveys units; the nearest-holder kind is
    // answered per participant, where its answer actually lives
    enabled: stage.kind === 'roleAt' && stage.nodeTypeId !== '' && roleIds.length > 0,
  })
  const uncovered = (coverage.data?.nodes ?? []).filter((node) => node.reviewers === 0)
  const levelName = options.orgTypes.find((one) => one.id === stage.nodeTypeId)?.name ?? ''
  const roleNames =
    stage.kind === 'roleAt'
      ? options.roles
          .filter((role) => stage.roleIds.includes(role.id))
          .map((role) => role.name)
          .join('、')
      : (options.roles.find((role) => role.id === stage.roleId)?.name ?? '')

  const header = (
    <div className="flex items-center gap-1.5">
      <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-foreground text-[10px] font-medium text-background">
        {index + 1}
      </span>
      <span className="text-sm font-medium">{format(m.itemsStageNumber, { n: index + 1 })}</span>
      {chain === 'normal' && last && (
        <span className="text-xs text-primary">{format(m.itemsTerminalHere)}</span>
      )}
    </div>
  )

  if (!expanded) {
    return (
      <div className="w-52 rounded-lg border bg-card p-3">
        <div className="flex items-center justify-between gap-1">{header}</div>
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
        <button
          type="button"
          className="pt-2 text-xs text-primary underline-offset-2 hover:underline"
          onClick={onToggle}
        >
          {format(m.itemsStageExpand)}
        </button>
      </div>
    )
  }

  return (
    <div className="w-64 rounded-lg border border-foreground/40 bg-card p-3 shadow-sm">
      <div className="flex items-center justify-between gap-1">
        {header}
        <div className="flex items-center">
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
        </div>
      </div>

      <div className="flex flex-col gap-3 pt-3">
        <Field label={format(m.itemsStageKind)}>
          {(id) => (
            <NativeSelect
              id={id}
              value={stage.kind}
              onChange={(event) => onChange({ kind: event.target.value as StageDraft['kind'] })}
            >
              <option value="roleAt">{format(m.itemsStageRoleAt)}</option>
              <option value="nearestRole">{format(m.itemsStageNearestRole)}</option>
            </NativeSelect>
          )}
        </Field>

        {stage.kind === 'roleAt' ? (
          <>
            <Field label={format(m.itemsReviewLevel)}>
              {(id) => (
                <NativeSelect
                  id={id}
                  value={stage.nodeTypeId}
                  onChange={(event) => onChange({ nodeTypeId: event.target.value })}
                >
                  {options.orgTypes.map((orgType) => (
                    <option key={orgType.id} value={orgType.id}>
                      {orgType.name}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <Field label={format(m.itemsReviewRoles)} hint={format(m.itemsReviewRolesHint)}>
              {() => (
                <div className="flex flex-col gap-1.5">
                  {options.roles.map((role) => (
                    <label key={role.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={stage.roleIds.includes(role.id)}
                        onCheckedChange={(next) =>
                          onChange({
                            roleIds:
                              next === true
                                ? [...stage.roleIds, role.id]
                                : stage.roleIds.filter((id) => id !== role.id),
                          })
                        }
                      />
                      {role.name}
                    </label>
                  ))}
                </div>
              )}
            </Field>
            {coverage.data !== undefined && (
              <p
                className={
                  uncovered.length > 0
                    ? 'text-xs text-destructive'
                    : 'text-xs text-muted-foreground'
                }
              >
                {coverage.data.nodes.length === 0
                  ? format(m.itemsReviewNoUnits)
                  : uncovered.length === 0
                    ? format(m.itemsReviewCovered, { count: coverage.data.nodes.length })
                    : format(m.itemsReviewUncovered, {
                        names: uncovered.map((node) => node.name).join('、'),
                      })}
              </p>
            )}
          </>
        ) : (
          <Field label={format(m.itemsStageRole)} hint={format(m.itemsStageNearestHint)}>
            {(id) => (
              <NativeSelect
                id={id}
                value={stage.roleId}
                onChange={(event) => onChange({ roleId: event.target.value })}
              >
                {options.roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        )}
      </div>
    </div>
  )
}
