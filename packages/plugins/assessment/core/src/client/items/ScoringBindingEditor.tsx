import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { ChevronRightIcon } from 'lucide-react'
import {
  assignmentPlan,
  choiceLabel,
  displayDescription,
  displayTitle,
  inputOrder,
  kindOf,
  normalizeAtomicSchema,
} from '@qualy/value-schema'
import type { AtomicKind, AtomicSchema, ChoiceSchema, NormalizedInputSchema } from '@qualy/value-schema'
import { AtomicValueField } from '@qualy/web-value-form/InputValueForm'
import { usePickerWords } from '@qualy/web-i18n/picker-words'
import type { FieldDraft } from '@qualy/web-value-form/model'
import { useI18n } from '@qualy/web-i18n'
import { Field } from '@qualy/ui/admin'
import { Input } from '@qualy/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@qualy/ui/sheet'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentMessages as m } from '../i18n.ts'
import type { BindingDraft, RecognitionDraft } from './ItemConfigEditor.tsx'
import {
  bindingDiagnostics,
  type BindingDiagnostic,
  type SchemaFacet,
} from './binding-diagnostics.ts'

// Where a calculator's parameters meet what this question actually knows.
//
// The contract comes from the server's own compile, so the parameters here
// are the ones that will be frozen, named and typed exactly as they will be.
// Which form fields may seed a determined fact is a question of
// ASSIGNABILITY, answered by the shared value layer and never by guessing at
// type names.
//
// THE LIST IS A LIST. A formula may declare fifty parameters, and fifty
// bordered cards each holding three controls is not a configuration screen -
// it squeezed the question's own title into a column of single characters.
// So each parameter is one line saying what it takes and what feeds it, and
// the configuring happens in a sheet for the one line that was pressed.
//
// THREE SOURCES, ONE MODEL. A reader chooses between a fixed value, a fact
// somebody determines by hand, and a fact a filing field prefills. Those are
// the three shapes the stored model already has - `constant`, `recognition`
// with no default, `recognition` with one - so nothing new is written down.
// Naming them in the UI is what was missing; a fourth stored kind would have
// been one business fact with two spellings.
//
// A refinement narrows what a fact may be. This build has no control for
// one, and it is carried untouched rather than dropped: renaming a fact must
// not quietly widen what it admits. What the editor does say is why a
// binding will be refused - in the words of the same proof the save runs.

