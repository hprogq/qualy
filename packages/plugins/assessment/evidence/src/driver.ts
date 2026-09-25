import { Effect, Result, Schema } from 'effect'
import {
  canonicalDecimal,
  compareDecimal,
  fractionalDigits,
  normalizeAtomicSchema,
  parseDecimal,
  PROFILE_LIMITS,
  validateAtomicProfile,
  type AtomicSchema,
} from '@qualy/value-schema'
import { MAX_PATTERN_BYTES, patternIssues } from '@qualy/value-schema/regex'
import { validateValue } from '@qualy/value-schema/validate'
import {
  ItemPayloadInvalid,
  MAX_ISSUES,
  type AttachmentRef,
  type BatchContext,
  type BindableField,
  type ItemTypeDriver,
} from '@qualy/plugin-assessment/plugin'

// The evidence item type: a participant files something, a reviewer judges it.
//
// The form is a list of fields an administrator composes, and this driver is
// the only place their meaning lives. Every atomic kind the value profile
// speaks - text, integer, decimal, choice, boolean, date - is a field here,
// so that whatever a scoring parameter asks for, a filing field can be made
// to carry it; attachments are the one field with no value schema, because a
// file is a reference and not a value.
//
// A form may have no fields at all. A question that asks nothing is still a
// question somebody confirms with one press, and the same driver reads that
// press as the empty payload it is.

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

/** the words under a field that say how to fill it in; optional, and business data */
const description = Schema.optional(Schema.String.check(Schema.isMaxLength(500)))

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
  description,
  required: Schema.optional(Schema.Boolean),
  minLength: Schema.optional(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))),
  maxLength: Schema.optional(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1))),
  /** held to the value profile's regex dialect, like every pattern a parameter carries */
  pattern: Schema.optional(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_PATTERN_BYTES)),
  ),
})

const dateField = Schema.Struct({
  id: Schema.optional(fieldId),
  key: fieldKey,
  type: Schema.Literal('date'),
  label,
  description,
  required: Schema.optional(Schema.Boolean),
  min: Schema.optional(isoDate),
  max: Schema.optional(isoDate),
  /**
   * Whether the answer must also fall inside the round's material window.
   *
   * Off unless the question says so: plenty of dates a question asks for are
   * true outside the window it is claimed in - when somebody enrolled, when
   * a certificate was issued - and refusing those taught people to file the
   * wrong date. A question about when the thing being claimed happened turns
   * it on, and then the window is the batch's, not a pair of bounds every
   * author would have to copy.
   */
  inMaterialRange: Schema.optional(Schema.Boolean),
})

const integerField = Schema.Struct({
  id: Schema.optional(fieldId),
  key: fieldKey,
  type: Schema.Literal('integer'),
  label,
  description,
  required: Schema.optional(Schema.Boolean),
  min: Schema.optional(Schema.Number.check(Schema.isInt())),
  max: Schema.optional(Schema.Number.check(Schema.isInt())),
})

/** a decimal bound as text, judged by the value layer's own grammar */
const decimalBound = Schema.String.check(
  Schema.makeFilter((value: string) => parseDecimal(value) !== null || 'must be a decimal amount'),
)

const decimalField = Schema.Struct({
  id: Schema.optional(fieldId),
  key: fieldKey,
  type: Schema.Literal('decimal'),
  label,
  description,
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

/**
 * One option of a choice field.
 *
 * Three names for three jobs. `value` is what payloads carry and what a
 * scoring parameter reads; it is the stable identity of the answer. `label`
 * is the words on screen, and renaming it never touches a payload. `id` is
 * the option's identity across revisions of the form: it is what lets a
 * value be respelled - when a field is bound to a scoring parameter and its
 * options take the parameter's own values - without every answer already
 * filed losing the option it named. Options written before ids existed are
 * identified by their value, as they always were.
 *
 * `enabled` retires an option without deleting it: a question that has been
 * filed against keeps every option anybody ever chose, so the words for an
 * old answer are always there to be read, while new filings may only pick
 * what is on offer today.
 */
const choiceOption = Schema.Struct({
  id: Schema.optional(fieldId),
  /** the semantic stable value payloads carry; never the words on screen */
  value: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  /** the words on screen; renaming one never touches stored payloads */
  label: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255)),
  enabled: Schema.optional(Schema.Boolean),
})
export type EvidenceChoiceOption = typeof choiceOption.Type

const choiceField = Schema.Struct({
  id: Schema.optional(fieldId),
  key: fieldKey,
  type: Schema.Literal('choice'),
  label,
  description,
  required: Schema.optional(Schema.Boolean),
  options: Schema.Array(choiceOption),
})

