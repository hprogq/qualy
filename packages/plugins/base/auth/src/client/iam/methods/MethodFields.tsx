import * as stylex from '@stylexjs/stylex'
import { ChevronDownIcon } from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { Field } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Checkbox } from '@qualy/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@qualy/ui/collapsible'
import { Input } from '@qualy/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { iamMessages as m } from '../../i18n.ts'
import { fieldShown, formValues, type EntranceField, type EntranceKind } from './form-values.ts'

// The boxes one kind of entrance asked for, and nothing this screen decided:
// what a CAS server or an OAuth client needs to be told is the driver's
// knowledge, declared by it and drawn here.
//
// A text box shows what is stored and an emptied one clears it. A secret box
// always starts empty - what is stored never comes back - and says whether
// there is one; leaving it empty keeps it, and clearing it is its own press.
// A box the driver shows only while another holds some value is shown only
// then, and the advanced ones fold away until somebody opens them.

const styles = stylex.create({
  secret: { display: 'flex', alignItems: 'center', gap: 8 },
  grow: { flexGrow: 1, minWidth: 0 },
  fold: { display: 'flex', flexDirection: 'column', gap: 14 },
  foldKey: {
    alignSelf: 'flex-start',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    color: tokens.mutedForeground,
  },
  foldGlyph: { width: 14, height: 14 },
})

export function MethodFields({
  kind,
  config,
  secrets,
  draft,
  onChange,
  onClear,
  clearable = () => true,
  disabled = false,
}: {
  kind: EntranceKind
  /** what each non-secret box holds now, defaults included, as the box carries it */
  config: Readonly<Record<string, string>>
  /** which secrets are stored */
  secrets: readonly { readonly key: string; readonly stored: boolean }[]
  /** only the boxes somebody has typed in */
  draft: Readonly<Record<string, string>>
  onChange: (next: Record<string, string>) => void
  /** absent where nothing may be cleared */
  onClear?: (key: string) => void
  /** whether this stored secret may be cleared as the entrance stands */
  clearable?: (key: string) => boolean
  disabled?: boolean
}) {
  const { format, formatText } = useI18n()

  const values = formValues(kind, config, draft)
  const shown = (field: EntranceField) => fieldShown(field, values)
  const set = (key: string, value: string) => onChange({ ...draft, [key]: value })

  const box = (field: EntranceField) => {
    const stored = secrets.find((one) => one.key === field.key)?.stored ?? false
    const hint =
      field.kind === 'secret' && stored
        ? format(m.methodSecretStored)
        : field.hint === null
          ? undefined
          : formatText(field.hint)
    return (
      <Field
        key={field.key}
        label={formatText(field.label)}
        required={field.required}
        {...(hint === undefined ? {} : { hint })}
      >
        {(id) => {
          if (field.kind === 'choice') {
            const value = values[field.key] ?? ''
            return (
              <Select
                value={value === '' ? undefined : value}
                onValueChange={(next) => set(field.key, next)}
                disabled={disabled}
              >
                <SelectTrigger id={id} data-field-key={field.key}>
                  <SelectValue placeholder={format(m.methodChoose)} />
                </SelectTrigger>
                <SelectContent>
                  {field.options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {formatText(option.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )
          }
          if (field.kind === 'toggle') {
            return (
              <Checkbox
                id={id}
                data-field-key={field.key}
                disabled={disabled}
                checked={values[field.key] === 'true'}
                onCheckedChange={(next) => set(field.key, String(next))}
              />
            )
          }
          const input = (
            <Input
              id={id}
              name={`entrance-${field.key}`}
              data-field-key={field.key}
              type={
                field.kind === 'secret'
                  ? 'password'
                  : field.kind === 'url'
                    ? 'url'
                    : field.kind === 'number'
                      ? 'number'
                      : 'text'
              }
              {...(field.kind === 'number'
                ? {
                    ...(field.min === null ? {} : { min: field.min }),
                    ...(field.max === null ? {} : { max: field.max }),
                    ...(field.step === null ? {} : { step: field.step }),
                  }
                : {})}
              autoComplete={field.kind === 'secret' ? 'new-password' : 'off'}
              data-stored={field.kind === 'secret' ? String(stored) : undefined}
              disabled={disabled}
              value={
                field.kind === 'secret'
                  ? (draft[field.key] ?? '')
                  : (draft[field.key] ?? config[field.key] ?? '')
              }
              onChange={(event) => set(field.key, event.target.value)}
            />
          )
          if (field.kind !== 'secret' || !stored || onClear === undefined) return input
          return (
            <span {...stylex.props(styles.secret)}>
              <span {...stylex.props(styles.grow)}>{input}</span>
              <Button
                size="sm"
                variant="outline"
                data-testid="secret-clear"
                aria-label={format(m.methodSecretClearLabel, { field: formatText(field.label) })}
                disabled={disabled || !clearable(field.key)}
                onClick={() => onClear(field.key)}
              >
                {format(m.methodSecretClear)}
              </Button>
            </span>
          )
        }}
      </Field>
    )
  }

  const basic = kind.fields.filter((field) => field.section === 'basic' && shown(field))
  const advanced = kind.fields.filter((field) => field.section === 'advanced' && shown(field))
  return (
    <>
      {basic.map(box)}
      {advanced.length > 0 && (
        <Collapsible data-testid="method-advanced">
          <div {...stylex.props(styles.fold)}>
            <CollapsibleTrigger asChild>
              <Button size="sm" variant="ghost" {...stylex.props(styles.foldKey)}>
                {format(m.methodAdvanced)}
                <ChevronDownIcon aria-hidden {...stylex.props(styles.foldGlyph)} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div {...stylex.props(styles.fold)}>{advanced.map(box)}</div>
            </CollapsibleContent>
          </div>
        </Collapsible>
      )}
    </>
  )
}
