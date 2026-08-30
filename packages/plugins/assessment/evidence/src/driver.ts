import { Effect, Result, Schema } from 'effect'
import {
  canonicalDecimal,
  compareDecimal,
  fractionalDigits,
  normalizeAtomicSchema,
  parseDecimal,
  type AtomicSchema,
} from '@qualy/value-schema'
import { validateValue } from '@qualy/value-schema/validate'
import {
  ItemPayloadInvalid,
  type AttachmentRef,
  type BatchContext,
  type ItemTypeDriver,
} from '@qualy/plugin-assessment/plugin'

// The evidence item type: a student uploads proof of something, a reviewer
// judges it.
//
// The form is a list of fields an administrator composes - text, a date, an
// attachment - and this driver is the only place their meaning lives. Three
// field kinds, because that is what the first real items need; the richer
// vocabulary (enums, event picks, patterns) arrives when an item needs it,
// not before.

const fieldKey = Schema.String.check(
  Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  Schema.isMaxLength(63),
)

/**
 * A field's permanent name for itself, as opposed to `key`, which is where
 * its answer sits in the payload.
 *
 * The two are minted equal and both immutable, so on the face of it one
 * would do. They are separate because they answer different questions once
 * a form has been edited a few times. `key` has to keep pointing at the same
 * slot in payloads written years ago; `id` has to say whether the field an
 * administrator is looking at now is the same field it was in the previous
 * revision - which is what decides whether a stored answer carries over,
 * and which is not true when the type underneath it changed.
 *
 * Optional because forms written before identities existed have none. Those
 * fall back to their key, which is what identified them then and still does
 * - see `fieldIdentity`. Nothing is rewritten: an item revision is immutable,
 * and a history that gains fields it was not saved with is not history.
 */
const fieldId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(63))

/** an administrator-authored label: business data, not a message catalog key */
const label = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100))

const isRealDate = (value: string) => {
  const at = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === value
}

const isoDate = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/),
  Schema.makeFilter((value: string) => isRealDate(value) || 'must be a real calendar date'),
)

const textField = Schema.Struct({
  id: Schema.optional(fieldId),
  key: fieldKey,
  type: Schema.Literal('text'),
  label,
  required: Schema.optional(Schema.Boolean),
  maxLength: Schema.optional(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1))),
})

const dateField = Schema.Struct({
  id: Schema.optional(fieldId),
  key: fieldKey,
  type: Schema.Literal('date'),
  label,
  required: Schema.optional(Schema.Boolean),
  min: Schema.optional(isoDate),
  max: Schema.optional(isoDate),
})

const integerField = Schema.Struct({
  id: Schema.optional(fieldId),
  key: fieldKey,
  type: Schema.Literal('integer'),
  label,
  required: Schema.optional(Schema.Boolean),
  min: Schema.optional(Schema.Number.check(Schema.isInt())),
  max: Schema.optional(Schema.Number.check(Schema.isInt())),
})

/** a decimal bound as text, judged by the value layer's own grammar */
const decimalBound = Schema.String.check(
  Schema.makeFilter(
    (value: string) => parseDecimal(value) !== null || 'must be a decimal amount',
  ),
)

const decimalField = Schema.Struct({
  id: Schema.optional(fieldId),
  key: fieldKey,
  type: Schema.Literal('decimal'),
  label,
  required: Schema.optional(Schema.Boolean),
  // explicit rather than defaulted: the config is the record of what the
  // administrator decided, and the value profile caps the scale at 18
  maxScale: Schema.Number.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThanOrEqualTo(18),
  ),
  min: Schema.optional(decimalBound),
  max: Schema.optional(decimalBound),
})

const choiceOption = Schema.Struct({
  /** the semantic stable value payloads carry; never the words on screen */
  value: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  /** the words on screen; renaming one never touches stored payloads */
  label: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255)),
})

