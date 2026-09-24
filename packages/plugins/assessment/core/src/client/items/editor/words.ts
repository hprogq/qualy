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
import {
  linkOf,
  type Contract,
  type Draft,
  type EditorArea,
  type EditorBlock,
  type EditorProblem,
  type FieldDraft,
  type FieldType,
} from './model.ts'

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
  'group-gone': m.itemsProblemGroupGone,
  'channels-required': m.itemsProblemChannels,
  'channels-frozen': m.itemsProblemChannelsFrozen,
  'mode-frozen': m.itemsProblemModeFrozen,
  'mode-unavailable': m.itemsProblemModeUnavailable,
  'field-unnamed': m.itemsProblemFieldUnnamed,
  'field-options': m.itemsProblemFieldOptions,
  'field-option-unnamed': m.itemsProblemFieldOptionUnnamed,
  'field-option-duplicate': m.itemsProblemFieldOptionDuplicate,
  'field-range-inverted': m.itemsProblemFieldRangeInverted,
  'field-duplicate': m.itemsProblemFieldDuplicate,
  'field-retyped': m.itemsProblemFieldRetyped,
  'field-invalid': m.itemsProblemFieldInvalid,
  'field-date-window': m.itemsProblemFieldDateWindow,
  'form-refused': m.itemsProblemFormRefused,
  'summary-invalid': m.itemsProblemSummaryInvalid,
  'fixed-value-required': m.itemsProblemFixedValue,
  'fixed-value-invalid': m.itemsProblemFixedValueInvalid,
  'calculator-unset': m.itemsProblemCalculatorUnset,
  'calculator-gone': m.itemsProblemCalculatorGone,
  'calculator-output': m.itemsProblemCalculatorOutput,
  'calculator-refused': m.itemsProblemCalculatorRefused,
  'contract-pending': m.itemsProblemContractPending,
  'contract-refused': m.itemsProblemContractRefused,
  'parameter-unset': m.itemsProblemParameterUnset,
  'parameter-refused': m.itemsProblemParameterRefused,
  'constant-required': m.itemsProblemConstantRequired,
  'constant-out-of-range': m.itemsProblemConstantRange,
  'constant-below-min': m.itemsProblemConstantBelow,
  'constant-above-max': m.itemsProblemConstantAbove,
  'constant-scale': m.itemsProblemConstantScale,
  'constant-not-integer': m.itemsProblemConstantNotInteger,
  'constant-not-number': m.itemsProblemConstantNotNumber,
  'constant-not-date': m.itemsProblemConstantNotDate,
  'constant-too-short': m.itemsProblemConstantTooShort,
  'constant-too-long': m.itemsProblemConstantTooLong,
  'constant-not-offered': m.itemsProblemConstantNotOffered,
  'constant-pattern': m.itemsProblemConstantPattern,
  'constant-invalid': m.itemsProblemConstantInvalid,
  'recognition-in-automatic': m.itemsProblemRecognitionAutomatic,
  'recognition-unnamed': m.itemsProblemRecognitionUnnamed,
  'recognition-reused': m.itemsProblemRecognitionReused,
  'recognition-unattainable': m.itemsProblemRecognitionUnattainable,
  'recognition-unbound': m.itemsProblemRecognitionUnbound,
  'recognition-refused': m.itemsProblemRecognitionRefused,
  'recognition-strands-value': m.itemsProblemStrandsValue,
  'recognition-strands': m.itemsProblemStrands,
  'recognition-strands-missing': m.itemsProblemStrandsMissing,
  'recognition-strands-round': m.itemsProblemStrandsRound,
  'recognition-strands-round-new': m.itemsProblemStrandsRoundNew,
  'recognition-strands-removed': m.itemsProblemStrandsRemoved,
  'recognitions-refused': m.itemsProblemRecognitionsRefused,
  'parameters-refused': m.itemsProblemParametersRefused,
  'refinement-widens': m.itemsProblemRefinementWidens,
  'refinement-empty': m.itemsProblemRefinementEmpty,
  'link-field-missing': m.itemsProblemLinkMissing,
  'link-not-guaranteed': m.itemsProblemLinkNotGuaranteed,
  'link-mismatch': m.itemsProblemLinkMismatch,
  'recognition-unlinked': m.itemsProblemUnlinked,
  'binding-orphan': m.itemsProblemBindingOrphan,
  'stages-required': m.itemsProblemStagesRequired,
  'stage-unnamed': m.itemsProblemStageUnnamed,
  'stage-unset': m.itemsProblemStageUnset,
  'stage-quorum': m.itemsProblemStageQuorum,
  'stage-refused': m.itemsProblemStageRefused,
  'policy-refused': m.itemsProblemPolicyRefused,
  'folding-refused': m.itemsProblemFoldingRefused,
  'max-entries-invalid': m.itemsProblemMaxEntries,
  'top-n-invalid': m.itemsProblemTopN,
}

