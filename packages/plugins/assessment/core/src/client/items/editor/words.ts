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
import type { Message } from '@qualy/i18n-contract'

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
import * as m from '#messages'

// The words the editor uses for types, bounds and what is left to do.
//
// Every list in the editor says what a thing takes in the same two-part
// sentence, kind then bounds, so a parameter, a determination and a form
// field read alike wherever they meet.

export type Format = (message: Message, values?: Record<string, unknown>) => string
/** kept for callers that still pass one; the words themselves join with the product's separator */
export type ListJoin = (items: readonly string[]) => string

/** names side by side, with the separator the language uses for a list of names */
const named = (items: readonly string[]): string => items.join(m.items_listSeparator())

/** whole sentences one after another: a space between them, unless the language writes none */
export const sentences = (parts: readonly string[], locale: string): string =>
  parts.filter((one) => one !== '').join(locale.startsWith('zh') ? '' : ' ')

export const TYPE_LABEL: Record<FieldType, Message> = {
  text: m.items_typeText,
  date: m.items_typeDate,
  integer: m.items_typeInteger,
  decimal: m.items_kindNumber,
  choice: m.items_typeChoice,
  boolean: m.items_typeBoolean,
  attachment: m.items_typeAttachment,
}

export const KIND_LABEL: Record<AtomicKind, Message> = {
  text: m.items_typeText,
  date: m.items_typeDate,
  integer: m.items_typeInteger,
  decimal: m.items_kindNumber,
  choice: m.items_typeChoice,
  boolean: m.items_typeBoolean,
}

export const AREA_LABEL: Record<EditorArea, Message> = {
  basics: m.items_tabBasics,
  scoring: m.items_tabForm,
  rules: m.items_tabRules,
}

const PROBLEM_LABEL: Record<string, Message> = {
  'title-required': m.items_problemTitle,
  'group-required': m.items_problemGroup,
  'group-gone': m.items_problemGroupGone,
  'channels-required': m.items_problemChannels,
  'channels-frozen': m.items_problemChannelsFrozen,
  'mode-frozen': m.items_problemModeFrozen,
  'mode-unavailable': m.items_problemModeUnavailable,
  'field-unnamed': m.items_problemFieldUnnamed,
  'field-options': m.items_problemFieldOptions,
  'field-option-unnamed': m.items_problemFieldOptionUnnamed,
  'field-option-duplicate': m.items_problemFieldOptionDuplicate,
  'field-range-inverted': m.items_problemFieldRangeInverted,
  'field-duplicate': m.items_problemFieldDuplicate,
  'field-retyped': m.items_problemFieldRetyped,
  'field-invalid': m.items_problemFieldInvalid,
  'field-date-window': m.items_problemFieldDateWindow,
  'form-refused': m.items_problemFormRefused,
  'summary-invalid': m.items_problemSummaryInvalid,
  'fixed-value-required': m.items_problemFixedValue,
  'fixed-value-invalid': m.items_problemFixedValueInvalid,
  'calculator-unset': m.items_problemCalculatorUnset,
  'calculator-gone': m.items_problemCalculatorGone,
  'calculator-output': m.items_problemCalculatorOutput,
  'calculator-refused': m.items_problemCalculatorRefused,
  'contract-pending': m.items_problemContractPending,
  'contract-refused': m.items_problemContractRefused,
  'parameter-unset': m.items_problemParameterUnset,
  'parameter-refused': m.items_problemParameterRefused,
  'constant-required': m.items_problemConstantRequired,
  'constant-out-of-range': m.items_problemConstantRange,
  'constant-below-min': m.items_problemConstantBelow,
  'constant-above-max': m.items_problemConstantAbove,
  'constant-scale': m.items_problemConstantScale,
  'constant-not-integer': m.items_problemConstantNotInteger,
  'constant-not-number': m.items_problemConstantNotNumber,
  'constant-not-date': m.items_problemConstantNotDate,
  'constant-too-short': m.items_problemConstantTooShort,
  'constant-too-long': m.items_problemConstantTooLong,
  'constant-not-offered': m.items_problemConstantNotOffered,
  'constant-pattern': m.items_problemConstantPattern,
  'constant-invalid': m.items_problemConstantInvalid,
  'recognition-in-automatic': m.items_problemRecognitionAutomatic,
  'recognition-unnamed': m.items_problemRecognitionUnnamed,
  'recognition-reused': m.items_problemRecognitionReused,
  'recognition-unattainable': m.items_problemRecognitionUnattainable,
  'recognition-unbound': m.items_problemRecognitionUnbound,
  'recognition-refused': m.items_problemRecognitionRefused,
  'recognition-strands-value': m.items_problemStrandsValue,
  'recognition-strands': m.items_problemStrands,
  'recognition-strands-missing': m.items_problemStrandsMissing,
  'recognition-strands-round': m.items_problemStrandsRound,
  'recognition-strands-round-new': m.items_problemStrandsRoundNew,
  'recognition-strands-removed': m.items_problemStrandsRemoved,
  'recognitions-refused': m.items_problemRecognitionsRefused,
  'parameters-refused': m.items_problemParametersRefused,
  'refinement-widens': m.items_problemRefinementWidens,
  'refinement-empty': m.items_problemRefinementEmpty,
  'link-field-missing': m.items_problemLinkMissing,
  'link-not-guaranteed': m.items_problemLinkNotGuaranteed,
  'link-mismatch': m.items_problemLinkMismatch,
  'recognition-unlinked': m.items_problemUnlinked,
  'binding-orphan': m.items_problemBindingOrphan,
  'stages-required': m.items_problemStagesRequired,
  'escalation-required': m.items_problemEscalationRequired,
  'stage-unnamed': m.items_problemStageUnnamed,
  'stage-unset': m.items_problemStageUnset,
  'stage-quorum': m.items_problemStageQuorum,
  'stage-panel-last': m.items_problemStagePanelLast,
  'stages-too-many': m.items_problemStagesTooMany,
  'stage-refused': m.items_problemStageRefused,
  'policy-refused': m.items_problemPolicyRefused,
  'folding-refused': m.items_problemFoldingRefused,
  'max-entries-invalid': m.items_problemMaxEntries,
  'top-n-invalid': m.items_problemTopN,
}