const choiceField = Schema.Struct({
  id: Schema.optional(fieldId),
  key: fieldKey,
  type: Schema.Literal('choice'),
  label,
  required: Schema.optional(Schema.Boolean),
  options: Schema.Array(choiceOption),
})

const attachmentField = Schema.Struct({
  id: Schema.optional(fieldId),
  key: fieldKey,
  type: Schema.Literal('attachment'),
  label,
  required: Schema.optional(Schema.Boolean),
  maxCount: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
  maxFileBytes: Schema.optional(
    Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
  ),
  accept: Schema.optional(Schema.Array(Schema.String)),
})

const field = Schema.Union([textField, dateField, integerField, decimalField, choiceField, attachmentField])
export type EvidenceField = typeof field.Type

/**
 * What this field is called across revisions: its own id, or - for a form
 * written before ids - the key it has always been known by.
 */
export const fieldIdentity = (entry: { id?: string | undefined; key: string }): string =>
  entry.id ?? entry.key

/**
 * What an administrator writes: an ordered, non-empty list of fields with
 * distinct keys, and a date field whose own bounds are in order.
 */
export const evidenceConfig = Schema.Struct({
  fields: Schema.Array(field).check(
    Schema.makeFilter((fields: readonly EvidenceField[]) => {
      if (fields.length === 0) return 'at least one field'
      const keys = new Set(fields.map((entry) => entry.key))
      if (keys.size !== fields.length) return 'field keys must be distinct'
      const ids = new Set(fields.map(fieldIdentity))
      if (ids.size !== fields.length) return 'field identities must be distinct'
      for (const entry of fields) {
        if (entry.type === 'date' && entry.min !== undefined && entry.max !== undefined) {
          if (entry.min > entry.max) return 'a date field’s min must not exceed its max'
        }
        if (entry.type === 'integer' && entry.min !== undefined && entry.max !== undefined) {
          if (entry.min > entry.max) return 'an integer field’s min must not exceed its max'
        }
        if (entry.type === 'decimal') {
          for (const bound of [entry.min, entry.max]) {
            if (bound === undefined) continue
            const parts = parseDecimal(bound)
            if (parts !== null && fractionalDigits(parts) > entry.maxScale)
              return 'a decimal bound must fit the field’s own scale'
          }
          if (entry.min !== undefined && entry.max !== undefined) {
            const low = parseDecimal(entry.min)
            const high = parseDecimal(entry.max)
            if (low !== null && high !== null && compareDecimal(low, high) > 0)
              return 'a decimal field’s min must not exceed its max'
          }
        }
        if (entry.type === 'choice') {
          if (entry.options.length === 0) return 'a choice field needs at least one option'
          if (entry.options.length > 256) return 'a choice field takes at most 256 options'
          const values = new Set(entry.options.map((option) => option.value))
          if (values.size !== entry.options.length) return 'choice values must be distinct'
        }
      }
      return undefined
    }),
  ),
})
export type EvidenceConfig = typeof evidenceConfig.Type

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * One field's type as a value schema - the single truth the same field is
 * decoded, bound and seeded by.
 *
 * A field that answers here is judged by the value layer's validator; a
 * scoring parameter that binds it is proven against exactly this schema; a
 * recognition seeded from it converts by exactly this schema. Attachments
 * answer null: files are references with their own rules, not values.
 *
 * Dates keep their bounds out of the schema on purpose - the profile's date
 * has no bound keywords, and a date's real bounds also depend on the
 * batch's material range, which no per-field schema can carry - so the
 * driver's own decode keeps judging them.
 */
