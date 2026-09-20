import {
  DECIMAL_MAXIMUM,
  DECIMAL_MINIMUM,
  MAX_SCALE,
  choiceLabel,
  kindOf,
  type AtomicKind,
  type AtomicSchema,
  type ChoiceSchema,
} from '@qualy/value-schema'
import type { MessageDescriptor } from '@qualy/i18n-contract'
import { assessmentMessages as m } from '../../i18n.ts'
import { FILE_KINDS, kindsOf } from '../../file-kinds.ts'
import { linkOf, type Contract, type Draft, type EditorArea, type EditorProblem, type FieldDraft, type FieldType } from './model.ts'

// The words the editor uses for types, bounds and what is left to do.
//
// Every list in the editor says what a thing takes in the same two-part
// sentence, kind then bounds, so a parameter, a determination and a form
// field read alike wherever they meet.

export type Format = (message: MessageDescriptor, values?: Record<string, unknown>) => string
/** kept for callers that still pass one; the words themselves join with the product's separator */
export type ListJoin = (items: readonly string[]) => string

/** names side by side, with the separator the language uses for a list of names */
const named = (items: readonly string[], format: Format): string =>
  items.join(format(m.listSeparator))

/** whole sentences one after another: a space between them, unless the language writes none */
export const sentences = (parts: readonly string[], locale: string): string =>
  parts.filter((one) => one !== '').join(locale.startsWith('zh') ? '' : ' ')

export const TYPE_LABEL: Record<FieldType, MessageDescriptor> = {
  text: m.itemsTypeText,
  date: m.itemsTypeDate,
  integer: m.itemsTypeInteger,
  decimal: m.itemsKindNumber,
  choice: m.itemsTypeChoice,
  boolean: m.itemsTypeBoolean,
  attachment: m.itemsTypeAttachment,
}

export const KIND_LABEL: Record<AtomicKind, MessageDescriptor> = {
  text: m.itemsTypeText,
  date: m.itemsTypeDate,
  integer: m.itemsTypeInteger,
  decimal: m.itemsKindNumber,
  choice: m.itemsTypeChoice,
  boolean: m.itemsTypeBoolean,
}

export const AREA_LABEL: Record<EditorArea, MessageDescriptor> = {
  basics: m.itemsTabBasics,
  scoring: m.itemsTabForm,
  rules: m.itemsTabRules,
}

const PROBLEM_LABEL: Record<string, MessageDescriptor> = {
  'title-required': m.itemsProblemTitle,
  'group-required': m.itemsProblemGroup,
  'channels-required': m.itemsProblemChannels,
  'field-unnamed': m.itemsProblemFieldUnnamed,
  'field-options': m.itemsProblemFieldOptions,
  'field-invalid': m.itemsProblemFieldInvalid,
  'field-date-window': m.itemsProblemFieldDateWindow,
  'fixed-value-required': m.itemsProblemFixedValue,
  'calculator-unset': m.itemsProblemCalculatorUnset,
  'contract-pending': m.itemsProblemContractPending,
  'contract-refused': m.itemsProblemContractRefused,
  'parameter-unset': m.itemsProblemParameterUnset,
  'constant-required': m.itemsProblemConstantRequired,
  'recognition-in-automatic': m.itemsProblemRecognitionAutomatic,
  'recognition-unnamed': m.itemsProblemRecognitionUnnamed,
  'refinement-widens': m.itemsProblemRefinementWidens,
  'link-field-missing': m.itemsProblemLinkMissing,
  'recognition-unlinked': m.itemsProblemUnlinked,
  'binding-orphan': m.itemsProblemBindingOrphan,
  'stages-required': m.itemsProblemStagesRequired,
  'stage-unset': m.itemsProblemStageUnset,
  'max-entries-invalid': m.itemsProblemMaxEntries,
  'top-n-invalid': m.itemsProblemTopN,
}

/** the reason a thing is unfinished, in the reader's words */
export const problemWords = (problem: EditorProblem, format: Format): string =>
  format(PROBLEM_LABEL[problem.code] ?? m.itemsProblemFieldInvalid)