/**
 * The reason a thing is unfinished or wrong, in the reader's words.
 *
 * A code nobody wrote a sentence for is still said as something: the block
 * it belongs to refusing what was set, which is true and tells the reader
 * where to look - never a sentence that could be about anything.
 */
export const problemWords = (problem: EditorProblem, format: Format): string =>
  format(PROBLEM_LABEL[problem.code] ?? m.itemsProblemFieldInvalid, problem.values ?? {})

/** where in a tab a problem is, as the heading that block is drawn under */
export const BLOCK_LABEL: Record<EditorBlock, MessageDescriptor> = {
  basics: m.itemsTabBasics,
  mode: m.itemsMode,
  channels: m.itemsChannels,
  method: m.itemsScoringMethod,
  parameters: m.itemsParameters,
  recognitions: m.itemsRecognitions,
  form: m.itemsForm,
  summary: m.itemsSummaryBlock,
  counts: m.itemsRulesCounts,
  review: m.itemsReviewChain,
  escalation: m.itemsEscalationTitle,
}

/**
 * What a value takes, in the three parts a row draws apart: a range of
 * numbers in the fixed-width face, a quieter note beside it, or a list of
 * names that may run long and is cut rather than wrapped.
 */
export interface TakesParts {
  readonly range?: string
  readonly note?: string
  readonly names?: readonly string[]
}

export const takesOf = (schema: AtomicSchema, locale: string, format: Format): TakesParts => {
  const kind = kindOf(schema)
  switch (kind) {
    case 'integer': {
      const { minimum, maximum } = schema as { minimum: number; maximum: number }
      const low = minimum > Number.MIN_SAFE_INTEGER
      const high = maximum < Number.MAX_SAFE_INTEGER
      if (low && high) return { range: format(m.itemsRangeBetween, { min: minimum, max: maximum }) }
      if (low) return { range: format(m.itemsRangeMin, { min: minimum }) }
      if (high) return { range: format(m.itemsRangeMax, { max: maximum }) }
      return {}
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
              : undefined
      return {
        ...(range === undefined ? {} : { range }),
        note: format(m.itemsScaleNote, { scale: held[MAX_SCALE] }),
      }
    }
    case 'text': {
      const words = boundsWords(schema, locale, format, () => '')
      return words === format(m.itemsAnyValue) ? {} : { note: words }
    }
    case 'choice': {
      const choice = schema as ChoiceSchema
      return { names: choice.enum.map((value) => choiceLabel(choice, value, locale)) }
    }
    case 'boolean':
    case 'date':
      return {}
  }
}

/** the same three parts for a form field nobody linked, read off the pen */
export const fieldTakesOf = (field: FieldDraft, format: Format): TakesParts => {
  switch (field.type) {
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
              : undefined
      const scale = Number(field.maxScale) >= 0 ? Number(field.maxScale) : 2
      return {
        ...(range === undefined ? {} : { range }),
        ...(field.type === 'decimal' ? { note: format(m.itemsScaleNote, { scale }) } : {}),
      }
    }
    case 'choice':
      return {
        names: field.options
          .filter((one) => one.enabled)
          .map((one) => one.label.trim() || one.value),
      }
    case 'boolean':
      return {}
    default: {
      const words = fieldBoundsWords(field, format, () => '')
      return words === format(m.itemsAnyValue) ? {} : { note: words }
    }
  }
}

/** the bounds a schema admits, without the kind: "1 to 8", "up to 50 characters" */
export const boundsWords = (
  schema: AtomicSchema,
  locale: string,
  format: Format,
  _listJoin: ListJoin,
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
      if (held.maxLength !== undefined)
        return format(m.itemsLimitMaxLength, { count: held.maxLength })
      if (held.minLength !== undefined && held.minLength > 0) {
        return format(m.itemsLengthMin, { min: held.minLength })
      }
      return format(m.itemsAnyValue)
    }
    case 'choice': {
      const choice = schema as ChoiceSchema
      return named(
        choice.enum.map((value) => choiceLabel(choice, value, locale)),
        format,
      )
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
  _listJoin: ListJoin,
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
  if (field.type === 'attachment' || field.type !== kindOf(admitted))
    return { kind: 'kind-mismatch' }
  // agreement is read off the same sentence the two lists print: two
  // fields that read alike to a person are alike to the arithmetic, since
  // the sentence names every bound the value layer compares
  const same =
    field.type === 'choice'
      ? false
      : fieldBoundsWords(field, format, listJoin) ===
        boundsWords(admitted, locale, format, listJoin)
  return same ? { kind: 'fits' } : { kind: 'differs' }
}