export const fieldSchema = (field: EvidenceField): AtomicSchema | null => {
  switch (field.type) {
    case 'text':
      return {
        type: 'string',
        ...(field.maxLength === undefined ? {} : { maxLength: field.maxLength }),
        title: field.label,
      }
    case 'integer':
      // the profile demands explicit safe bounds; an unbounded field means
      // "anything JSON can carry without losing precision"
      return {
        type: 'integer',
        minimum: field.min ?? Number.MIN_SAFE_INTEGER,
        maximum: field.max ?? Number.MAX_SAFE_INTEGER,
        title: field.label,
      }
    case 'decimal':
      return {
        type: 'string',
        format: 'qualy-decimal',
        'x-qualy-maxScale': field.maxScale,
        ...(field.min === undefined ? {} : { 'x-qualy-minimum': field.min }),
        ...(field.max === undefined ? {} : { 'x-qualy-maximum': field.max }),
        title: field.label,
      }
    case 'choice':
      return {
        type: 'string',
        enum: field.options.map((option) => option.value),
        // the words ride the annotation layer, where renaming them never
        // touches what the values mean
        'x-qualy-enumLabels': Object.fromEntries(
          field.options.map((option) => [option.value, option.label]),
        ),
        title: field.label,
      }
    case 'date':
      return { type: 'string', format: 'date', title: field.label }
    case 'attachment':
      return null
  }
}

/**
 * Whether every filing of this field is guaranteed to carry a value.
 *
 * The schema says what a value looks like when it is there; this says it is
 * always there. Today the only guarantee is `required` - a required field
 * refuses absence and, for text, refuses the empty string. The day a field
 * grows a server-side default or a condition, this is the one place that
 * learns about it, because automatic recognition leans on this answer.
 */
export const fieldGuaranteesValue = (field: EvidenceField): boolean => field.required === true

/** the validator's keyword vocabulary, said in this driver's own reasons */
const reasonOf = (fieldType: string, keyword: string): string => {
  if (keyword === 'type') {
    return fieldType === 'integer'
      ? 'not-an-integer'
      : fieldType === 'decimal'
        ? 'not-a-decimal'
        : 'not-a-choice'
  }
  if (keyword === 'format') return 'not-a-decimal'
  if (keyword === 'enum') return 'not-a-choice'
  if (keyword === 'x-qualy-maxScale') return 'too-precise'
  if (keyword === 'minimum' || keyword === 'maximum') return 'out-of-range'
  if (keyword === 'x-qualy-minimum' || keyword === 'x-qualy-maximum') return 'out-of-range'
  return keyword
}

type Issue = { field: string; reason: string }

const decodeConfig = (config: unknown): EvidenceConfig | null => {
  const decoded = Schema.decodeUnknownResult(evidenceConfig)(config)
  return Result.isSuccess(decoded) ? decoded.success : null
}

/**
 * The payload, held to the form and to the round.
 *
 * A date answers to three bounds at once: the field's own min and max, and
 * the batch's material range - a certificate dated outside the round it is
 * claimed in is refused here, not by a reviewer noticing. The half-open
 * range end is exclusive, matching how the batch stores it.
 */
