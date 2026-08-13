import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Feedback, Field, SidePanel } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Checkbox } from '@qualy/ui/checkbox'
import { Input } from '@qualy/ui/input'
import { NativeSelect } from '@qualy/ui/native-select'
import { toast } from '@qualy/ui/toast'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { lastDay, type ItemDto } from '../entry/model.ts'

// One question, composed rather than typed: the fields participants will
// fill, what each approved entry counts, and who reviews at which level.
// The dialog builds the same configuration object the api validates, so the
// server stays the judge and this stays a pen.

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
  kind: 'roleAt' | 'nearestRole'
  nodeTypeId: string
  roleIds: string[]
  roleId: string
}

interface Draft {
  title: string
  scoreGroupId: string
  maxEntries: string
  entrySource: 'student' | 'administrative'
  fields: FieldDraft[]
  fixedValue: string
  stages: StageDraft[]
  /** the step the ordinary flow ends at; the ones after it are the doubt chain */
  normalTerminal: number
  reason: string
}

const blankStage = (options: ItemOptions): StageDraft => ({
  kind: 'roleAt',
  nodeTypeId: options.orgTypes[0]?.id ?? '',
  roleIds: [],
  roleId: options.roles[0]?.id ?? '',
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
  const stages = (policy?.stages ?? []).map((stage): StageDraft => {
    const selector = stage.selector ?? {}
    return selector.kind === 'nearestRole'
      ? {
          kind: 'nearestRole',
          nodeTypeId: options.orgTypes[0]?.id ?? '',
          roleIds: [],
          roleId: selector.roleId ?? options.roles[0]?.id ?? '',
        }
      : {
          kind: 'roleAt',
          nodeTypeId: selector.nodeTypeId ?? options.orgTypes[0]?.id ?? '',
          roleIds: selector.roleIds ?? [],
          roleId: options.roles[0]?.id ?? '',
        }
  })
  return {
    title: item?.title ?? '',
    scoreGroupId: item?.scoreGroupId ?? groups[0]?.id ?? '',
    maxEntries: String(item?.maxEntries ?? 1),
    entrySource: config?.entrySource ?? 'student',
    fields: fields.length > 0 ? fields : [blankField('f1')],
    fixedValue: scoring?.calculator?.config?.value ?? '1.00',
    stages: stages.length > 0 ? stages : [blankStage(options)],
    normalTerminal: Math.min(policy?.normalTerminal ?? 0, Math.max(0, stages.length - 1)),
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
  reviewPolicy: {
    stages: draft.stages.map((stage) => ({
      selector:
        stage.kind === 'roleAt'
          ? { kind: 'roleAt', nodeTypeId: stage.nodeTypeId, roleIds: stage.roleIds }
          : { kind: 'nearestRole', roleId: stage.roleId },
      quorum: { type: 'any' },
    })),
    normalTerminal: draft.normalTerminal,
  },
})

export function ItemConfigEditor({
  batchId,
  materialRange,
  item,
  groups,
  options,
  onClose,
  onSaved,
}: {
  batchId: string
  /** the round's own window; a date field can only narrow it, never widen it */
  materialRange: { start: string; end: string }
  item: ItemDto | null
  groups: readonly { id: string; name: string }[]
  options: ItemOptions
  onClose: () => void
  onSaved: () => void
}) {
  const api = useApi(assessmentApi)
  const query = useApiQuery(assessmentApi)
  const run = useRunApi()
  const { format, formatError } = useI18n()
  const [draft, setDraft] = useState<Draft>(() => draftOf(item, groups, options))
  const [problem, setProblem] = useState<string | null>(null)
  const [issues, setIssues] = useState<readonly { path: string; reason: string }[]>([])

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
      if (item === null) {
        return run(
          api.assessment.createItem({
            params: { batchId },
            payload: {
              itemType: 'evidence',
              title: draft.title.trim(),
              scoreGroupId: draft.scoreGroupId,
              maxEntries: Number(draft.maxEntries) > 0 ? Number(draft.maxEntries) : 1,
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
            maxEntries: Number(draft.maxEntries) > 0 ? Number(draft.maxEntries) : 1,
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

  const patchStage = (index: number, next: Partial<StageDraft>) =>
    setDraft((previous) => ({
      ...previous,
      stages: previous.stages.map((stage, at) => (at === index ? { ...stage, ...next } : stage)),
    }))

  const stageReady = (stage: StageDraft) =>
    stage.kind === 'roleAt'
      ? stage.nodeTypeId !== '' && stage.roleIds.length > 0
      : stage.roleId !== ''

  const ready =
    draft.title.trim() !== '' &&
    draft.scoreGroupId !== '' &&
    draft.fixedValue.trim() !== '' &&
    draft.stages.length > 0 &&
    draft.stages.every(stageReady) &&
    draft.fields.every((field) => field.label.trim() !== '')

  return (
    <SidePanel
      open
      title={item === null ? format(m.itemsNew) : format(m.itemsEditTitle)}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {format(commonMessages.cancel)}
          </Button>
          <Button disabled={save.isPending || !ready} onClick={() => save.mutate()}>
            {format(m.entrySave)}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <Field label={format(m.itemsFieldTitle)}>
          {(id) => (
            <Input
              id={id}
              value={draft.title}
              onChange={(event) => patch({ title: event.target.value })}
            />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
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
          <Field label={format(m.itemsFieldMax)}>
            {(id) => (
              <Input
                id={id}
                type="number"
                min={1}
                value={draft.maxEntries}
                onChange={(event) => patch({ maxEntries: event.target.value })}
              />
            )}
          </Field>
        </div>
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
              <option value="administrative">{format(m.itemsEntrySourceAdministrative)}</option>
            </NativeSelect>
          )}
        </Field>

        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">{format(m.itemsFormTitle)}</h4>
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
              {format(m.itemsFieldAdd)}
            </Button>
          </div>
          {draft.fields.length === 0 && (
            <p className="text-sm text-muted-foreground">{format(m.itemsFormEmpty)}</p>
          )}
          {draft.fields.map((field, index) => (
            <div key={index} className="flex flex-col gap-3 rounded-lg border p-3">
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
                          onChange={(event) => patchField(index, { maxCount: event.target.value })}
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
                          onChange={(event) => patchField(index, { maxSizeMb: event.target.value })}
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
        </section>

        <section className="flex flex-col gap-3">
          <h4 className="text-sm font-medium">{format(m.itemsScoringTitle)}</h4>
          <Field label={format(m.itemsFixedValue)} hint={format(m.itemsFixedValueHint)}>
            {(id) => (
              <Input
                id={id}
                value={draft.fixedValue}
                onChange={(event) => patch({ fixedValue: event.target.value })}
              />
            )}
          </Field>
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">{format(m.itemsReviewTitle)}</h4>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setDraft((previous) => ({
                  ...previous,
                  stages: [...previous.stages, blankStage(options)],
                }))
              }
            >
              {format(m.itemsStageAdd)}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{format(m.itemsChainHint)}</p>
          {draft.stages.map((stage, index) => (
            <StageEditor
              key={index}
              batchId={batchId}
              index={index}
              stage={stage}
              options={options}
              terminal={draft.normalTerminal}
              removable={draft.stages.length > 1}
              onChange={(next) => patchStage(index, next)}
              onTerminal={() => patch({ normalTerminal: index })}
              onRemove={() =>
                setDraft((previous) => ({
                  ...previous,
                  stages: previous.stages.filter((_, at) => at !== index),
                  normalTerminal: Math.min(previous.normalTerminal, previous.stages.length - 2),
                }))
              }
            />
          ))}
        </section>

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
      </div>
    </SidePanel>
  )
}

/**
 * One step of the chain, with the one thing an author cannot know by
 * looking: whether anybody actually holds these roles at these units in
 * this round. Asked live, of the same definition the queue asks.
 */
function StageEditor({
  batchId,
  index,
  stage,
  options,
  terminal,
  removable,
  onChange,
  onTerminal,
  onRemove,
}: {
  batchId: string
  index: number
  stage: StageDraft
  options: ItemOptions
  terminal: number
  removable: boolean
  onChange: (next: Partial<StageDraft>) => void
  onTerminal: () => void
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
    // only the level-anchored kind has units to count; the nearest-holder
    // kind finds a person wherever they are, so there is nothing to survey
    enabled: stage.kind === 'roleAt' && stage.nodeTypeId !== '' && roleIds.length > 0,
  })
  const uncovered = (coverage.data?.nodes ?? []).filter((node) => node.reviewers === 0)

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">
          {format(m.itemsStageNumber, { n: index + 1 })}
          {index === terminal && (
            <span className="pl-2 text-xs font-normal text-muted-foreground">
              {format(m.itemsTerminalHere)}
            </span>
          )}
          {index > terminal && (
            <span className="pl-2 text-xs font-normal text-muted-foreground">
              {format(m.itemsStageDoubt)}
            </span>
          )}
        </p>
        <div className="flex gap-1">
          {index !== terminal && (
            <Button variant="ghost" size="sm" onClick={onTerminal}>
              {format(m.itemsTerminalMark)}
            </Button>
          )}
          {removable && (
            <Button variant="ghost" size="sm" onClick={onRemove}>
              {format(m.itemsStageRemove)}
            </Button>
          )}
        </div>
      </div>

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
                uncovered.length > 0 ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'
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
  )
}