/** the bounds a schema admits, without the kind: "1 to 8", "up to 50 characters" */
export const boundsWords = (
  schema: AtomicSchema,
  locale: string,
  format: Format,
  listJoin: ListJoin,
): string => {
  const kind = kindOf(schema)
  switch (kind) {
    case 'integer': {
      const { minimum, maximum } = schema as { minimum: number; maximum: number }
      const low = minimum > Number.MIN_SAFE_INTEGER
      const high = maximum < Number.MAX_SAFE_INTEGER
      if (low && high) return format(m.itemsRangeBetween, { min: minimum, max: maximum })
      if (low) return format(m.itemsRangeMin, { min: minimum })
      if (high) return format(m.itemsRangeMax, { max: maximum })
      return format(m.itemsAnyValue)
    }
    case 'decimal': {
      const held = schema as {
        [MAX_SCALE]: number
        [DECIMAL_MINIMUM]?: string
        [DECIMAL_MAXIMUM]?: string
      }
      const min = held[DECIMAL_MINIMUM]
      const max = held[DECIMAL_MAXIMUM]
      const range =
        min !== undefined && max !== undefined
          ? format(m.itemsRangeBetween, { min, max })
          : min !== undefined
            ? format(m.itemsRangeMin, { min })
            : max !== undefined
              ? format(m.itemsRangeMax, { max })
              : ''
      const scale = held[MAX_SCALE]
      return range === ''
        ? format(m.itemsScaleNote, { scale })
        : format(m.itemsRangeWithScale, { range, scale })
    }
    case 'text': {
      const held = schema as { minLength?: number; maxLength?: number }
      if (held.minLength !== undefined && held.minLength > 0 && held.maxLength !== undefined) {
        return format(m.itemsLengthBetween, { min: held.minLength, max: held.maxLength })
      }
      if (held.maxLength !== undefined) return format(m.itemsLimitMaxLength, { count: held.maxLength })
      if (held.minLength !== undefined && held.minLength > 0) {
        return format(m.itemsLengthMin, { min: held.minLength })
      }
      return format(m.itemsAnyValue)
    }
    case 'choice': {
      const choice = schema as ChoiceSchema
      return named(choice.enum.map((value) => choiceLabel(choice, value, locale)), format)
    }
    // a yes or no has no bounds to speak of: the kind is the whole sentence
    case 'boolean':
      return ''
    case 'date':
      return format(m.itemsAnyValue)
  }
}

/** a form field's own bounds, as the pen holds them: the same sentence for a field nobody linked */
export const fieldBoundsWords = (
  field: FieldDraft,
  format: Format,
  listJoin: ListJoin,
): string => {
  switch (field.type) {
    case 'text': {
      const min = Number(field.minLength) || 0
      const max = field.maxLength.trim() === '' ? undefined : Number(field.maxLength)
      if (min > 0 && max !== undefined) return format(m.itemsLengthBetween, { min, max })
      if (max !== undefined) return format(m.itemsLimitMaxLength, { count: max })
      if (min > 0) return format(m.itemsLengthMin, { min })
      return format(m.itemsAnyValue)
    }
    case 'integer':
    case 'decimal': {
      const min = field.min.trim()
      const max = field.max.trim()
      const range =
        min !== '' && max !== ''
          ? format(m.itemsRangeBetween, { min, max })
          : min !== ''
            ? format(m.itemsRangeMin, { min })
            : max !== ''
              ? format(m.itemsRangeMax, { max })
              : ''
      if (field.type === 'integer') return range === '' ? format(m.itemsAnyValue) : range
      const scale = Number(field.maxScale) >= 0 ? Number(field.maxScale) : 2
      return range === ''
        ? format(m.itemsScaleNote, { scale })
        : format(m.itemsRangeWithScale, { range, scale })
    }
    case 'choice':
      return named(
        field.options.filter((one) => one.enabled).map((one) => one.label.trim() || one.value),
        format,
      )
    case 'boolean':
      return ''
    case 'date': {
      const min = field.min.trim()
      const max = field.max.trim()
      if (min !== '' && max !== '') return format(m.itemsLimitDates, { from: min, until: max })
      return format(m.itemsAnyValue)
    }
    case 'attachment': {
      const count = Number(field.maxCount) > 0 ? Number(field.maxCount) : 1
      const kinds = kindsOf(
        field.accept
          .split(',')
          .map((token) => token.trim())
          .filter((token) => token !== ''),
      )
        .picked.map((id) => FILE_KINDS.find((kind) => kind.id === id))
        .filter((kind) => kind !== undefined)
        .map((kind) => format(kind.name))
      return kinds.length === 0
        ? format(m.itemsLimitFiles, { count })
        : format(m.itemsFilesWithKinds, { count, kinds: named(kinds, format) })
    }
  }
}

/** the type a parameter or a determination takes, kind first */
export const kindWords = (schema: AtomicSchema, format: Format): string =>
  format(KIND_LABEL[kindOf(schema)])

export type LinkVerdict =
  | { kind: 'fits' }
  | { kind: 'differs' }
  | { kind: 'kind-mismatch' }
  | { kind: 'taken' }

/** whether an existing field could stand in for this determination */
export const linkVerdictOf = (
  draft: Draft,
  contract: Contract | null,
  admitted: AtomicSchema,
  field: FieldDraft,
  format: Format,
  listJoin: ListJoin,
  locale: string,
): LinkVerdict => {
  if (linkOf(draft, contract, field.id) !== undefined) return { kind: 'taken' }
  if (field.type === 'attachment' || field.type !== kindOf(admitted)) return { kind: 'kind-mismatch' }
  // agreement is read off the same sentence the two lists print: two
  // fields that read alike to a person are alike to the arithmetic, since
  // the sentence names every bound the value layer compares
  const same =
    field.type === 'choice'
      ? false
      : fieldBoundsWords(field, format, listJoin) === boundsWords(admitted, locale, format, listJoin)
  return same ? { kind: 'fits' } : { kind: 'differs' }
}