const decode = (
  config: unknown,
  payload: unknown,
  batch: BatchContext,
): Effect.Effect<unknown, ItemPayloadInvalid> =>
  Effect.suspend(() => {
    const form = decodeConfig(config)
    if (form === null) {
      return Effect.fail(new ItemPayloadInvalid([{ field: '', reason: 'config-unreadable' }]))
    }
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      return Effect.fail(new ItemPayloadInvalid([{ field: '', reason: 'not-an-object' }]))
    }
    const record = payload as Record<string, unknown>
    const issues: Issue[] = []
    const known = new Set(form.fields.map((entry) => entry.key))
    for (const key of Object.keys(record)) {
      if (!known.has(key)) issues.push({ field: key, reason: 'unknown-field' })
    }

    const decoded: Record<string, unknown> = {}
    for (const entry of form.fields) {
      const value = record[entry.key]
      const missing = value === undefined || value === null
      if (missing) {
        if (entry.required === true) issues.push({ field: entry.key, reason: 'required' })
        continue
      }
      switch (entry.type) {
        case 'text': {
          if (typeof value !== 'string') {
            issues.push({ field: entry.key, reason: 'not-text' })
            break
          }
          const trimmed = value.trim()
          if (entry.required === true && trimmed === '') {
            issues.push({ field: entry.key, reason: 'required' })
            break
          }
          if (entry.maxLength !== undefined && trimmed.length > entry.maxLength) {
            issues.push({ field: entry.key, reason: 'too-long' })
            break
          }
          decoded[entry.key] = trimmed
          break
        }
        case 'date': {
          if (
            typeof value !== 'string' ||
            !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
            !isRealDate(value)
          ) {
            issues.push({ field: entry.key, reason: 'not-a-date' })
            break
          }
          const lower =
            entry.min !== undefined && entry.min > batch.materialRange.start
              ? entry.min
              : batch.materialRange.start
          const upper =
            entry.max !== undefined && entry.max < batch.materialRange.end
              ? entry.max
              : batch.materialRange.end
          // the range end is exclusive; a field max is inclusive, so the
          // comparison differs by which bound won
          const belowLower = value < lower
          const aboveUpper =
            entry.max !== undefined && entry.max < batch.materialRange.end
              ? value > upper
              : value >= upper
          if (belowLower || aboveUpper) {
            issues.push({ field: entry.key, reason: 'out-of-range' })
            break
          }
          decoded[entry.key] = value
          break
        }
        case 'integer':
        case 'decimal':
        case 'choice': {
          // one schema, one judge: the same shape a scoring binding proves
          // against is what the payload answers to. No coercion - an
          // integer arrives as a number or not at all, because "3" the
          // string is a different claim about what was filed.
          const schema = fieldSchema(entry)!
          const wrong = validateValue(normalizeAtomicSchema(schema), value)
          if (wrong.length > 0) {
            issues.push({ field: entry.key, reason: reasonOf(entry.type, wrong[0]!.reason) })
            break
          }
          // the canonical spelling is the stored fact: "03.2500" and "3.25"
          // are one amount, and the revision keeps the one way of writing it
          decoded[entry.key] =
            entry.type === 'decimal' ? canonicalDecimal(value as string) : value
          break
        }
        case 'attachment': {
          if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
            issues.push({ field: entry.key, reason: 'not-attachments' })
            break
          }
          const ids = value as string[]
          if (ids.some((item) => !UUID.test(item))) {
            issues.push({ field: entry.key, reason: 'not-attachments' })
            break
          }
          if (new Set(ids).size !== ids.length) {
            issues.push({ field: entry.key, reason: 'duplicate-attachment' })
            break
          }
          if (entry.required === true && ids.length === 0) {
            issues.push({ field: entry.key, reason: 'required' })
            break
          }
          if (ids.length > entry.maxCount) {
            issues.push({ field: entry.key, reason: 'too-many-attachments' })
            break
          }
          decoded[entry.key] = ids
          break
        }
      }
    }
    return issues.length > 0 ? Effect.fail(new ItemPayloadInvalid(issues)) : Effect.succeed(decoded)
  })

/**
 * Which attachments a payload cites, straight off the field list.
 *
 * Read without judgement: this runs on payloads that already decoded, and on
 * historical ones whose config is not the current one - so it answers from
 * whatever is there rather than refusing what a stricter decode would.
 */
const attachmentRefs = (config: unknown, payload: unknown): readonly AttachmentRef[] => {
  const form = decodeConfig(config)
  if (form === null || typeof payload !== 'object' || payload === null) return []
  const record = payload as Record<string, unknown>
  const refs: AttachmentRef[] = []
  for (const entry of form.fields) {
    if (entry.type !== 'attachment') continue
    const value = record[entry.key]
    if (!Array.isArray(value)) continue
    for (const item of value) {
      if (typeof item === 'string' && UUID.test(item)) {
        refs.push({
          field: entry.key,
          attachmentId: item,
          ...(entry.accept !== undefined ? { accept: entry.accept } : {}),
          ...(entry.maxFileBytes !== undefined ? { maxFileBytes: entry.maxFileBytes } : {}),
        })
      }
    }
  }
  return refs
}