/**
 * The reason a thing is unfinished or wrong, in the reader's words.
 *
 * A code nobody wrote a sentence for is still said as something: the block
 * it belongs to refusing what was set, which is true and tells the reader
 * where to look - never a sentence that could be about anything.
 */
export const problemWords = (problem: EditorProblem): string =>
  ((PROBLEM_LABEL[problem.code] ?? m.items_problemFieldInvalid) as Message)(problem.values ?? {})

/** where in a tab a problem is, as the heading that block is drawn under */
export const BLOCK_LABEL: Record<EditorBlock, Message> = {
  basics: m.items_tabBasics,
  mode: m.items_mode,
  channels: m.items_channels,
  method: m.items_scoringMethod,
  parameters: m.items_parameters,
  recognitions: m.items_recognitions,
  form: m.items_form,
  summary: m.items_summaryBlock,
  counts: m.items_rulesCounts,
  review: m.items_reviewChain,
  escalation: m.items_escalationTitle,
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

export const takesOf = (schema: AtomicSchema, locale: string): TakesParts => {
  const kind = kindOf(schema)
  switch (kind) {
    case 'integer': {
      const { minimum, maximum } = schema as { minimum: number; maximum: number }
      const low = minimum > Number.MIN_SAFE_INTEGER
      const high = maximum < Number.MAX_SAFE_INTEGER
      if (low && high) return { range: m.items_rangeBetween({ min: minimum, max: maximum }) }
      if (low) return { range: m.items_rangeMin({ min: minimum }) }
      if (high) return { range: m.items_rangeMax({ max: maximum }) }
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
          ? m.items_rangeBetween({ min, max })
          : min !== undefined
            ? m.items_rangeMin({ min })
            : max !== undefined
              ? m.items_rangeMax({ max })
              : undefined
      return {
        ...(range === undefined ? {} : { range }),
        note: m.items_scaleNote({ scale: held[MAX_SCALE] }),
      }
    }
    case 'text': {
      const words = boundsWords(schema, locale, () => '')
      return words === m.items_anyValue() ? {} : { note: words }
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
export const fieldTakesOf = (field: FieldDraft): TakesParts => {
  switch (field.type) {
    case 'integer':
    case 'decimal': {
      const min = field.min.trim()
      const max = field.max.trim()
      const range =
        min !== '' && max !== ''
          ? m.items_rangeBetween({ min, max })
          : min !== ''
            ? m.items_rangeMin({ min })
            : max !== ''
              ? m.items_rangeMax({ max })
              : undefined
      const scale = Number(field.maxScale) >= 0 ? Number(field.maxScale) : 2
      return {
        ...(range === undefined ? {} : { range }),
        ...(field.type === 'decimal' ? { note: m.items_scaleNote({ scale }) } : {}),
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
      const words = fieldBoundsWords(field, () => '')
      return words === m.items_anyValue() ? {} : { note: words }
    }
  }
}

/** the bounds a schema admits, without the kind: "1 to 8", "up to 50 characters" */
export const boundsWords = (schema: AtomicSchema, locale: string, _listJoin: ListJoin): string => {
  const kind = kindOf(schema)
  switch (kind) {
    case 'integer': {
      const { minimum, maximum } = schema as { minimum: number; maximum: number }
      const low = minimum > Number.MIN_SAFE_INTEGER
      const high = maximum < Number.MAX_SAFE_INTEGER
      if (low && high) return m.items_rangeBetween({ min: minimum, max: maximum })
      if (low) return m.items_rangeMin({ min: minimum })
      if (high) return m.items_rangeMax({ max: maximum })
      return m.items_anyValue()
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
          ? m.items_rangeBetween({ min, max })
          : min !== undefined
            ? m.items_rangeMin({ min })
            : max !== undefined
              ? m.items_rangeMax({ max })
              : ''
      const scale = held[MAX_SCALE]
      return range === '' ? m.items_scaleNote({ scale }) : m.items_rangeWithScale({ range, scale })
    }
    case 'text': {
      const held = schema as { minLength?: number; maxLength?: number }
      if (held.minLength !== undefined && held.minLength > 0 && held.maxLength !== undefined) {
        return m.items_lengthBetween({ min: held.minLength, max: held.maxLength })
      }
      if (held.maxLength !== undefined) return m.items_limitMaxLength({ count: held.maxLength })
      if (held.minLength !== undefined && held.minLength > 0) {
        return m.items_lengthMin({ min: held.minLength })
      }
      return m.items_anyValue()
    }
    case 'choice': {
      const choice = schema as ChoiceSchema
      return named(choice.enum.map((value) => choiceLabel(choice, value, locale)))
    }
    // a yes or no has no bounds to speak of: the kind is the whole sentence
    case 'boolean':
      return ''
    case 'date':
      return m.items_anyValue()
  }
}

/** a form field's own bounds, as the pen holds them: the same sentence for a field nobody linked */
export const fieldBoundsWords = (field: FieldDraft, _listJoin: ListJoin): string => {
  switch (field.type) {
    case 'text': {
      const min = Number(field.minLength) || 0
      const max = field.maxLength.trim() === '' ? undefined : Number(field.maxLength)
      if (min > 0 && max !== undefined) return m.items_lengthBetween({ min, max })
      if (max !== undefined) return m.items_limitMaxLength({ count: max })
      if (min > 0) return m.items_lengthMin({ min })
      return m.items_anyValue()
    }
    case 'integer':
    case 'decimal': {
      const min = field.min.trim()
      const max = field.max.trim()
      const range =
        min !== '' && max !== ''
          ? m.items_rangeBetween({ min, max })
          : min !== ''
            ? m.items_rangeMin({ min })
            : max !== ''
              ? m.items_rangeMax({ max })
              : ''
      if (field.type === 'integer') return range === '' ? m.items_anyValue() : range
      const scale = Number(field.maxScale) >= 0 ? Number(field.maxScale) : 2
      return range === '' ? m.items_scaleNote({ scale }) : m.items_rangeWithScale({ range, scale })
    }
    case 'choice':
      return named(
        field.options.filter((one) => one.enabled).map((one) => one.label.trim() || one.value),
      )
    case 'boolean':
      return ''
    case 'date': {
      const min = field.min.trim()
      const max = field.max.trim()
      if (min !== '' && max !== '') return m.items_limitDates({ from: min, until: max })
      return m.items_anyValue()
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
        .map((kind) => kind.name())
      return kinds.length === 0
        ? m.items_limitFiles({ count })
        : m.items_filesWithKinds({ count, kinds: named(kinds) })
    }
  }
}

/** the type a parameter or a determination takes, kind first */
export const kindWords = (schema: AtomicSchema): string => KIND_LABEL[kindOf(schema)]()

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
      : fieldBoundsWords(field, listJoin) === boundsWords(admitted, locale, listJoin)
  return same ? { kind: 'fits' } : { kind: 'differs' }
}
