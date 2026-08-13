import { Effect, Result, Schema } from 'effect'
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
  key: fieldKey,
  type: Schema.Literal('text'),
  label,
  required: Schema.optional(Schema.Boolean),
  maxLength: Schema.optional(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1))),
})

const dateField = Schema.Struct({
  key: fieldKey,
  type: Schema.Literal('date'),
  label,
  required: Schema.optional(Schema.Boolean),
  min: Schema.optional(isoDate),
  max: Schema.optional(isoDate),
})

const attachmentField = Schema.Struct({
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

const field = Schema.Union([textField, dateField, attachmentField])
export type EvidenceField = typeof field.Type

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
      for (const entry of fields) {
        if (entry.type === 'date' && entry.min !== undefined && entry.max !== undefined) {
          if (entry.min > entry.max) return 'a date field’s min must not exceed its max'
        }
      }
      return undefined
    }),
  ),
})
export type EvidenceConfig = typeof evidenceConfig.Type

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
        })
      }
    }
  }
  return refs
}

export const evidenceDriver: ItemTypeDriver = {
  id: 'evidence',
  configSchema: evidenceConfig,
  decodePayload: decode,
  attachmentRefs,
  interaction: 'entry',
  scoring: { calculator: 'fixed@1', aggregator: 'sum@1' },
}