const booleanField = Schema.Struct({
  id: Schema.optional(fieldId),
  key: fieldKey,
  type: Schema.Literal('boolean'),
  label,
  description,
  required: Schema.optional(Schema.Boolean),
})

const attachmentField = Schema.Struct({
  id: Schema.optional(fieldId),
  key: fieldKey,
  type: Schema.Literal('attachment'),
  label,
  description,
  required: Schema.optional(Schema.Boolean),
  maxCount: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
  maxFileBytes: Schema.optional(
    Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
  ),
  accept: Schema.optional(Schema.Array(Schema.String)),
})

const field = Schema.Union([
  textField,
  dateField,
  integerField,
  decimalField,
  choiceField,
  booleanField,
  attachmentField,
])
export type EvidenceField = typeof field.Type

/**
 * What this field is called across revisions: its own id, or - for a form
 * written before ids - the key it has always been known by.
 */
export const fieldIdentity = (entry: { id?: string | undefined; key: string }): string =>
  entry.id ?? entry.key

/** what an option is called across revisions: its id, or the value it was born with */
export const optionIdentity = (option: { id?: string | undefined; value: string }): string =>
  option.id ?? option.value

/** whether an option is on offer to a new filing; absent means it is */
export const optionEnabled = (option: { enabled?: boolean | undefined }): boolean =>
  option.enabled !== false

/**
 * The words for one stored choice value, retired options included.
 *
 * The schema a filing is judged by only knows the options on offer; an
 * answer filed under an option since retired still has its words here.
 * Null when the value names no option this field ever had.
 */
export const optionLabelOf = (
  entry: { options: readonly EvidenceChoiceOption[] },
  value: string,
): string | null => entry.options.find((option) => option.value === value)?.label ?? null

/**
 * What is wrong with one field on its own, or nothing.
 *
 * Every rule a field can break by itself, said in one place so that the
 * whole-form check and the field-by-field reading of an unfinished form
 * agree about what a legal field is.
 */
const fieldIssue = (entry: EvidenceField): string | undefined => {
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
  if (entry.type === 'text') {
    if (
      entry.minLength !== undefined &&
      entry.maxLength !== undefined &&
      entry.minLength > entry.maxLength
    )
      return 'a text field’s shortest length must not exceed its longest'
  }
  if (entry.type === 'choice') {
    if (entry.options.length === 0) return 'a choice field needs at least one option'
    if (entry.options.length > 256) return 'a choice field takes at most 256 options'
    const values = new Set(entry.options.map((option) => option.value))
    if (values.size !== entry.options.length) return 'choice values must be distinct'
    const ids = new Set(entry.options.map(optionIdentity))
    if (ids.size !== entry.options.length) return 'choice option identities must be distinct'
    if (!entry.options.some(optionEnabled)) return 'a choice field needs an option on offer'
  }
  // The one proof that closes the whole family: every schema this
  // configuration will ever hand out - to the payload decoder, to the
  // scoring binder - must be legal under the value profile TODAY, or an
  // accepted configuration detonates later inside the trusted process (an
  // unsafe integer bound, an over-long text cap, a pattern outside the
  // regex dialect) as a defect instead of this refusal.
  const schema = fieldSchema(entry)
  if (schema === null) return undefined
  const outside = validateAtomicProfile(schema)
  if (outside.length > 0) {
    return `field "${entry.key}" falls outside the value profile: ${outside[0]!.reason}`
  }
  const dialect = patternIssues(schema)
  if (dialect.length > 0) {
    return `field "${entry.key}" falls outside the value profile: ${dialect[0]!.reason}`
  }
  try {
    normalizeAtomicSchema(schema)
  } catch {
    return `field "${entry.key}" falls outside the value profile`
  }
  return undefined
}

/**
 * What an administrator writes: an ordered list of fields with distinct
 * keys and distinct identities, each legal on its own. Possibly empty - a
 * question with nothing to fill in is confirmed rather than filled in.
 */
export const evidenceConfig = Schema.Struct({
  fields: Schema.Array(field).check(
    Schema.makeFilter((fields: readonly EvidenceField[]) => {
      const keys = new Set(fields.map((entry) => entry.key))
      if (keys.size !== fields.length) return 'field keys must be distinct'
      const ids = new Set(fields.map(fieldIdentity))
      if (ids.size !== fields.length) return 'field identities must be distinct'
      for (const entry of fields) {
        const wrong = fieldIssue(entry)
        if (wrong !== undefined) return wrong
      }
      return undefined
    }),
  ),
})
export type EvidenceConfig = typeof evidenceConfig.Type

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * What a payload says for one field: its own answer, never something every
 * object inherits. A field keyed `constructor` read the plain way found
 * `Object` in a payload that left it blank.
 */
