import * as stylex from '@stylexjs/stylex'
import { assignmentPlan, inputOrder, normalizeAtomicSchema } from '@qualy/value-schema'
import type { AtomicSchema, NormalizedInputSchema } from '@qualy/value-schema'
import { AtomicValueField } from '@qualy/web-value-form/InputValueForm'
import type { FieldDraft } from '@qualy/web-value-form/model'
import { useI18n } from '@qualy/web-i18n'
import { Field } from '@qualy/ui/admin'
import { Input } from '@qualy/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentMessages as m } from '../i18n.ts'
import type { BindingDraft, RecognitionDraft } from './ItemConfigEditor.tsx'

// Where a calculator's parameters meet what this question actually knows.
//
// The contract comes from the server's own compile, so the parameters here
// are the ones that will be frozen, named and typed exactly as they will be.
// Each is fed by a fixed value or by a recognised fact somebody determines;
// which form fields may seed such a fact is a question of ASSIGNABILITY,
// answered by the shared value layer and never by guessing at type names.
//
// A refinement narrows what a fact may be. This build has no control for
// one, and it is carried untouched rather than dropped: renaming a fact
// must not quietly widen what it admits.

const styles = stylex.create({
  frame: { display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  parameter: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    padding: '0.75rem',
    borderRadius: '0.5rem',
    border: `1px solid ${tokens.border}`,
  },
  head: { display: 'flex', alignItems: 'baseline', gap: '0.5rem' },
  name: { fontWeight: 500 },
  kind: { fontSize: '0.8125rem', color: tokens.mutedForeground },
  row: { display: 'flex', gap: '0.75rem', flexWrap: 'wrap' },
  source: { width: 160 },
  grown: { flex: 1, minWidth: 200 },
})

export interface ScoringBindingEditorProps {
  readonly inputSchema: NormalizedInputSchema
  readonly bindableFields: readonly { fieldId: string; schema: unknown; always: boolean }[]
  readonly recognitions: Record<string, RecognitionDraft>
  readonly bindings: Record<string, BindingDraft>
  readonly disabled: boolean
  readonly locale: string
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
  onChange,
}: ScoringBindingEditorProps) {
  const { format } = useI18n()
  const parameters = inputOrder(inputSchema)

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

  return (
    <div {...stylex.props(styles.frame)} data-testid="scoring-bindings">
      {parameters.map((parameter) => {
        const schema = (
          Object.hasOwn(inputSchema.properties, parameter)
            ? inputSchema.properties[parameter]
            : undefined
        ) as AtomicSchema | undefined
        if (schema === undefined) return null
        const binding = own(bindings, parameter) ?? { kind: 'constant' as const, value: undefined }
        const handle = binding.kind === 'recognition' ? binding.handle : handleFor(parameter)
        const recognition = own(recognitions, handle)
        // what the fact must satisfy: its own refinement when it has one,
        // and otherwise exactly the parameter it answers
        const target = normalizeAtomicSchema(
          (recognition?.refinement ?? schema) as AtomicSchema satisfies AtomicSchema,
        )
        return (
          <div
            {...stylex.props(styles.parameter)}
            key={parameter}
            data-parameter-row={parameter}
            data-binding-kind={binding.kind}
          >
            <div {...stylex.props(styles.head)}>
              <span {...stylex.props(styles.name)}>{schema.title ?? parameter}</span>
              <span {...stylex.props(styles.kind)}>{parameter}</span>
            </div>
            <div {...stylex.props(styles.row)}>
              <div {...stylex.props(styles.source)}>
                <Field label={format(m.itemsBindingSource)}>
                  {(id) => (
                    <Select
                      value={binding.kind}
                      disabled={disabled}
                      onValueChange={(next) =>
                        next === 'constant'
                          ? write(
                              parameter,
                              { kind: 'constant', value: undefined },
                              // a fact nobody saved goes away with the
                              // binding that named it; a saved one stays,
                              // because dropping it would ask the server to
                              // revive an identity it refuses to revive
                              recognition?.id === null ? { handle, value: null } : undefined,
                            )
                          : write(
                              parameter,
                              { kind: 'recognition', handle },
                              {
                                handle,
                                value: recognition ?? {
                                  id: null,
                                  label: '',
                                  refinement: null,
                                  defaultFromFieldId: null,
                                },
                              },
                            )
                      }
                    >
                      <SelectTrigger id={id}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="constant">{format(m.itemsBindingConstant)}</SelectItem>
                        <SelectItem value="recognition">
                          {format(m.itemsBindingRecognition)}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </Field>
              </div>
              {binding.kind === 'constant' ? (
                <div {...stylex.props(styles.grown)}>
                  <AtomicValueField
                    schema={schema}
                    name={parameter}
                    draft={binding.draft}
                    locale={locale}
                    disabled={disabled}
                    label={format(m.itemsBindingValue)}
                    onDraft={(draft: FieldDraft) => write(parameter, { ...binding, draft })}
                  />
                </div>
              ) : (
                <>
                  <div {...stylex.props(styles.grown)}>
                    <Field label={format(m.itemsRecognitionLabel)}>
                      {(id) => (
                        <Input
                          id={id}
                          disabled={disabled}
                          value={recognition?.label ?? ''}
                          onChange={(event) =>
                            write(parameter, binding, {
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
                  </div>
                  <div {...stylex.props(styles.grown)}>
                    <Field label={format(m.itemsRecognitionDefault)}>
                      {(id) => (
                        <Select
                          value={recognition?.defaultFromFieldId ?? ''}
                          disabled={disabled}
                          onValueChange={(next) =>
                            write(parameter, binding, {
                              handle,
                              value: {
                                ...(recognition ?? { id: null, label: '', refinement: null }),
                                defaultFromFieldId: next === '' ? null : next,
                              },
                            })
                          }
                        >
                          <SelectTrigger id={id} data-testid="recognition-default">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="">{format(m.itemsRecognitionNoDefault)}</SelectItem>
                            {bindableFields.map((field) => {
                              // assignable, as the value layer judges it -
                              // never a guess from the field's type name
                              const proof = assignmentPlan(
                                normalizeAtomicSchema(field.schema as AtomicSchema),
                                target,
                              )
                              return (
                                <SelectItem
                                  key={field.fieldId}
                                  value={field.fieldId}
                                  disabled={proof.kind !== 'direct'}
                                  data-field-assignable={proof.kind === 'direct'}
                                >
                                  {field.fieldId}
                                </SelectItem>
                              )
                            })}
                          </SelectContent>
                        </Select>
                      )}
                    </Field>
                  </div>
                </>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