/**
 * An answer written under one version of the form, read as an answer to the
 * next one.
 *
 * Matched by identity, never by position and never by slot: a form whose
 * fields were reordered is the same three questions, and a slot that was
 * emptied by a deletion is not an answer to whatever was added afterwards.
 * A field whose type changed is treated as gone - "2026-04-12" is not an
 * answer to a question that is now asking for text.
 *
 * This is a reading, not a write. Nothing filed is altered; the projection
 * exists so that "would this answer still be acceptable" can be asked of a
 * configuration the answer was not written under.
 */
const project = (fromConfig: unknown, toConfig: unknown, payload: unknown): unknown => {
  const to = decodeConfig(toConfig)
  if (to === null) return payload
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return payload
  const record = payload as Record<string, unknown>
  const from = decodeConfig(fromConfig)
  const was = new Map<string, { key: string; type: string | undefined }>(
    from === null
      ? // the form it was written under is unreadable here, so the slot is
        // all there is to go on - which is what identity meant before ids
        Object.keys(record).map((key) => [key, { key, type: undefined }] as const)
      : from.fields.map(
          (one) => [fieldIdentity(one), { key: one.key, type: one.type as string }] as const,
        ),
  )
  const projected: Record<string, unknown> = {}
  for (const entry of to.fields) {
    const before = was.get(fieldIdentity(entry))
    if (before === undefined) continue
    if (before.type !== undefined && before.type !== entry.type) continue
    const value = record[before.key]
    if (value !== undefined) projected[entry.key] = value
  }
  return projected
}

/**
 * What the schema cannot see: a date field against the round it will run in.
 *
 * A window that misses the material range entirely is well-formed and
 * unusable - required, and no legal day exists. Refused at save, where the
 * administrator is, rather than at the first student's first attempt.
 */
const configIssues = (
  config: unknown,
  batch: BatchContext,
): readonly { path: string; reason: string }[] => {
  const form = decodeConfig(config)
  if (form === null) return []
  const issues: { path: string; reason: string }[] = []
  for (const [index, entry] of form.fields.entries()) {
    if (entry.type !== 'date') continue
    const lower =
      entry.min !== undefined && entry.min > batch.materialRange.start
        ? entry.min
        : batch.materialRange.start
    // the range end is exclusive, a field max inclusive: the window is empty
    // when the floor reaches past the last legal day
    const emptyAgainstRange = lower >= batch.materialRange.end
    const emptyAgainstMax = entry.max !== undefined && entry.max < lower
    if (emptyAgainstRange || emptyAgainstMax) {
      issues.push({ path: `formConfig.fields[${index}]`, reason: 'date-window-empty' })
    }
  }
  return issues
}

/**
 * What a scoring parameter may bind to: every typed field, as the identity
 * that survives revisions, the payload address this revision actually uses,
 * the one schema, and whether a filing is guaranteed to carry it.
 * Attachments never appear - a file is not a value.
 */
const bindableFields = (config: unknown): ReturnType<
  NonNullable<ItemTypeDriver['bindableFields']>
> => {
  const form = decodeConfig(config)
  if (form === null) return []
  return form.fields.flatMap((entry) => {
    const schema = fieldSchema(entry)
    if (schema === null) return []
    return [
      {
        fieldId: fieldIdentity(entry),
        payloadKey: entry.key,
        schema,
        always: fieldGuaranteesValue(entry),
      },
    ]
  })
}

export const evidenceDriver: ItemTypeDriver = {
  id: 'evidence',
  configSchema: evidenceConfig,
  configIssues,
  decodePayload: decode,
  projectPayload: project,
  attachmentRefs,
  bindableFields,
  interaction: 'entry',
  scoring: { calculator: 'fixed@1', aggregator: 'sum@1' },
}
