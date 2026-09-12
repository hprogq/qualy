import {
  assignmentPlan,
  constraintOf,
  inputOrder,
  kindOf,
  normalizeAtomicSchema,
  type AtomicKind,
  type AtomicSchema,
  type NormalizedAtomicSchema,
  type NormalizedInputSchema,
} from '@qualy/value-schema'
import type { BindingDraft, RecognitionDraft } from './ItemConfigEditor.tsx'

// Why a binding will be refused, said before the server says it.
//
// A projection only: every verdict here is the shared value layer's own
// `assignmentPlan`, read the way the server's plan compiler reads it - a
// fact's narrowing must flow into its parameter unchanged, a form field
// may seed a fact by any lawful assignment - and the words on screen are
// what that proof already carries. Nothing is decided here that the save
// would not decide; this exists so the refusal names the parameter, the
// source, the two shapes and the rule, instead of arriving as a code.
//
// The order is fixed: parameters as the contract lists them, a fact's own
// narrowing before what seeds it, and bindings the contract has no
// parameter for last, by name. Object insertion order never leaks through.

export type BindingSource =
  /** the fact's own narrowing, against the parameter it answers */
  | { readonly kind: 'recognition'; readonly label: string }
  /** the form field that seeds the fact, against what the fact admits */
  | { readonly kind: 'default'; readonly fieldId: string }
  /** a fixed value; only ever a binding the contract no longer names */
  | { readonly kind: 'constant' }

export type FacetRule = 'min' | 'max' | 'scale' | 'minLength' | 'maxLength' | 'pattern' | 'choices'

/** a schema as the rule in question sees it: its kind, and the bounds that rule reads */
export interface SchemaFacet {
  readonly kind: AtomicKind
  readonly constraints: readonly { readonly rule: FacetRule; readonly value: string }[]
}

export interface BindingDiagnostic {
  readonly parameter: string
  readonly source: BindingSource
  /** what the slot admits; null for a binding without a slot */
  readonly expected: SchemaFacet | null
  /** what the source produces; null when there is no source schema to show */
  readonly actual: SchemaFacet | null
  readonly reason: { readonly code: string; readonly detail?: unknown }
}

export interface BindingDiagnosticsInput {
  readonly inputSchema: NormalizedInputSchema
  readonly bindableFields: readonly { readonly fieldId: string; readonly schema: unknown }[]
  readonly recognitions: Readonly<Record<string, RecognitionDraft>>
  readonly bindings: Readonly<Record<string, BindingDraft>>
}

const own = <T>(record: Readonly<Record<string, T>>, key: string): T | undefined =>
  Object.hasOwn(record, key) ? record[key] : undefined

const bound = (
  schema: AtomicSchema,
  rule: FacetRule,
  keyword: string,
): { rule: FacetRule; value: string } | undefined => {
  const value = constraintOf(schema, keyword)
  return value === undefined ? undefined : { rule, value }
}

const range = (schema: AtomicSchema) =>
  kindOf(schema) === 'integer'
    ? [bound(schema, 'min', 'minimum'), bound(schema, 'max', 'maximum')]
    : [bound(schema, 'min', 'x-qualy-minimum'), bound(schema, 'max', 'x-qualy-maximum')]

/** the bounds the refused rule read, and nothing the rule never looked at */
export const facetOf = (schema: AtomicSchema, code: string, detail?: unknown): SchemaFacet => {
  const picked = (() => {
    switch (code) {
      case 'text-length-widens': {
        const side = (detail as { side?: string } | undefined)?.side
        return side === 'minLength'
          ? [bound(schema, 'minLength', 'minLength')]
          : [bound(schema, 'maxLength', 'maxLength')]
      }
      case 'pattern-unprovable':
        return [bound(schema, 'pattern', 'pattern')]
      case 'integer-range-widens':
      case 'decimal-range-widens':
      case 'converter-domain-exceeds':
        return range(schema)
      case 'decimal-scale-widens':
        return [bound(schema, 'scale', 'x-qualy-maxScale')]
      case 'choice-widens':
        // the whole set on either side: what a source admits is the fact
        // about it, the surplus is the reason's own detail
        return [bound(schema, 'choices', 'enum')]
      default:
        return []
    }
  })()
  return {
    kind: kindOf(schema),
    constraints: picked.filter(
      (one): one is { rule: FacetRule; value: string } => one !== undefined,
    ),
  }
}