const answerOf = (record: Record<string, unknown>, key: string): unknown =>
  Object.hasOwn(record, key) ? record[key] : undefined

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
  const words = {
    title: field.label,
    ...(field.description === undefined ? {} : { description: field.description }),
  }
  switch (field.type) {
    case 'text': {
      // decode refuses a required text whose trimmed answer is empty, so
      // the effective value domain already excludes ''. Saying so here is
      // what keeps a binding proof honest - a schema that stayed silent
      // would refuse a perfectly safe assignment to a nonempty target as
      // widening.
      const shortest = Math.max(field.minLength ?? 0, field.required === true ? 1 : 0)
      return {
        type: 'string',
        ...(shortest > 0 ? { minLength: shortest } : {}),
        ...(field.maxLength === undefined ? {} : { maxLength: field.maxLength }),
        ...(field.pattern === undefined ? {} : { pattern: field.pattern }),
        ...words,
      }
    }
    case 'integer':
      // the profile demands explicit safe bounds; an unbounded field means
      // "anything JSON can carry without losing precision"
      return {
        type: 'integer',
        minimum: field.min ?? Number.MIN_SAFE_INTEGER,
        maximum: field.max ?? Number.MAX_SAFE_INTEGER,
        ...words,
      }
    case 'decimal':
      return {
        type: 'string',
        format: 'qualy-decimal',
        'x-qualy-maxScale': field.maxScale,
        ...(field.min === undefined ? {} : { 'x-qualy-minimum': field.min }),
        ...(field.max === undefined ? {} : { 'x-qualy-maximum': field.max }),
        ...words,
      }
    case 'choice': {
      // only what is on offer: a retired option is not a value a new filing
      // may carry, and the words for one already filed live in the config
      const offered = field.options.filter(optionEnabled)
      return {
        type: 'string',
        enum: offered.map((option) => option.value),
        // the words ride the annotation layer, where renaming them never
        // touches what the values mean
        'x-qualy-enumLabels': Object.fromEntries(
          offered.map((option) => [option.value, option.label]),
        ),
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
        : fieldType === 'boolean'
          ? 'not-a-boolean'
          : fieldType === 'text'
            ? 'not-text'
            : 'not-a-choice'
  }
  if (keyword === 'format') return 'not-a-decimal'
  if (keyword === 'enum') return 'not-a-choice'
  if (keyword === 'x-qualy-maxScale') return 'too-precise'
  if (keyword === 'minimum' || keyword === 'maximum') return 'out-of-range'
  if (keyword === 'x-qualy-minimum' || keyword === 'x-qualy-maximum') return 'out-of-range'
  if (keyword === 'minLength') return 'too-short'
  if (keyword === 'maxLength') return 'too-long'
  if (keyword === 'pattern') return 'pattern-mismatch'
  return keyword
}

type Issue = { field: string; reason: string }

const decodeConfig = (config: unknown): EvidenceConfig | null => {
  const decoded = Schema.decodeUnknownResult(evidenceConfig)(config)
  return Result.isSuccess(decoded) ? decoded.success : null
}

/** one field read on its own, for a form that is still being composed */
const decodeField = (candidate: unknown): EvidenceField | null => {
  const decoded = Schema.decodeUnknownResult(field)(candidate)
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
      if (known.has(key)) continue
      issues.push({ field: key, reason: 'unknown-field' })
      // the refusal names at most MAX_ISSUES, and this runs under the
      // round's lock: walking the rest of a huge object only costs time
      if (issues.length > MAX_ISSUES) break
    }

    const decoded: Record<string, unknown> = {}
    for (const entry of form.fields) {
      const value = answerOf(record, entry.key)
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
          // an optional text left blank is an absence, not a too-short
          // answer: the length and format rules speak to what was written
          if (trimmed !== '') {
            const schema = fieldSchema(entry)!
            const wrong = validateValue(normalizeAtomicSchema(schema), trimmed)
            if (wrong.length > 0) {
              issues.push({ field: entry.key, reason: reasonOf(entry.type, wrong[0]!.reason) })
              break
            }
            // A field that sets no length of its own is still held to the
            // longest any field may be set to: otherwise one answer could
            // be as long as the request, stored with every revision and
            // served to every reviewer.
            if (
              entry.maxLength === undefined &&
              [...trimmed].length > PROFILE_LIMITS.textLengthBound
            ) {
              issues.push({ field: entry.key, reason: 'too-long' })
              break
            }
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
          const bounded = entry.inMaterialRange === true
          const lower =
            !bounded || (entry.min !== undefined && entry.min > batch.materialRange.start)
              ? entry.min
              : batch.materialRange.start
          const upper =
            !bounded || (entry.max !== undefined && entry.max < batch.materialRange.end)
              ? entry.max
              : batch.materialRange.end
          // the range end is exclusive; a field max is inclusive, so the
          // comparison differs by which bound won
          const belowLower = lower !== undefined && value < lower
          const aboveUpper =
            upper === undefined
              ? false
              : !bounded || (entry.max !== undefined && entry.max < batch.materialRange.end)
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
        case 'choice':
        case 'boolean': {
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
          decoded[entry.key] = entry.type === 'decimal' ? canonicalDecimal(value as string) : value
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
    const value = answerOf(record, entry.key)
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
 * A chosen option follows its identity the same way: an option whose value
 * was respelled between the two versions - because the field was bound to a
 * scoring parameter and took its values - is still the option that was
 * chosen, and the answer is read as the value it carries now.
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
  const was = new Map<string, { key: string; field: EvidenceField | undefined }>(
    from === null
      ? // the form it was written under is unreadable here, so the slot is
        // all there is to go on - which is what identity meant before ids
        Object.keys(record).map((key) => [key, { key, field: undefined }] as const)
      : from.fields.map((one) => [fieldIdentity(one), { key: one.key, field: one }] as const),
  )
  const projected: Record<string, unknown> = {}
  for (const entry of to.fields) {
    const before = was.get(fieldIdentity(entry))
    if (before === undefined) continue
    if (before.field !== undefined && before.field.type !== entry.type) continue
    const value = answerOf(record, before.key)
    if (value === undefined) continue
    if (entry.type === 'choice' && before.field?.type === 'choice' && typeof value === 'string') {
      const chosen = before.field.options.find((option) => option.value === value)
      const now =
        chosen === undefined
          ? undefined
          : entry.options.find((option) => optionIdentity(option) === optionIdentity(chosen))
      projected[entry.key] = now === undefined ? value : now.value
      continue
    }
    projected[entry.key] = value
  }
  return projected
}

/** a date window that misses the round entirely, said for one field */
const dateWindowEmpty = (entry: EvidenceField, batch: BatchContext): boolean => {
  if (entry.type !== 'date') return false
  // a field that does not answer to the window cannot miss it
  if (entry.inMaterialRange !== true)
    return entry.max !== undefined && entry.min !== undefined && entry.max < entry.min
  const lower =
    entry.min !== undefined && entry.min > batch.materialRange.start
      ? entry.min
      : batch.materialRange.start
  // the range end is exclusive, a field max inclusive: the window is empty
  // when the floor reaches past the last legal day
  const emptyAgainstRange = lower >= batch.materialRange.end
  const emptyAgainstMax = entry.max !== undefined && entry.max < lower
  return emptyAgainstRange || emptyAgainstMax
}

/**
 * The most fields one form may ask, and the most file kinds one attachment
 * field may list. Held at save rather than in the schema: a form stored
 * before the ceiling still has to be readable, and every filing against it
 * still has to decode.
 */
const FIELDS_MOST = 50
const ACCEPT_MOST = 32
const ACCEPT_LENGTH_MOST = 100

/**
 * What the schema cannot see: a date field against the round it will run in,
 * and a form larger than anybody fills in.
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
  if (form.fields.length > FIELDS_MOST) {
    return [{ path: 'formConfig.fields', reason: 'fields-too-many' }]
  }
  const issues: { path: string; reason: string }[] = []
  for (const [index, entry] of form.fields.entries()) {
    if (dateWindowEmpty(entry, batch)) {
      issues.push({ path: `formConfig.fields[${index}]`, reason: 'date-window-empty' })
    }
    // a name every object already answers to - `constructor` is the one the
    // key pattern admits - would read as an answer where none was given
    if (entry.key in Object.prototype) {
      issues.push({ path: `formConfig.fields[${index}]`, reason: 'field-key-reserved' })
    }
    if (
      entry.type === 'attachment' &&
      entry.accept !== undefined &&
      (entry.accept.length > ACCEPT_MOST ||
        entry.accept.some((kind) => kind.length > ACCEPT_LENGTH_MOST))
    ) {
      issues.push({ path: `formConfig.fields[${index}]`, reason: 'accept-too-long' })
    }
  }
  return issues
}

const bindableOf = (entry: EvidenceField): BindableField | null => {
  const schema = fieldSchema(entry)
  if (schema === null) return null
  return {
    fieldId: fieldIdentity(entry),
    payloadKey: entry.key,
    schema,
    always: fieldGuaranteesValue(entry),
  }
}

/**
 * What a scoring parameter may bind to: every typed field, as the identity
 * that survives revisions, the payload address this revision actually uses,
 * the one schema, and whether a filing is guaranteed to carry it.
 * Attachments never appear - a file is not a value.
 */
const bindableFields = (config: unknown): readonly BindableField[] => {
  const form = decodeConfig(config)
  if (form === null) return []
  return form.fields.flatMap((entry) => {
    const bindable = bindableOf(entry)
    return bindable === null ? [] : [bindable]
  })
}

/**
 * The same reading of a form that is not finished yet.
 *
 * Field by field: one that cannot be read - no name yet, a bound outside
 * the profile, an option list with nothing on offer - is named at its index
 * and skipped, and every other field is offered for binding as it would be
 * on a finished form. Two fields answering to one key or one identity are
 * reported on the later of them. A form that is not even a list of fields is
 * reported as a whole.
 */
const draftFields = (
  config: unknown,
  batch: BatchContext,
): {
  readonly issues: readonly { readonly path: string; readonly reason: string }[]
  readonly bindableFields: readonly BindableField[]
} => {
  const fields = (config as { fields?: unknown } | null | undefined)?.fields
  if (typeof config !== 'object' || config === null || !Array.isArray(fields)) {
    return { issues: [{ path: 'formConfig', reason: 'form-config-invalid' }], bindableFields: [] }
  }
  const issues: { path: string; reason: string }[] = []
  const bindable: BindableField[] = []
  const keys = new Set<string>()
  const identities = new Set<string>()
  for (const [index, candidate] of fields.entries()) {
    const at = `formConfig.fields[${index}]`
    const entry = decodeField(candidate)
    if (entry === null) {
      // the one omission a form under construction almost always has is
      // its name, and the editor answers that one differently
      const raw = candidate as { label?: unknown } | null
      const unnamed =
        raw !== null &&
        typeof raw === 'object' &&
        (raw.label === undefined || (typeof raw.label === 'string' && raw.label.trim() === ''))
      issues.push({ path: at, reason: unnamed ? 'field-unnamed' : 'field-invalid' })
      continue
    }
    const wrong = fieldIssue(entry)
    if (wrong !== undefined) {
      issues.push({ path: at, reason: 'field-invalid' })
      continue
    }
    if (keys.has(entry.key) || identities.has(fieldIdentity(entry))) {
      issues.push({ path: at, reason: 'field-duplicate' })
      continue
    }
    keys.add(entry.key)
    identities.add(fieldIdentity(entry))
    if (dateWindowEmpty(entry, batch)) {
      issues.push({ path: at, reason: 'date-window-empty' })
      continue
    }
    const one = bindableOf(entry)
    if (one !== null) bindable.push(one)
  }
  return { issues, bindableFields: bindable }
}

/**
 * A field that keeps its identity while changing its type is refused. The
 * browser mints a fresh identity on retype and the projection drops values
 * across a type change - but neither is a gate: identity is what ties
 * historical evidence to recognition bindings, and one identity meaning two
 * value domains across revisions would quietly retype every frozen binding
 * that names it. A retype is a new field: mint a new id.
 */
const transition = (
  previous: unknown,
  next: unknown,
): readonly { readonly path: string; readonly reason: string }[] => {
  const from = decodeConfig(previous)
  const to = decodeConfig(next)
  if (from === null || to === null) return []
  const was = new Map(from.fields.map((one) => [fieldIdentity(one), one.type as string]))
  const issues: { path: string; reason: string }[] = []
  for (const entry of to.fields) {
    const before = was.get(fieldIdentity(entry))
    if (before !== undefined && before !== entry.type) {
      issues.push({
        path: `formConfig.fields.${entry.key}`,
        reason: 'field-type-change-requires-new-id',
      })
    }
  }
  return issues
}

export const evidenceDriver: ItemTypeDriver = {
  id: 'evidence',
  configSchema: evidenceConfig,
  configIssues,
  transitionIssues: transition,
  decodePayload: decode,
  projectPayload: project,
  attachmentRefs,
  bindableFields,
  draftFields,
  interaction: 'entry',
  scoring: { calculator: 'fixed@1', aggregator: 'sum@1' },
}
