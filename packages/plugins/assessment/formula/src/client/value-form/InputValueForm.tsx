/**
 * A form generated from a value-schema input contract: one field per
 * parameter in the authored order, labeled by the annotation layer with
 * the locale/default/key fallback, each control matched to the atomic
 * kind. State is the caller's (drafts in, changes out) and so are the
 * words for problems - this module renders structure, not copy.
 */

import * as stylex from '@stylexjs/stylex'
import {
  choiceLabel,
  displayDescription,
  displayTitle,
  inputOrder,
  kindOf,
  type AtomicSchema,
  type ChoiceSchema,
  type NormalizedInputSchema,
} from '@qualy/value-schema'
import { Input } from '@qualy/ui/input'
import { NativeSelect } from '@qualy/ui/native-select'
import { Checkbox } from '@qualy/ui/checkbox'
import { Field } from '@qualy/ui/admin'
import type { FieldDraft } from './model.ts'

const styles = stylex.create({
  grid: { display: 'flex', flexDirection: 'column', gap: '0.625rem' },
  description: { fontSize: '0.75rem', color: 'var(--q-surface-muted-foreground)', margin: 0 },
  problem: { fontSize: '0.75rem', color: 'var(--q-danger, #b91c1c)', margin: 0 },
})

export interface InputValueFormProps {
  readonly schema: NormalizedInputSchema
  readonly drafts: Readonly<Record<string, FieldDraft>>
  readonly onDraft: (name: string, draft: FieldDraft) => void
  readonly locale: string
  readonly disabled?: boolean
  /** field name -> already-translated words about what stops it */
  readonly problems?: ReadonlyMap<string, string>
  /** distinguishes multiple forms on one screen for stable test hooks */
  readonly scope: string
}

const AtomicControl = ({
  schema,
  name,
  draft,
  onDraft,
  locale,
  disabled,
  id,
}: {
  schema: AtomicSchema
  name: string
  draft: FieldDraft
  onDraft: (draft: FieldDraft) => void
  locale: string
  disabled: boolean
  id: string
}) => {
  const kind = kindOf(schema)
  if (kind === 'boolean')
    return (
      <Checkbox
        id={id}
        checked={draft === true}
        disabled={disabled}
        onCheckedChange={(checked) => onDraft(checked === true)}
      />
    )
  if (kind === 'choice') {
    const choice = schema as ChoiceSchema
    return (
      <NativeSelect
        id={id}
        value={typeof draft === 'string' ? draft : ''}
        disabled={disabled}
        onChange={(event) => onDraft(event.target.value)}
      >
        <option value="" />
        {choice.enum.map((value) => (
          <option key={value} value={value}>
            {choiceLabel(choice, value, locale)}
          </option>
        ))}
      </NativeSelect>
    )
  }
  return (
    <Input
      id={id}
      value={typeof draft === 'string' ? draft : String(draft)}
      disabled={disabled}
      inputMode={kind === 'integer' ? 'numeric' : kind === 'decimal' ? 'decimal' : undefined}
      type={kind === 'date' ? 'date' : 'text'}
      onChange={(event) => onDraft(event.target.value)}
    />
  )
}

export function InputValueForm({
  schema,
  drafts,
  onDraft,
  locale,
  disabled = false,
  problems,
  scope,
}: InputValueFormProps) {
  return (
    <div {...stylex.props(styles.grid)} data-testid={`value-form-${scope}`}>
      {inputOrder(schema).map((name) => {
        const property = schema.properties[name]
        if (property === undefined) return null
        const description = displayDescription(property, locale)
        const problem = problems?.get(name)
        return (
          <Field key={name} label={displayTitle(property, name, locale)}>
            {(id) => (
              <div data-parameter={name} data-invalid={problem === undefined ? undefined : true}>
                <AtomicControl
                  schema={property}
                  name={name}
                  draft={drafts[name] ?? ''}
                  onDraft={(draft) => onDraft(name, draft)}
                  locale={locale}
                  disabled={disabled}
                  id={id}
                />
                {description === undefined ? null : (
                  <p {...stylex.props(styles.description)}>{description}</p>
                )}
                {problem === undefined ? null : (
                  <p {...stylex.props(styles.problem)} role="alert">
                    {problem}
                  </p>
                )}
              </div>
            )}
          </Field>
        )
      })}
    </div>
  )
}