const styles = stylex.create({
  frame: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 10 },
  tally: { fontSize: 13, color: tokens.mutedForeground },
  sheetCard: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: tokens.radiusMd,
    boxShadow: `inset 0 0 0 1px ${tokens.border}`,
  },
  row: {
    display: 'grid',
    width: '100%',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.1fr) 1rem',
    alignItems: 'center',
    columnGap: 12,
    borderBottomWidth: { default: 1, ':last-child': 0 },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 55%, transparent)`,
    },
    paddingInline: 12,
    paddingBlock: 9,
    textAlign: 'start',
    fontSize: 13,
    cursor: 'pointer',
  },
  headRow: {
    backgroundColor: tokens.surfaceInset,
    cursor: 'default',
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  cell: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  name: { fontWeight: 500 },
  quiet: { color: tokens.mutedForeground },
  unset: { color: tokens.warningForeground },
  wrong: { color: tokens.danger },
  chevron: {
    width: 15,
    height: 15,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 60%, transparent)`,
  },
  sheet: { width: { default: 440, [`@media (max-width: 640px)`]: null } },
  body: {
    display: 'flex',
    minHeight: 0,
    flexGrow: 1,
    flexDirection: 'column',
    gap: 16,
    overflowY: 'auto',
    paddingInline: 24,
    paddingBottom: 20,
  },
  part: { display: 'flex', flexDirection: 'column', gap: 8 },
  partTitle: {
    margin: 0,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.06em',
    color: tokens.mutedForeground,
  },
  takes: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    borderRadius: tokens.radiusMd,
    backgroundColor: tokens.surfaceInset,
    paddingInline: 12,
    paddingBlock: 10,
    fontSize: 13,
  },
  takesWhat: { fontWeight: 500 },
  takesMore: { color: tokens.mutedForeground, overflowWrap: 'anywhere' },
  sources: { display: 'flex', flexDirection: 'column', gap: 6 },
  choice: {
    display: 'flex',
    width: '100%',
    alignItems: 'flex-start',
    gap: 10,
    borderRadius: tokens.radiusMd,
    backgroundColor: tokens.surface,
    boxShadow: {
      default: `inset 0 0 0 1px ${tokens.border}`,
      ':hover': `inset 0 0 0 1px ${tokens.mutedForeground}`,
    },
    paddingInline: 12,
    paddingBlock: 10,
    textAlign: 'start',
    cursor: { default: 'pointer', ':disabled': 'default' },
  },
  choiceOn: {
    backgroundColor: `color-mix(in oklab, ${tokens.primary} 5%, transparent)`,
    boxShadow: {
      default: `inset 0 0 0 2px ${tokens.primary}`,
      ':hover': `inset 0 0 0 2px ${tokens.primary}`,
    },
  },
  choiceOff: { opacity: 0.55, boxShadow: `inset 0 0 0 1px ${tokens.border}` },
  choiceWords: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 2 },
  choiceName: { fontSize: 13, fontWeight: 500 },
  choiceNote: { fontSize: 12, color: tokens.mutedForeground, textWrap: 'pretty' },
  diagnostic: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    borderRadius: tokens.radiusMd,
    backgroundColor: `color-mix(in oklab, ${tokens.danger} 7%, transparent)`,
    boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${tokens.danger} 28%, transparent)`,
    paddingInline: 12,
    paddingBlock: 10,
    fontSize: 12,
    lineHeight: 1.6,
    color: tokens.danger,
  },
  orphans: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    margin: 0,
    paddingLeft: 18,
    fontSize: 13,
    color: tokens.danger,
  },
})

/** which of the three shapes a reader is looking at */
type SourceKind = 'constant' | 'manual' | 'prefill'

export interface ScoringBindingEditorProps {
  readonly inputSchema: NormalizedInputSchema
  readonly bindableFields: readonly { fieldId: string; schema: unknown; always: boolean }[]
  readonly recognitions: Record<string, RecognitionDraft>
  readonly bindings: Record<string, BindingDraft>
  readonly disabled: boolean
  readonly locale: string
  /** the form's own names for its fields, by field identity */
  readonly fieldLabels?: Readonly<Record<string, string>>
  /**
   * Make a filing field this parameter can be prefilled from, and answer
   * with its identity.
   *
   * The form belongs to the editor above, not to this list, so synthesising
   * a field is asked for rather than done here. `null` means this build's
   * filing form cannot express what the parameter takes - a yes-or-no
   * answer, a pattern - in which case prefilling is not offered at all,
   * rather than offered and refused by the server on save.
   */
  readonly onPrefill?: (parameter: string, schema: AtomicSchema) => string | null
  /** true when a field could be made for this parameter */
  readonly canPrefill?: (schema: AtomicSchema) => boolean
  readonly onChange: (next: {
    recognitions: Record<string, RecognitionDraft>
    bindings: Record<string, BindingDraft>
  }) => void
}

/** a handle for a fact nobody has saved yet; stable for as long as the pen
 *  is open, and replaced by the server's identity once it is */
const handleFor = (parameter: string) => `draft:${parameter}`

const own = <T,>(record: Record<string, T>, key: string): T | undefined =>
  Object.hasOwn(record, key) ? record[key] : undefined

export function ScoringBindingEditor({
  inputSchema,
  bindableFields,
  recognitions,
  bindings,
  disabled,
  locale,
  fieldLabels,
  onPrefill,
  canPrefill,
  onChange,
}: ScoringBindingEditorProps) {
  const { format } = useI18n()
  const words = usePickerWords()
  const [open, setOpen] = useState<string | null>(null)
  const parameters = inputOrder(inputSchema)
  const diagnostics = bindingDiagnostics({ inputSchema, bindableFields, recognitions, bindings })
  // A field's own name, and nothing else. The internal identity is a stable
  // handle the product mints; printing it beside a name told the reader
  // nothing they could act on, and printing it INSTEAD of an unnamed field's
  // name told them less than the blank would have.
  const fieldName = (fieldId: string) => {
    const said = fieldLabels?.[fieldId]
    return said === undefined || said.trim() === '' ? format(m.itemsFieldUnnamed) : said
  }

  // the words for a proof's verdict: the kind, the bounds the rule read,
  // and the rule itself, each from the catalog and none from a code
  const kindWord = (kind: AtomicKind) =>
    format(
      kind === 'text'
        ? m.itemsTypeText
        : kind === 'integer'
          ? m.itemsTypeInteger
          : kind === 'decimal'
            ? m.itemsTypeDecimal
            : kind === 'choice'
              ? m.itemsTypeChoice
              : kind === 'boolean'
                ? m.itemsTypeBoolean
                : m.itemsTypeDate,
    )
  const facetText = (facet: SchemaFacet) =>
    [
      kindWord(facet.kind),
      ...facet.constraints.map(({ rule, value }) =>
        format(
          rule === 'min'
            ? m.itemsBindingFacetMin
            : rule === 'max'
              ? m.itemsBindingFacetMax
              : rule === 'scale'
                ? m.itemsBindingFacetScale
                : rule === 'minLength'
                  ? m.itemsBindingFacetMinLength
                  : rule === 'maxLength'
                    ? m.itemsBindingFacetMaxLength
                    : rule === 'pattern'
                      ? m.itemsBindingFacetPattern
                      : m.itemsBindingFacetChoices,
          { constraint: value },
        ),
      ),
    ].join(', ')
  const reasonText = ({ code, detail }: BindingDiagnostic['reason']) => {
    switch (code) {
      case 'kind-mismatch':
        return format(m.itemsBindingReasonKindMismatch)
      case 'text-length-widens':
        return format(m.itemsBindingReasonTextLengthWidens)
      case 'pattern-unprovable':
        return format(m.itemsBindingReasonPatternUnprovable)
      case 'integer-range-widens':
      case 'decimal-range-widens':
        return format(m.itemsBindingReasonRangeWidens)
      case 'decimal-scale-widens':
        return format(m.itemsBindingReasonScaleWidens)
      case 'choice-widens':
        return format(m.itemsBindingReasonChoiceWidens, {
          extra: ((detail as { extra?: readonly string[] } | undefined)?.extra ?? []).join(', '),
        })
      case 'converter-domain-exceeds':
        return format(m.itemsBindingReasonConverterDomainExceeds)
      case 'requires-conversion':
        return format(m.itemsBindingReasonRequiresConversion)
      case 'binding-unknown-parameter':
        return format(m.itemsBindingReasonUnknownParameter)
      case 'default-field-unknown':
        return format(m.itemsBindingReasonDefaultFieldUnknown)
      case 'refinement-not-in-profile':
        return format(m.itemsBindingReasonRefinementNotInProfile)
      default:
        return format(m.itemsBindingReasonOther, { reason: code })
    }
  }
  const sourceText = (source: BindingDiagnostic['source']) =>
    source.kind === 'recognition'
      ? format(m.itemsBindingDiagnosticSourceRecognition)
      : source.kind === 'default'
        ? format(m.itemsBindingDiagnosticSourceDefault, { field: fieldName(source.fieldId) })
        : format(m.itemsBindingConstant)
  const orphans = diagnostics.filter((one) => one.reason.code === 'binding-unknown-parameter')

  const write = (
    parameter: string,
    binding: BindingDraft,
    recognition?: { handle: string; value: RecognitionDraft | null },
  ) => {
    const nextRecognitions = { ...recognitions }
    if (recognition !== undefined) {
      if (recognition.value === null) delete nextRecognitions[recognition.handle]
      else nextRecognitions[recognition.handle] = recognition.value
    }
    onChange({ recognitions: nextRecognitions, bindings: { ...bindings, [parameter]: binding } })
  }

  /** everything one line needs to say, and everything its sheet needs to do */
  const readOne = (parameter: string) => {
    const schema = (
      Object.hasOwn(inputSchema.properties, parameter)
        ? inputSchema.properties[parameter]
        : undefined
    ) as AtomicSchema | undefined
    if (schema === undefined) return null
    const binding = own(bindings, parameter) ?? { kind: 'constant' as const, value: undefined }
    const handle = binding.kind === 'recognition' ? binding.handle : handleFor(parameter)
    const recognition = own(recognitions, handle)
    const source: SourceKind =
      binding.kind === 'constant'
        ? 'constant'
        : (recognition?.defaultFromFieldId ?? null) === null
          ? 'manual'
          : 'prefill'
    // What the fact must satisfy: its own refinement when it has one, and
    // otherwise exactly the parameter it answers.
    const target = normalizeAtomicSchema(
      (recognition?.refinement ?? schema) as AtomicSchema satisfies AtomicSchema,
    )
    // A constant nobody has typed into is not configured; the other two are
    // configured the moment they are chosen, because what is missing after
    // that is said by a diagnostic rather than by absence.
    const set = binding.kind === 'recognition' || binding.draft !== undefined
    return { schema, binding, handle, recognition, source, target, set }
  }

  const rows = parameters.flatMap((parameter) => {
    const one = readOne(parameter)
    return one === null ? [] : [{ parameter, ...one }]
  })
  const done = rows.filter((row) => row.set).length

  return (
    <div {...stylex.props(styles.frame)} data-testid="scoring-bindings">
      <span {...stylex.props(styles.tally)} data-parameters={rows.length} data-configured={done}>
        {format(done === rows.length ? m.itemsBindingAllSet : m.itemsBindingTally, {
          total: rows.length,
          done,
          left: rows.length - done,
        })}
      </span>

      <div {...stylex.props(styles.sheetCard)} role="table">
        <div role="row" {...stylex.props(styles.row, styles.headRow)}>
          <span role="columnheader">{format(m.itemsBindingColumnParameter)}</span>
          <span role="columnheader">{format(m.itemsBindingColumnTakes)}</span>
          <span role="columnheader">{format(m.itemsBindingColumnSource)}</span>
          <span />
        </div>
        {rows.map((row) => {
          const wrong = diagnostics.some(
            (one) => one.parameter === row.parameter && one.expected !== null,
          )
          return (
            <button
              key={row.parameter}
              type="button"
              role="row"
              data-parameter-row={row.parameter}
              data-binding-kind={row.binding.kind}
              data-binding-source={row.source}
              onClick={() => setOpen(row.parameter)}
              {...stylex.props(styles.row)}
            >
              <span role="cell" {...stylex.props(styles.cell, styles.name)}>
                {displayTitle(row.schema, row.parameter, locale)}
              </span>
              <span
                role="cell"
                data-schema-kind={kindOf(row.schema)}
                {...stylex.props(styles.cell, styles.quiet)}
              >
                {takesText(row.schema, locale, kindWord, format)}
              </span>
              <span
                role="cell"
                {...stylex.props(
                  styles.cell,
                  wrong && styles.wrong,
                  !row.set && !wrong && styles.unset,
                )}
              >
                {!row.set
                  ? format(m.itemsBindingUnset)
                  : row.source === 'constant'
                    ? format(m.itemsBindingConstant)
                    : row.source === 'manual'
                      ? format(m.itemsBindingManual)
                      : format(m.itemsBindingPrefilledFrom, {
                          field: fieldName(row.recognition?.defaultFromFieldId ?? ''),
                        })}
              </span>
              <ChevronRightIcon aria-hidden {...stylex.props(styles.chevron)} />
            </button>
          )
        })}
      </div>

      {/* Said on the list, not behind the press that opens a parameter. A
          binding the save will refuse is the one thing a reader has to see
          without going looking for it, and a screen of fifty lines is
          exactly where going looking does not happen. */}
      {diagnostics
        .filter((one) => one.expected !== null)
        .map((one) => (
          <div
            {...stylex.props(styles.diagnostic)}
            key={`${one.parameter}:${one.source.kind}:${one.reason.code}`}
            role="alert"
            data-testid="binding-diagnostic"
            data-parameter={one.parameter}
            data-source={one.source.kind}
            data-reason={one.reason.code}
          >
            <span>
              {displayTitle(
                (Object.hasOwn(inputSchema.properties, one.parameter)
                  ? inputSchema.properties[one.parameter]
                  : {}) as AtomicSchema,
                one.parameter,
                locale,
              )}
              {' 　 '}
              {sourceText(one.source)} 　 {reasonText(one.reason)}
            </span>
            <span>
              {format(m.itemsBindingDiagnosticExpected, { facet: facetText(one.expected!) })}
              {one.actual === null
                ? null
                : ` 　 ${format(m.itemsBindingDiagnosticActual, { facet: facetText(one.actual) })}`}
            </span>
          </div>
        ))}

      {orphans.length === 0 ? null : (
        <ul {...stylex.props(styles.orphans)} role="alert" data-testid="binding-orphans">
          {orphans.map((one) => (
            <li
              key={one.parameter}
              data-testid="binding-orphan"
              data-parameter={one.parameter}
              data-reason={one.reason.code}
            >
              {one.parameter} 　 {sourceText(one.source)} 　 {reasonText(one.reason)}
            </li>
          ))}
        </ul>
      )}

      {/* One parameter, configured where there is room for it. The list
          behind stays readable however many parameters a formula declares. */}
      <Sheet open={open !== null} onOpenChange={(next) => !next && setOpen(null)}>
        <SheetContent side="right" xstyle={styles.sheet}>
          <SheetHeader>
            <SheetTitle>{format(m.itemsBindingSheetTitle)}</SheetTitle>
            <SheetDescription>{format(m.itemsBindingSheetHint)}</SheetDescription>
          </SheetHeader>
          {(() => {
            if (open === null) return null
            const row = readOne(open)
            if (row === null) return null
            const { schema, binding, handle, recognition, source, target } = row
            const said = displayDescription(schema, locale)
            const prefillable = canPrefill?.(schema) ?? bindableFields.length > 0
            const pick = (next: SourceKind) => {
              if (next === 'constant') {
                write(
                  open,
                  { kind: 'constant', value: undefined },
                  // a fact nobody saved goes away with the binding that
                  // named it; a saved one stays, because dropping it would
                  // ask the server to revive an identity it refuses to revive
                  recognition?.id === null ? { handle, value: null } : undefined,
                )
                return
              }
              const base = recognition ?? {
                id: null,
                label: displayTitle(schema, open, locale),
                refinement: null,
                defaultFromFieldId: null,
              }
              if (next === 'manual') {
                // Unlinked, never deleted. The field may have been renamed,
                // explained, narrowed, or already filled in by somebody.
                write(
                  open,
                  { kind: 'recognition', handle },
                  { handle, value: { ...base, defaultFromFieldId: null } },
                )
                return
              }
              const fieldId =
                (recognition?.defaultFromFieldId ?? null) !== null
                  ? recognition!.defaultFromFieldId
                  : (onPrefill?.(open, schema) ?? null)
              if (fieldId === null) return
              write(
                open,
                { kind: 'recognition', handle },
                { handle, value: { ...base, defaultFromFieldId: fieldId } },
              )
            }
            return (
              <div {...stylex.props(styles.body)} data-testid="binding-sheet" data-parameter={open}>
                <section {...stylex.props(styles.part)}>
                  <h3 {...stylex.props(styles.partTitle)}>{format(m.itemsBindingTakesTitle)}</h3>
                  <div {...stylex.props(styles.takes)}>
                    <span {...stylex.props(styles.takesWhat)}>
                      {displayTitle(schema, open, locale)}
                    </span>
                    <span {...stylex.props(styles.takesMore)}>
                      {takesText(schema, locale, kindWord, format)}
                    </span>
                    {said === undefined ? null : (
                      <span {...stylex.props(styles.takesMore)}>{said}</span>
                    )}
                  </div>
                </section>

                <section {...stylex.props(styles.part)}>
                  <h3 {...stylex.props(styles.partTitle)}>{format(m.itemsBindingSource)}</h3>
                  <div {...stylex.props(styles.sources)} role="radiogroup">
                    {(
                      [
                        ['constant', m.itemsBindingConstant, m.itemsBindingConstantHint, true],
                        ['manual', m.itemsBindingManual, m.itemsBindingManualHint, true],
                        ['prefill', m.itemsBindingPrefilled, m.itemsBindingPrefillHint, prefillable],
                      ] as const
                    ).map(([kind, name, note, allowed]) => (
                      <button
                        key={kind}
                        type="button"
                        role="radio"
                        aria-checked={source === kind}
                        data-testid="binding-source-choice"
                        data-source={kind}
                        disabled={disabled || !allowed}
                        onClick={() => pick(kind)}
                        {...stylex.props(
                          styles.choice,
                          source === kind && styles.choiceOn,
                          !allowed && styles.choiceOff,
                        )}
                      >
                        <span {...stylex.props(styles.choiceWords)}>
                          <span {...stylex.props(styles.choiceName)}>{format(name)}</span>
                          <span {...stylex.props(styles.choiceNote)}>
                            {format(allowed ? note : m.itemsBindingPrefillUnavailable)}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </section>

                {binding.kind === 'constant' ? (
                  <section {...stylex.props(styles.part)}>
                    <AtomicValueField
                      words={words}
                      schema={schema}
                      name={open}
                      draft={binding.draft}
                      locale={locale}
                      disabled={disabled}
                      label={format(m.itemsBindingValue)}
                      onDraft={(draft: FieldDraft) => write(open, { ...binding, draft })}
                    />
                  </section>
                ) : (
                  <>
                    <section {...stylex.props(styles.part)}>
                      <Field label={format(m.itemsRecognitionLabel)}>
                        {(id) => (
                          <Input
                            id={id}
                            disabled={disabled}
                            value={recognition?.label ?? ''}
                            onChange={(event) =>
                              write(open, binding, {
                                handle,
                                value: {
                                  ...(recognition ?? {
                                    id: null,
                                    refinement: null,
                                    defaultFromFieldId: null,
                                  }),
                                  label: event.target.value,
                                },
                              })
                            }
                          />
                        )}
                      </Field>
                    </section>
                    {source === 'prefill' && (
                      <section {...stylex.props(styles.part)}>
                        <Field
                          label={format(m.itemsBindingPrefillField)}
                          hint={format(m.itemsBindingPrefillMade)}
                        >
                          {(id) => (
                            <Select
                              value={recognition?.defaultFromFieldId ?? ''}
                              disabled={disabled}
                              onValueChange={(next) =>
                                write(open, binding, {
                                  handle,
                                  value: {
                                    ...(recognition ?? {
                                      id: null,
                                      label: '',
                                      refinement: null,
                                    }),
                                    defaultFromFieldId: next === '' ? null : next,
                                  },
                                })
                              }
                            >
                              <SelectTrigger id={id} data-testid="recognition-default">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="">
                                  {format(m.itemsRecognitionNoDefault)}
                                </SelectItem>
                                {bindableFields.map((field) => {
                                  // assignable, as the value layer judges it -
                                  // never a guess from the field's type name.
                                  // A seeding may convert (a whole number into
                                  // a decimal fact); only an impossible one is
                                  // refused, exactly as the save refuses it -
                                  // and the refusal is READ OUT, because a
                                  // grey line with its reason hidden in a
                                  // tooltip is a grey line with no reason.
                                  const proof = assignmentPlan(
                                    normalizeAtomicSchema(field.schema as AtomicSchema),
                                    target,
                                  )
                                  const refused =
                                    proof.kind === 'incompatible' ? proof : undefined
                                  return (
                                    <SelectItem
                                      key={field.fieldId}
                                      value={field.fieldId}
                                      disabled={refused !== undefined}
                                      data-field-id={field.fieldId}
                                      data-field-assignable={refused === undefined}
                                      {...(refused === undefined
                                        ? {}
                                        : {
                                            'data-field-reason': refused.code,
                                            description: reasonText(refused),
                                          })}
                                    >
                                      {fieldName(field.fieldId)}
                                    </SelectItem>
                                  )
                                })}
                              </SelectContent>
                            </Select>
                          )}
                        </Field>
                      </section>
                    )}
                  </>
                )}

              </div>
            )
          })()}
        </SheetContent>
      </Sheet>
    </div>
  )
}

/**
 * What a parameter takes, in one short line.
 *
 * The kind, plus whichever bound is worth reading on a list: how many
 * choices, what range, how many decimal places. The full statement is in the
 * sheet; the line is there to be scanned down.
 */
const takesText = (
  schema: AtomicSchema,
  locale: string,
  kindWord: (kind: AtomicKind) => string,
  format: ReturnType<typeof useI18n>['format'],
): string => {
  const kind = kindOf(schema)
  const said = kindWord(kind)
  if (kind === 'choice') {
    const choice = schema as ChoiceSchema
    const shown = choice.enum.slice(0, 3).map((value) => choiceLabel(choice, value, locale))
    return `${said} 　 ${shown.join(' / ')}${choice.enum.length > shown.length ? ' …' : ''}`
  }
  const bounds = (schema as { minimum?: unknown; maximum?: unknown; maxLength?: unknown })
  if (kind === 'integer' || kind === 'decimal') {
    const low = bounds.minimum
    const high = bounds.maximum
    if (low !== undefined && high !== undefined) return `${said} 　 ${String(low)}–${String(high)}`
  }
  if (kind === 'text' && bounds.maxLength !== undefined) {
    return `${said} 　 ${format(m.itemsBindingFacetMaxLength, { constraint: String(bounds.maxLength) })}`
  }
  return said
}
