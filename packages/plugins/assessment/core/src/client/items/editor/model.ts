import {
  DECIMAL_MAXIMUM,
  DECIMAL_MINIMUM,
  MAX_SCALE,
  assignmentPlan,
  choiceLabel,
  displayDescription,
  displayTitle,
  inputOrder,
  kindOf,
  normalizeAtomicSchema,
  type AtomicKind,
  type AtomicSchema,
  type ChoiceSchema,
  type NormalizedInputSchema,
} from '@qualy/value-schema'
import { materializeField, type FieldDraft as ValueDraft } from '@qualy/web-value-form/model'
import { SUMMARY_FIELDS_MOST, summaryFieldIdsOf } from '../../../entry/summary.ts'
import type { ItemDto } from '../../entry/model.ts'
import type { StageDraft } from '../StageSheet.tsx'
import type { ItemOptions } from '../options.ts'

// One question as the editor holds it, and the two readings between that and
// what the api stores.
//
// The editor speaks three concepts and nothing else: how a record comes to
// be (the mode and the doors), what the arithmetic needs (parameters, each
// a fixed value or a determination), and what the form asks (fields, some
// of them the filing side of a determination). Everything the api stores -
// item types, review policies, recognitions, bindings, default field ids -
// is written from those three and read back into them, so a person composing
// a question never meets a stored concept they did not choose.
//
// The model is plain data and pure functions: nothing here renders, fetches
// or runs an effect, which is what lets the same reading be tested without a
// screen and reused by every panel of the editor.

/** how a question's records come to be */
export type Mode = 'review' | 'direct' | 'automatic'

export type FieldType = 'text' | 'date' | 'integer' | 'decimal' | 'choice' | 'boolean' | 'attachment'

/** one option of a choice field; a person edits the label and nothing else */
export interface OptionDraft {
  id: string
  value: string
  label: string
  enabled: boolean
}

/**
 * One field as the editor holds it: every setting of every kind, flat, so
 * that changing a field's kind keeps what the kinds share and a consumer
 * never has to narrow a union to read a label.
 */
export interface FieldDraft {
  id: string
  key: string
  type: FieldType
  label: string
  description: string
  required: boolean
  minLength: string
  maxLength: string
  pattern: string
  min: string
  max: string
  maxScale: string
  options: OptionDraft[]
  maxCount: string
  maxSizeMb: string
  accept: string
}

/**
 * One determination the arithmetic will read.
 *
 * `id` is the server's identity once it has one and null while the fact is
 * still being composed - a new one is addressed by its handle until a save
 * mints it. `refinement` narrows what may be determined; null means exactly
 * what the parameter admits. `fieldId` names the form field whose filing is
 * the determination's starting point, when there is one.
 */
export interface RecognitionDraft {
  id: string | null
  label: string
  description: string
  refinement: AtomicSchema | null
  fieldId: string | null
}

/** what feeds one calculator parameter */
export type BindingDraft =
  | { kind: 'constant'; value: unknown; draft?: ValueDraft }
  | { kind: 'recognition'; handle: string }

/** the stored versioned language, carried whole */
export interface StoredScoringV2 {
  version: 2
  calculator: { ref: string; config: unknown }
  aggregator: { ref: string; config: unknown }
  recognitions: Record<
    string,
    { label: string; refinement: unknown; defaultFromFieldId: string | null }
  >
  bindings: Record<string, unknown>
}

export type ScoringDraft =
  /** the legacy language: a fixed amount, and nothing else */
  | { language: 'v1' }
  | {
      language: 'v2'
      /** what the server stored, byte for byte; null once this pen wrote it */
      original: StoredScoringV2 | null
      calculator: { ref: string; config: unknown }
      recognitions: Record<string, RecognitionDraft>
      bindings: Record<string, BindingDraft>
      touched: boolean
      /** whether the chosen calculator's own editor has produced a configuration yet */
      configured: boolean
    }
  /** a language written by a newer build: carried, never authored */
  | { language: 'unsupported'; original: unknown; version: unknown }

export interface Draft {
  title: string
  scoreGroupId: string
  description: string
  maxEntries: string
  folding: 'sum' | 'max' | 'top-n'
  topN: string
  mode: Mode
  /** the two doors; both may stand open */
  participant: boolean
  administrative: boolean
  fields: FieldDraft[]
  summaryFieldIds: string[]
  fixedValue: string
  scoring: ScoringDraft
  stages: StageDraft[]
}

/** the calculator's contract as the server compiled it, once it has */
export interface Contract {
  readonly inputSchema: NormalizedInputSchema
  readonly outputSchema: AtomicSchema
  readonly form: {
    readonly valid: boolean
    readonly issues: readonly { readonly path: string; readonly reason: string }[]
  }
  readonly bindableFields: readonly {
    readonly fieldId: string
    readonly payloadKey: string
    readonly schema: unknown
    readonly always: boolean
  }[]
}

// ---- identities ---------------------------------------------------------

/**
 * A field's permanent name. The key is where the answer sits in a payload
 * and the id is what says it is still the same field next revision; they
 * are minted equal and never change. Not a counter: `f1` is a name the next
 * question would mint as well.
 */