const normalized = (schema: unknown): NormalizedAtomicSchema | null => {
  try {
    return normalizeAtomicSchema(schema as AtomicSchema)
  } catch {
    return null
  }
}

export const bindingDiagnostics = (
  input: BindingDiagnosticsInput,
): readonly BindingDiagnostic[] => {
  const found: BindingDiagnostic[] = []
  for (const parameter of inputOrder(input.inputSchema)) {
    const schema = own(input.inputSchema.properties, parameter) as AtomicSchema | undefined
    if (schema === undefined) continue
    const binding = own(input.bindings, parameter)
    if (binding === undefined || binding.kind !== 'recognition') continue
    const recognition = own(input.recognitions, binding.handle)
    if (recognition === undefined) continue
    const target = normalizeAtomicSchema(schema)
    // what the fact admits: its narrowing when it has one, else the parameter
    let admitted: NormalizedAtomicSchema = target
    if (recognition.refinement !== null && recognition.refinement !== undefined) {
      const source = { kind: 'recognition', label: recognition.label } as const
      const refined = normalized(recognition.refinement)
      if (refined === null) {
        found.push({
          parameter,
          source,
          expected: facetOf(schema, 'refinement-not-in-profile'),
          actual: null,
          reason: { code: 'refinement-not-in-profile' },
        })
      } else {
        // a narrowing flows into its parameter unchanged, or it is no narrowing
        const proof = assignmentPlan(refined, target)
        if (proof.kind === 'incompatible') {
          found.push({
            parameter,
            source,
            expected: facetOf(schema, proof.code, proof.detail),
            actual: facetOf(refined, proof.code, proof.detail),
            reason: {
              code: proof.code,
              ...(proof.detail === undefined ? {} : { detail: proof.detail }),
            },
          })
        } else if (proof.kind === 'convert') {
          found.push({
            parameter,
            source,
            expected: facetOf(schema, 'requires-conversion'),
            actual: facetOf(refined, 'requires-conversion'),
            reason: { code: 'requires-conversion', detail: { converter: proof.converter } },
          })
        }
        admitted = refined
      }
    }
    const fieldId = recognition.defaultFromFieldId
    if (fieldId === null) continue
    const source = { kind: 'default', fieldId } as const
    const field = input.bindableFields.find((one) => one.fieldId === fieldId)
    if (field === undefined) {
      found.push({
        parameter,
        source,
        expected: facetOf(admitted, 'default-field-unknown'),
        actual: null,
        reason: { code: 'default-field-unknown' },
      })
      continue
    }
    // a seeding may convert; only an impossible one is refused, as the server refuses it
    const seeding = assignmentPlan(normalizeAtomicSchema(field.schema as AtomicSchema), admitted)
    if (seeding.kind === 'incompatible') {
      found.push({
        parameter,
        source,
        expected: facetOf(admitted, seeding.code, seeding.detail),
        actual: facetOf(field.schema as AtomicSchema, seeding.code, seeding.detail),
        reason: {
          code: seeding.code,
          ...(seeding.detail === undefined ? {} : { detail: seeding.detail }),
        },
      })
    }
  }
  for (const parameter of Object.keys(input.bindings).sort()) {
    if (Object.hasOwn(input.inputSchema.properties, parameter)) continue
    const binding = input.bindings[parameter]!
    found.push({
      parameter,
      source:
        binding.kind === 'recognition'
          ? { kind: 'recognition', label: own(input.recognitions, binding.handle)?.label ?? '' }
          : { kind: 'constant' },
      expected: null,
      actual: null,
      reason: { code: 'binding-unknown-parameter' },
    })
  }
  return found
}