export const nextKey = (): string => `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** an option's permanent name, and - until a formula lends it one - its value */
export const nextOptionKey = (): string =>
  `o${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** a step's permanent name, saved with the policy */
export const nextStageId = (): string =>
  `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** a handle for a determination nobody has saved yet */
export const handleFor = (parameter: string) => `draft:${parameter}`

export const blankField = (type: FieldType, key: string): FieldDraft => ({
  id: key,
  key,
  type,
  label: '',
  description: '',
  required: false,
  minLength: '',
  maxLength: '',
  pattern: '',
  min: '',
  max: '',
  maxScale: type === 'decimal' ? '2' : '',
  options: [],
  maxCount: '1',
  maxSizeMb: '',
  accept: '',
})

export const blankStage = (options: ItemOptions, chain: 'normal' | 'escalation'): StageDraft => ({
  key: nextStageId(),
  label: '',
  kind: 'roleAt',
  nodeTypeId: options.orgTypes[0]?.id ?? '',
  roleIds: [],
  roleId: options.roles[0]?.id ?? '',
  participation: 'any',
  chain,
})

const own = <T>(record: Readonly<Record<string, T>> | undefined, key: string): T | undefined =>
  record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined

const said = (value: unknown): string => (value === undefined || value === null ? '' : String(value))

// ---- reading what is stored --------------------------------------------

export const modeOf = (item: ItemDto | null): Mode => {
  if (item === null) return 'review'
  if (item.itemType === 'constant') return 'automatic'
  const policy = item.currentRevision?.reviewPolicy as { mode?: unknown } | null | undefined
  return policy?.mode === 'none' ? 'direct' : 'review'
}

const fieldOf = (raw: Record<string, unknown>): FieldDraft => {
  const type = (raw['type'] as FieldType | undefined) ?? 'text'
  const base = blankField(type, String(raw['key'] ?? ''))
  return {
    ...base,
    // a form saved before identities existed is not rewritten to gain
    // them: its key is its identity, which is what it always was
    id: String(raw['id'] ?? raw['key'] ?? ''),
    label: said(raw['label']),
    description: said(raw['description']),
    required: raw['required'] === true,
    minLength: said(raw['minLength']),
    maxLength: said(raw['maxLength']),
    pattern: said(raw['pattern']),
    min: said(raw['min']),
    max: said(raw['max']),
    maxScale: type === 'decimal' ? (raw['maxScale'] === undefined ? '2' : said(raw['maxScale'])) : '',
    options: Array.isArray(raw['options'])
      ? (raw['options'] as Record<string, unknown>[]).map((option) => ({
          id: said(option['id'] ?? option['value']),
          value: said(option['value']),
          label: said(option['label']),
          enabled: option['enabled'] !== false,
        }))
      : [],
    maxCount: raw['maxCount'] === undefined ? '1' : said(raw['maxCount']),
    // exactly, not rounded: a megabyte is a power of two, so the division
    // and the multiplication that undoes it are both exact
    maxSizeMb:
      raw['maxFileBytes'] === undefined ? '' : String(Number(raw['maxFileBytes']) / (1024 * 1024)),
    accept: Array.isArray(raw['accept']) ? (raw['accept'] as string[]).join(', ') : '',
  }
}

/**
 * A choice narrowing as the value layer will read it: labels only for the
 * values it still admits. A label left behind for a value that was taken
 * out is not a narrowing the profile accepts, and a stored one must not
 * read back as "exceeds the formula".
 */
const tidyChoice = (schema: AtomicSchema | null): AtomicSchema | null => {
  if (schema === null || !('enum' in schema)) return schema
  const held = schema as ChoiceSchema & { 'x-qualy-enumLabels'?: Record<string, string> }
  const labels = held['x-qualy-enumLabels']
  if (labels === undefined) return schema
  const kept = Object.fromEntries(
    Object.entries(labels).filter(([value]) => held.enum.includes(value)),
  )
  return { ...held, 'x-qualy-enumLabels': kept } as AtomicSchema
}

const scoringDraftOf = (stored: unknown): ScoringDraft => {
  if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) {
    return { language: 'v1' }
  }
  if (!Object.hasOwn(stored, 'version')) return { language: 'v1' }
  const version = (stored as { version?: unknown }).version
  if (version !== 2) return { language: 'unsupported', original: stored, version }
  const original = stored as unknown as StoredScoringV2
  return {
    language: 'v2',
    original,
    calculator: original.calculator,
    configured: true,
    // the stored form is keyed by identity; the draft form by handle, and
    // an existing fact's handle is that identity
    recognitions: Object.fromEntries(
      Object.entries(original.recognitions ?? {}).map(([id, one]) => {
        const refinement = tidyChoice((one.refinement ?? null) as AtomicSchema | null)
        return [
          id,
          {
            id,
            label: one.label,
            // the words under a determination ride on its narrowing's
            // annotation layer, where the arithmetic never reads them
            description: said(refinement?.description),
            refinement,
            fieldId: one.defaultFromFieldId,
          },
        ]
      }),
    ),
    bindings: Object.fromEntries(
      Object.entries(original.bindings ?? {}).map(([parameter, binding]) => {
        const held = binding as { kind?: unknown; value?: unknown; recognitionId?: unknown }
        return [
          parameter,
          held.kind === 'recognition'
            ? { kind: 'recognition' as const, handle: String(held.recognitionId) }
            : { kind: 'constant' as const, value: held.value },
        ]
      }),
    ),
    touched: false,
  }
}

interface StoredStage {
  id?: string
  label?: string
  selector?: { kind?: string; nodeTypeId?: string; roleIds?: string[]; roleId?: string }
  quorum?: { type?: string }
}

/**
 * The stored policy back into the pen, whichever version wrote it: a policy
 * written as one list with `normalTerminal` in it is read as the split it
 * always described, and its steps keep the names they are known by.
 */
export const stagesOf = (stored: unknown, options: ItemOptions): StageDraft[] => {
  const held = stored as
    | {
        normal?: { stages?: StoredStage[] }
        escalation?: { stages?: StoredStage[] }
        doubt?: { stages?: StoredStage[] }
        stages?: StoredStage[]
        normalTerminal?: number
      }
    | undefined
  const other = held?.escalation ?? held?.doubt
  const draftOne = (stage: StoredStage, chain: 'normal' | 'escalation', id: string): StageDraft =>
    stage.selector?.kind === 'nearestRole'
      ? {
          key: id,
          label: stage.label ?? '',
          kind: 'nearestRole',
          nodeTypeId: options.orgTypes[0]?.id ?? '',
          roleIds: [],
          roleId: stage.selector.roleId ?? options.roles[0]?.id ?? '',
          participation: stage.quorum?.type === 'all' ? 'all' : 'any',
          chain,
        }
      : {
          key: id,
          label: stage.label ?? '',
          kind: 'roleAt',
          nodeTypeId: stage.selector?.nodeTypeId ?? options.orgTypes[0]?.id ?? '',
          roleIds: stage.selector?.roleIds ?? [],
          roleId: options.roles[0]?.id ?? '',
          participation: stage.quorum?.type === 'all' ? 'all' : 'any',
          chain,
        }
  if (Array.isArray(held?.normal?.stages) || Array.isArray(other?.stages)) {
    return [
      ...(held?.normal?.stages ?? []).map((stage, index) =>
        draftOne(stage, 'normal', stage.id ?? `legacy-${index}`),
      ),
      ...(other?.stages ?? []).map((stage, index) =>
        draftOne(stage, 'escalation', stage.id ?? `legacy-${index}`),
      ),
    ]
  }
  const terminal = held?.normalTerminal ?? 0
  return (held?.stages ?? []).map((stage, index) =>
    draftOne(stage, index > terminal ? 'escalation' : 'normal', stage.id ?? `legacy-${index}`),
  )
}

/** the stored question back into the pen; nothing is invented for a new one */
export const draftOf = (
  item: ItemDto | null,
  groups: readonly { id: string }[],
  options: ItemOptions,
): Draft => {
  const revision = item?.currentRevision ?? null
  const config = revision as {
    entryChannels?: readonly string[]
    formConfig?: unknown
    scoringConfig?: unknown
    reviewPolicy?: unknown
    displayConfig?: unknown
  } | null
  const rawFields = (config?.formConfig as { fields?: unknown } | null | undefined)?.fields
  const fields = Array.isArray(rawFields)
    ? (rawFields as Record<string, unknown>[]).map(fieldOf)
    : []
  const scoring = config?.scoringConfig as
    | {
        calculator?: { config?: { value?: string } }
        aggregator?: { ref?: string; config?: { n?: number } }
      }
    | undefined
  const aggregatorRef = scoring?.aggregator?.ref ?? 'sum@1'
  const channels = config?.entryChannels ?? []
  const mode = modeOf(item)
  return {
    title: item?.title ?? '',
    scoreGroupId:
      item !== null && item.scoreGroupId !== '' ? item.scoreGroupId : (groups[0]?.id ?? ''),
    description: said((config?.displayConfig as { description?: unknown })?.description),
    maxEntries: item === null ? '1' : item.maxEntries === null ? '' : String(item.maxEntries),
    folding: aggregatorRef === 'max@1' ? 'max' : aggregatorRef === 'top-n-sum@1' ? 'top-n' : 'sum',
    topN: String(scoring?.aggregator?.config?.n ?? 2),
    mode,
    // a new question opens with participants filing; a stored one says
    // which doors it has, and an automatic one has none to say
    participant: item === null ? true : channels.includes('participant'),
    administrative: item === null ? false : channels.includes('administrative'),
    fields,
    summaryFieldIds: summaryFieldIdsOf(config?.displayConfig).filter((id) =>
      fields.some((field) => field.id === id),
    ),
    // the stored spelling, verbatim: rendering an amount for reading would
    // rewrite "2.00" as "2" on the next save, a change nobody made
    fixedValue: scoring?.calculator?.config?.value ?? '1',
    scoring: scoringDraftOf(config?.scoringConfig),
    stages: stagesOf(config?.reviewPolicy, options),
  }
}

// ---- schemas of fields and determinations -------------------------------

/**
 * One field's type as a value schema, mirroring the driver's own reading so
 * the editor can prove a binding before the server does.
 */
export const fieldSchemaOf = (field: FieldDraft): AtomicSchema | null => {
  const words = {
    title: field.label,
    ...(field.description.trim() === '' ? {} : { description: field.description.trim() }),
  }
  switch (field.type) {
    case 'text': {
      const shortest = Math.max(Number(field.minLength) || 0, field.required ? 1 : 0)
      return {
        type: 'string',
        ...(shortest > 0 ? { minLength: shortest } : {}),
        ...(field.maxLength.trim() === '' ? {} : { maxLength: Number(field.maxLength) }),
        ...(field.pattern.trim() === '' ? {} : { pattern: field.pattern.trim() }),
        ...words,
      }
    }
    case 'integer':
      return {
        type: 'integer',
        minimum: field.min.trim() === '' ? Number.MIN_SAFE_INTEGER : Number(field.min),
        maximum: field.max.trim() === '' ? Number.MAX_SAFE_INTEGER : Number(field.max),
        ...words,
      }
    case 'decimal':
      return {
        type: 'string',
        format: 'qualy-decimal',
        [MAX_SCALE]: Number(field.maxScale) >= 0 ? Number(field.maxScale) : 2,
        ...(field.min.trim() === '' ? {} : { [DECIMAL_MINIMUM]: field.min.trim() }),
        ...(field.max.trim() === '' ? {} : { [DECIMAL_MAXIMUM]: field.max.trim() }),
        ...words,
      }
    case 'choice': {
      const offered = field.options.filter((option) => option.enabled)
      return {
        type: 'string',
        enum: offered.map((option) => option.value),
        'x-qualy-enumLabels': Object.fromEntries(offered.map((one) => [one.value, one.label])),
        ...words,
      }
    }
    case 'boolean':
      return { type: 'boolean', ...words }
    case 'date':
      return { type: 'string', format: 'date', ...words }
    case 'attachment':
      return null
  }
}

/** the field kind a schema kind is filed as */
export const fieldTypeOf = (kind: AtomicKind): FieldType => kind

/** the bounds the arithmetic itself admits for one parameter */
export const parameterSchemaOf = (
  contract: Contract | null,
  parameter: string,
): AtomicSchema | undefined =>
  contract === null ? undefined : own(contract.inputSchema.properties, parameter)

/** what a determination admits: its narrowing, else exactly its parameter */
export const admittedSchemaOf = (
  recognition: RecognitionDraft | undefined,
  parameter: AtomicSchema,
): AtomicSchema => recognition?.refinement ?? parameter

/**
 * A field shaped to carry a determination: the type and bounds of what is
 * admitted, and for a choice, options wearing the arithmetic's own values.
 * Option identities are kept where the field already had them - a value
 * lent by the arithmetic does not make an option a different option.
 */
export const fieldFromSchema = (
  schema: AtomicSchema,
  base: FieldDraft,
  locale: string,
  optionIdFor: (value: string) => string | undefined = () => undefined,
): FieldDraft => {
  const kind = kindOf(schema)
  const next: FieldDraft = { ...blankField(fieldTypeOf(kind), base.key), ...base, type: fieldTypeOf(kind) }
  const bounds = schema as {
    minimum?: unknown
    maximum?: unknown
    minLength?: unknown
    maxLength?: unknown
    pattern?: unknown
    [MAX_SCALE]?: unknown
    [DECIMAL_MINIMUM]?: unknown
    [DECIMAL_MAXIMUM]?: unknown
  }
  switch (kind) {
    case 'text':
      return {
        ...next,
        minLength: said(bounds.minLength),
        maxLength: said(bounds.maxLength),
        pattern: said(bounds.pattern),
      }
    case 'integer':
      return { ...next, min: said(bounds.minimum), max: said(bounds.maximum) }
    case 'decimal':
      return {
        ...next,
        maxScale: said(bounds[MAX_SCALE]) === '' ? '2' : said(bounds[MAX_SCALE]),
        min: said(bounds[DECIMAL_MINIMUM]),
        max: said(bounds[DECIMAL_MAXIMUM]),
      }
    case 'choice': {
      const choice = schema as ChoiceSchema
      return {
        ...next,
        options: choice.enum.map((value) => ({
          id: optionIdFor(value) ?? nextOptionKey(),
          value,
          label: choiceLabel(choice, value, locale),
          enabled: true,
        })),
      }
    }
    case 'boolean':
    case 'date':
      return next
  }
}

/**
 * The narrowing a determination carries, said as a schema: what the
 * parameter admits with the bounds a person set on top. Null when nothing
 * was narrowed and nothing was said, which is "exactly the parameter".
 */
export const refinementOf = (
  parameter: AtomicSchema,
  narrowing: {
    readonly min?: string
    readonly max?: string
    readonly minLength?: string
    readonly maxLength?: string
    readonly options?: readonly { value: string; label: string; enabled: boolean }[]
  },
  description: string,
): AtomicSchema | null => {
  const kind = kindOf(parameter)
  const words = description.trim() === '' ? {} : { description: description.trim() }
  const body = ((): AtomicSchema | null => {
    switch (kind) {
      case 'integer': {
        const source = parameter as { minimum: number; maximum: number }
        const min = narrowing.min?.trim() === '' || narrowing.min === undefined ? source.minimum : Number(narrowing.min)
        const max = narrowing.max?.trim() === '' || narrowing.max === undefined ? source.maximum : Number(narrowing.max)
        if (min === source.minimum && max === source.maximum) return null
        return { type: 'integer', minimum: min, maximum: max }
      }
      case 'decimal': {
        const source = parameter as {
          [MAX_SCALE]: number
          [DECIMAL_MINIMUM]?: string
          [DECIMAL_MAXIMUM]?: string
        }
        const min = narrowing.min?.trim() === '' || narrowing.min === undefined ? source[DECIMAL_MINIMUM] : narrowing.min.trim()
        const max = narrowing.max?.trim() === '' || narrowing.max === undefined ? source[DECIMAL_MAXIMUM] : narrowing.max.trim()
        if (min === source[DECIMAL_MINIMUM] && max === source[DECIMAL_MAXIMUM]) return null
        return {
          type: 'string',
          format: 'qualy-decimal',
          [MAX_SCALE]: source[MAX_SCALE],
          ...(min === undefined ? {} : { [DECIMAL_MINIMUM]: min }),
          ...(max === undefined ? {} : { [DECIMAL_MAXIMUM]: max }),
        }
      }
      case 'text': {
        const source = parameter as { minLength?: number; maxLength?: number; pattern?: string }
        const min = narrowing.minLength?.trim() === '' || narrowing.minLength === undefined ? source.minLength : Number(narrowing.minLength)
        const max = narrowing.maxLength?.trim() === '' || narrowing.maxLength === undefined ? source.maxLength : Number(narrowing.maxLength)
        if (min === source.minLength && max === source.maxLength) return null
        return {
          type: 'string',
          ...(min === undefined ? {} : { minLength: min }),
          ...(max === undefined ? {} : { maxLength: max }),
          ...(source.pattern === undefined ? {} : { pattern: source.pattern }),
        }
      }
      case 'choice': {
        const source = parameter as ChoiceSchema
        const options = narrowing.options ?? []
        const kept = options.filter((one) => one.enabled)
        const labelsMoved = options.some((one) => one.label !== choiceLabel(source, one.value, ''))
        if (kept.length === source.enum.length && !labelsMoved) return null
        return {
          type: 'string',
          enum: kept.map((one) => one.value),
          'x-qualy-enumLabels': Object.fromEntries(kept.map((one) => [one.value, one.label])),
        }
      }
      case 'boolean':
      case 'date':
        return null
    }
  })()
  if (body === null) return description.trim() === '' ? null : { ...parameter, ...words }
  return { ...body, ...words }
}

/**
 * The words under a determination, carried on its narrowing's annotation
 * layer: a narrowing keeps them beside its bounds, and a determination that
 * narrows nothing carries them on a copy of the parameter itself.
 */
export const describedRefinement = (
  parameter: AtomicSchema,
  refinement: AtomicSchema | null,
  description: string,
): AtomicSchema | null => {
  const words = description.trim()
  if (refinement === null) return words === '' ? null : { ...parameter, description: words }
  const { description: _dropped, ...body } = refinement as AtomicSchema & { description?: string }
  void _dropped
  const bare = body as AtomicSchema
  if (words === '' && JSON.stringify(bare) === JSON.stringify(parameter)) return null
  return words === '' ? bare : { ...bare, description: words }
}

// ---- writing what is stored ---------------------------------------------

/** the doors a question opens, as the api spells them */
export const channelsOf = (draft: Draft): readonly ('participant' | 'administrative')[] =>
  draft.mode === 'automatic'
    ? []
    : [
        ...(draft.participant ? (['participant'] as const) : []),
        ...(draft.administrative ? (['administrative'] as const) : []),
      ]

/** the kind of question the api is asked to keep, from what the editor says */
export const itemTypeOf = (draft: Draft, item: ItemDto | null): string => {
  if (draft.mode === 'automatic') return 'constant'
  // a question that asks nothing was once its own kind; one that still asks
  // nothing keeps it, so an old question is not retyped by being opened
  if (item?.itemType === 'declaration' && draft.fields.length === 0) return 'declaration'
  return 'evidence'
}

const storedStage = (stage: StageDraft, panelable: boolean) => ({
  id: stage.key,
  ...(stage.label.trim() !== '' ? { label: stage.label.trim() } : {}),
  selector:
    stage.kind === 'roleAt'
      ? { kind: 'roleAt', nodeTypeId: stage.nodeTypeId, roleIds: stage.roleIds }
      : { kind: 'nearestRole', roleId: stage.roleId },
  // a panel only where the server allows one: an escalation middle step
  quorum: { type: panelable && stage.participation === 'all' ? 'all' : 'any' },
})

export const reviewPolicyOf = (draft: Draft) => {
  if (draft.mode !== 'review') return { mode: 'none' }
  const escalation = draft.stages.filter((one) => one.chain === 'escalation')
  return {
    normal: {
      stages: draft.stages
        .filter((one) => one.chain === 'normal')
        .map((one) => storedStage(one, false)),
    },
    escalation: {
      stages: escalation.map((one, index) => storedStage(one, index < escalation.length - 1)),
    },
  }
}

export type Folding = { rule: 'sum' } | { rule: 'max' } | { rule: 'top-n'; n: number }

export const foldingOf = (draft: Draft): Folding =>
  draft.folding === 'max'
    ? { rule: 'max' }
    : draft.folding === 'top-n'
      ? { rule: 'top-n', n: Math.max(1, Number(draft.topN) || 1) }
      : { rule: 'sum' }

const aggregatorOf = (draft: Draft) => {
  const folding = foldingOf(draft)
  return folding.rule === 'max'
    ? { ref: 'max@1', config: {} }
    : folding.rule === 'top-n'
      ? { ref: 'top-n-sum@1', config: { n: folding.n } }
      : { ref: 'sum@1', config: {} }
}

const OWN_AGGREGATORS = new Set(['sum@1', 'max@1', 'top-n-sum@1'])

/** the versioned scoring the pen would submit, as the draft language */
const draftScoringOf = (
  scoring: Extract<ScoringDraft, { language: 'v2' }>,
  aggregator: { ref: string; config: unknown },
  contract: Contract | null,
) => ({
  version: 2,
  calculator: scoring.calculator,
  aggregator,
  recognitions: Object.entries(scoring.recognitions).map(([handle, one]) => ({
    handle,
    ...(one.id === null ? {} : { id: one.id }),
    label: one.label,
    refinement: (one.refinement ?? null) as unknown,
    defaultFromFieldId: one.fieldId,
  })),
  bindings: Object.fromEntries(
    Object.entries(scoring.bindings).map(([parameter, binding]) => {
      if (binding.kind === 'recognition') {
        return [parameter, { kind: 'recognition' as const, handle: binding.handle }]
      }
      if (binding.draft === undefined) {
        return [parameter, { kind: 'constant' as const, value: binding.value }]
      }
      const schema = parameterSchemaOf(contract, parameter)
      const outcome = schema === undefined ? undefined : materializeField(schema, binding.draft)
      return [
        parameter,
        { kind: 'constant' as const, value: outcome?.kind === 'value' ? outcome.value : binding.draft },
      ]
    }),
  ),
})

export const scoringOf = (draft: Draft, contract: Contract | null) => {
  const aggregator = draft.mode === 'automatic' ? { ref: 'sum@1', config: {} } : aggregatorOf(draft)
  if (draft.scoring.language === 'unsupported') return draft.scoring.original
  if (draft.scoring.language === 'v2') {
    const { original, calculator, touched } = draft.scoring
    const folding =
      original === null || OWN_AGGREGATORS.has(original.aggregator.ref)
        ? aggregator
        : original.aggregator
    // nothing about the arithmetic was touched: the stored form goes back
    // exactly as it came, which the server treats as the no-op it is
    if (!touched && original !== null) return { ...original, aggregator: folding }
    return draftScoringOf({ ...draft.scoring, calculator }, folding, contract)
  }
  return {
    calculator: { ref: 'fixed@1', config: { value: draft.fixedValue.trim() } },
    aggregator,
  }
}

/** the recognitions of a versioned draft, keyed by handle, in the arithmetic's order */
export const recognitionRows = (
  draft: Draft,
  contract: Contract | null,
): readonly { parameter: string; handle: string; recognition: RecognitionDraft }[] => {
  if (draft.scoring.language !== 'v2' || contract === null) return []
  const { bindings, recognitions } = draft.scoring
  return inputOrder(contract.inputSchema).flatMap((parameter) => {
    const binding = own(bindings, parameter)
    if (binding === undefined || binding.kind !== 'recognition') return []
    const recognition = own(recognitions, binding.handle)
    return recognition === undefined ? [] : [{ parameter, handle: binding.handle, recognition }]
  })
}

/** which determination a field is the filing side of, if any */
export const linkOf = (
  draft: Draft,
  contract: Contract | null,
  fieldId: string,
): { parameter: string; handle: string; recognition: RecognitionDraft } | undefined =>
  recognitionRows(draft, contract).find((row) => row.recognition.fieldId === fieldId)

/**
 * One field as the api stores it. A field that is the filing side of a
 * determination carries the determination's own type and bounds, whatever
 * it held: the two are one fact, and the determination is where it is set.
 */
const fieldToWire = (field: FieldDraft, draft: Draft, contract: Contract | null, locale: string) => {
  const link = linkOf(draft, contract, field.id)
  const parameter = link === undefined ? undefined : parameterSchemaOf(contract, link.parameter)
  const shaped =
    link === undefined || parameter === undefined
      ? field
      : fieldFromSchema(
          admittedSchemaOf(link.recognition, parameter),
          field,
          locale,
          (value) => field.options.find((one) => one.value === value)?.id,
        )
  // the filing side of a determination wears the determination's words,
  // and under direct handling it is what the arithmetic reads, so it is
  // required whatever the box says
  const linked = link !== undefined && parameter !== undefined
  const label = linked ? link.recognition.label : shaped.label
  const description = linked ? link.recognition.description : shaped.description
  const required = shaped.required || (linked && draft.mode === 'direct')
  const base = {
    id: shaped.id.trim() === '' ? shaped.key.trim() : shaped.id.trim(),
    key: shaped.key.trim(),
    type: shaped.type,
    label: label.trim(),
    ...(description.trim() === '' ? {} : { description: description.trim() }),
    ...(required ? { required: true } : {}),
  }
  switch (shaped.type) {
    case 'text':
      return {
        ...base,
        ...(shaped.minLength.trim() !== '' ? { minLength: Number(shaped.minLength) } : {}),
        ...(shaped.maxLength.trim() !== '' ? { maxLength: Number(shaped.maxLength) } : {}),
        ...(shaped.pattern.trim() !== '' ? { pattern: shaped.pattern.trim() } : {}),
      }
    case 'date':
      return {
        ...base,
        ...(shaped.min.trim() !== '' ? { min: shaped.min.trim() } : {}),
        ...(shaped.max.trim() !== '' ? { max: shaped.max.trim() } : {}),
      }
    case 'integer':
      return {
        ...base,
        ...(shaped.min.trim() !== '' ? { min: Number(shaped.min) } : {}),
        ...(shaped.max.trim() !== '' ? { max: Number(shaped.max) } : {}),
      }
    case 'decimal':
      return {
        ...base,
        maxScale: Number(shaped.maxScale) >= 0 ? Number(shaped.maxScale) : 2,
        ...(shaped.min.trim() !== '' ? { min: shaped.min.trim() } : {}),
        ...(shaped.max.trim() !== '' ? { max: shaped.max.trim() } : {}),
      }
    case 'choice':
      return {
        ...base,
        options: shaped.options
          .filter((option) => option.value.trim() !== '' || option.label.trim() !== '')
          .map((option) => ({
            id: option.id,
            value: option.value.trim(),
            label: option.label.trim(),
            ...(option.enabled ? {} : { enabled: false }),
          })),
      }
    case 'boolean':
      return base
    case 'attachment':
      return {
        ...base,
        maxCount: Number(shaped.maxCount) > 0 ? Number(shaped.maxCount) : 1,
        ...(shaped.maxSizeMb.trim() !== ''
          ? { maxFileBytes: Number(shaped.maxSizeMb) * 1024 * 1024 }
          : {}),
        ...(shaped.accept.trim() !== ''
          ? {
              accept: shaped.accept
                .split(',')
                .map((kind) => kind.trim())
                .filter((kind) => kind !== ''),
            }
          : {}),
      }
  }
}

export const formConfigOf = (
  draft: Draft,
  item: ItemDto | null,
  contract: Contract | null,
  locale: string,
) =>
  itemTypeOf(draft, item) === 'evidence'
    ? { fields: draft.fields.map((field) => fieldToWire(field, draft, contract, locale)) }
    : {}

const displayConfigOf = (draft: Draft) => {
  const description = draft.description.trim()
  const elected =
    draft.mode === 'automatic'
      ? []
      : draft.summaryFieldIds.filter((id) =>
          draft.fields.some(
            (field) => field.id === id && field.type !== 'attachment' && field.type !== 'boolean',
          ),
        )
  return description === '' && elected.length === 0
    ? {}
    : {
        displayConfig: {
          ...(description !== '' ? { description } : {}),
          ...(elected.length > 0 ? { entrySummary: { fieldIds: elected } } : {}),
        },
      }
}

/** the pen back into the configuration the api validates */
export const configOf = (
  draft: Draft,
  item: ItemDto | null,
  contract: Contract | null,
  locale: string,
) => ({
  entryChannels: channelsOf(draft),
  formConfig: formConfigOf(draft, item, contract, locale),
  scoringConfig: scoringOf(draft, contract),
  ...displayConfigOf(draft),
  reviewPolicy: reviewPolicyOf(draft),
})

/** the count of records one person may hold, as the api takes it */
export const maxEntriesOf = (draft: Draft): number | null =>
  draft.mode === 'automatic'
    ? 1
    : draft.maxEntries.trim() === ''
      ? null
      : Math.max(1, Number(draft.maxEntries))

/**
 * A composition reduced to what a save would actually send, so two readings
 * of the same question compare equal however the pen re-minted its handles.
 */
export const stated = (
  draft: Draft,
  item: ItemDto | null,
  contract: Contract | null,
  locale: string,
): string =>
  JSON.stringify({
    title: draft.title.trim(),
    itemType: itemTypeOf(draft, item),
    scoreGroupId: draft.scoreGroupId,
    maxEntries: maxEntriesOf(draft),
    config: configOf(draft, item, contract, locale),
  })

/** whether a field as typed can be added or kept */
export const fieldComplete = (field: FieldDraft): boolean =>
  field.label.trim() !== '' &&
  (field.type !== 'choice' ||
    (field.options.some((one) => one.enabled) &&
      field.options.every((one) => !one.enabled || one.label.trim() !== '')))

// ---- what stands between the question and a save -------------------------

export type EditorArea = 'basics' | 'scoring' | 'rules'

export type EditorEntity =
  | { kind: 'parameter'; parameter: string }
  | { kind: 'recognition'; handle: string }
  | { kind: 'field'; key: string }
  | { kind: 'stage'; key: string }

/**
 * One thing standing between the question and a save, said where it is:
 * the tab, the row, and the reason. The same list drives the tab marks,
 * the words on the row, the list under the heading and where a press of
 * save lands.
 */
export interface EditorProblem {
  readonly area: EditorArea
  readonly code: string
  readonly entity?: EditorEntity
  /** a name for the row, when the problem is about one */
  readonly subject?: string
}

const stageReady = (stage: StageDraft, options: ItemOptions) =>
  stage.label.trim() !== '' &&
  (stage.kind === 'roleAt'
    ? stage.nodeTypeId !== '' && options.roles.some((role) => stage.roleIds.includes(role.id))
    : options.roles.some((role) => role.id === stage.roleId))

/** whether a narrowing still fits inside what the parameter admits */
export const narrowingFits = (refinement: AtomicSchema | null, parameter: AtomicSchema): boolean => {
  if (refinement === null) return true
  try {
    return assignmentPlan(normalizeAtomicSchema(refinement), normalizeAtomicSchema(parameter)).kind === 'direct'
  } catch {
    return false
  }
}

/** a bound typed in a box: blank, or a number that fits the parameter */
export const boundProblem = (
  kind: AtomicKind,
  side: 'min' | 'max',
  typed: string,
  parameter: AtomicSchema,
): 'unreadable' | 'widens' | 'inverted' | null => {
  const text = typed.trim()
  if (text === '') return null
  if (kind === 'integer') {
    if (!/^-?\d+$/.test(text) || !Number.isSafeInteger(Number(text))) return 'unreadable'
    const source = parameter as { minimum: number; maximum: number }
    const value = Number(text)
    if (side === 'min' ? value < source.minimum : value > source.maximum) return 'widens'
    return null
  }
  if (kind === 'decimal') {
    if (!/^-?\d+(\.\d+)?$/.test(text)) return 'unreadable'
    const source = parameter as { [DECIMAL_MINIMUM]?: string; [DECIMAL_MAXIMUM]?: string }
    const value = Number(text)
    const low = source[DECIMAL_MINIMUM]
    const high = source[DECIMAL_MAXIMUM]
    if (side === 'min' && low !== undefined && value < Number(low)) return 'widens'
    if (side === 'max' && high !== undefined && value > Number(high)) return 'widens'
    return null
  }
  if (kind === 'text') {
    if (!/^\d+$/.test(text)) return 'unreadable'
    const source = parameter as { minLength?: number; maxLength?: number }
    const value = Number(text)
    if (side === 'min' && value < (source.minLength ?? 0)) return 'widens'
    if (side === 'max' && source.maxLength !== undefined && value > source.maxLength) return 'widens'
    return null
  }
  return null
}

export const problemsOf = (input: {
  readonly draft: Draft
  readonly options: ItemOptions
  readonly contract: Contract | null
  /** the contract could not be read at all: a refusal or an outage */
  readonly contractRefused: boolean
  readonly locale: string
}): readonly EditorProblem[] => {
  const { draft, options, contract } = input
  const found: EditorProblem[] = []
  if (draft.title.trim() === '') found.push({ area: 'basics', code: 'title-required' })
  if (draft.scoreGroupId === '') found.push({ area: 'basics', code: 'group-required' })
  if (draft.mode !== 'automatic' && !draft.participant && !draft.administrative) {
    found.push({ area: 'basics', code: 'channels-required' })
  }

  const fieldName = (field: FieldDraft) => field.label.trim()
  for (const field of draft.fields) {
    if (draft.mode === 'automatic') break
    if (field.label.trim() === '') {
      found.push({ area: 'scoring', code: 'field-unnamed', entity: { kind: 'field', key: field.key } })
      continue
    }
    if (field.type === 'choice' && !field.options.some((option) => option.enabled && option.label.trim() !== '')) {
      found.push({
        area: 'scoring',
        code: 'field-options',
        entity: { kind: 'field', key: field.key },
        subject: fieldName(field),
      })
    }
    const schema = fieldSchemaOf(field)
    if (schema !== null) {
      try {
        normalizeAtomicSchema(schema)
      } catch {
        found.push({
          area: 'scoring',
          code: 'field-invalid',
          entity: { kind: 'field', key: field.key },
          subject: fieldName(field),
        })
      }
    }
  }
  // the server's own reading of the form, where it differs from the pen's:
  // a date window the round cannot hold, say
  if (contract !== null) {
    for (const issue of contract.form.issues) {
      const at = /^formConfig\.fields\[(\d+)\]$/.exec(issue.path)
      const field = at === null ? undefined : draft.fields[Number(at[1])]
      if (field === undefined || issue.reason === 'field-unnamed') continue
      if (found.some((one) => one.entity?.kind === 'field' && one.entity.key === field.key)) continue
      found.push({
        area: 'scoring',
        code: issue.reason === 'date-window-empty' ? 'field-date-window' : 'field-invalid',
        entity: { kind: 'field', key: field.key },
        subject: fieldName(field),
      })
    }
  }

  if (draft.scoring.language === 'v1') {
    if (draft.fixedValue.trim() === '' || !/^-?\d+(\.\d+)?$/.test(draft.fixedValue.trim())) {
      found.push({ area: 'scoring', code: 'fixed-value-required' })
    }
  } else if (draft.scoring.language === 'v2') {
    if (!draft.scoring.configured) {
      found.push({ area: 'scoring', code: 'calculator-unset' })
    } else if (contract === null) {
      found.push({ area: 'scoring', code: input.contractRefused ? 'contract-refused' : 'contract-pending' })
    } else {
      for (const parameter of inputOrder(contract.inputSchema)) {
        const schema = parameterSchemaOf(contract, parameter)!
        const title = displayTitle(schema, parameter, input.locale)
        const binding = own(draft.scoring.bindings, parameter)
        if (binding === undefined) {
          found.push({ area: 'scoring', code: 'parameter-unset', entity: { kind: 'parameter', parameter }, subject: title })
          continue
        }
        if (binding.kind === 'constant') {
          const outcome = binding.draft === undefined ? undefined : materializeField(schema, binding.draft)
          const stored = binding.draft === undefined && binding.value !== undefined
          if (!stored && (outcome === undefined || outcome.kind !== 'value')) {
            found.push({ area: 'scoring', code: 'constant-required', entity: { kind: 'parameter', parameter }, subject: title })
          }
          continue
        }
        const recognition = own(draft.scoring.recognitions, binding.handle)
        if (recognition === undefined) {
          found.push({ area: 'scoring', code: 'parameter-unset', entity: { kind: 'parameter', parameter }, subject: title })
          continue
        }
        if (draft.mode === 'automatic') {
          found.push({ area: 'scoring', code: 'recognition-in-automatic', entity: { kind: 'parameter', parameter }, subject: title })
          continue
        }
        if (recognition.label.trim() === '') {
          found.push({ area: 'scoring', code: 'recognition-unnamed', entity: { kind: 'recognition', handle: binding.handle }, subject: title })
        }
        if (!narrowingFits(recognition.refinement, schema)) {
          found.push({ area: 'scoring', code: 'refinement-widens', entity: { kind: 'recognition', handle: binding.handle }, subject: recognition.label })
        }
        if (recognition.fieldId !== null && !draft.fields.some((field) => field.id === recognition.fieldId)) {
          found.push({ area: 'scoring', code: 'link-field-missing', entity: { kind: 'recognition', handle: binding.handle }, subject: recognition.label })
        } else if (draft.mode === 'direct' && recognition.fieldId === null) {
          found.push({ area: 'scoring', code: 'recognition-unlinked', entity: { kind: 'recognition', handle: binding.handle }, subject: recognition.label })
        }
      }
      for (const parameter of Object.keys(draft.scoring.bindings).sort()) {
        if (!Object.hasOwn(contract.inputSchema.properties, parameter)) {
          found.push({ area: 'scoring', code: 'binding-orphan', entity: { kind: 'parameter', parameter }, subject: parameter })
        }
      }
    }
  }

  if (draft.mode === 'review') {
    const normal = draft.stages.filter((stage) => stage.chain === 'normal')
    if (normal.length === 0) found.push({ area: 'rules', code: 'stages-required' })
    for (const stage of draft.stages) {
      if (!stageReady(stage, options)) {
        found.push({
          area: 'rules',
          code: 'stage-unset',
          entity: { kind: 'stage', key: stage.key },
          subject: stage.label.trim(),
        })
      }
    }
  }
  if (draft.mode !== 'automatic' && draft.maxEntries.trim() !== '' && !(Number(draft.maxEntries) >= 1)) {
    found.push({ area: 'rules', code: 'max-entries-invalid' })
  }
  if (draft.mode !== 'automatic' && draft.folding === 'top-n' && !(Number(draft.topN) >= 1)) {
    found.push({ area: 'rules', code: 'top-n-invalid' })
  }
  return found
}

/** the words a parameter goes by, for a row or a panel title */
export const parameterTitle = (contract: Contract | null, parameter: string, locale: string): string => {
  const schema = parameterSchemaOf(contract, parameter)
  return schema === undefined ? parameter : displayTitle(schema, parameter, locale)
}

export const parameterDescription = (contract: Contract | null, parameter: string, locale: string): string | undefined => {
  const schema = parameterSchemaOf(contract, parameter)
  return schema === undefined ? undefined : displayDescription(schema, locale)
}

/** a fresh determination for one parameter, named after it */
export const freshRecognition = (contract: Contract | null, parameter: string, locale: string): RecognitionDraft => ({
  id: null,
  label: parameterTitle(contract, parameter, locale),
  description: parameterDescription(contract, parameter, locale) ?? '',
  refinement: null,
  fieldId: null,
})

export { SUMMARY_FIELDS_MOST }
