import * as stylex from '@stylexjs/stylex'
import type { ApiResult } from '@qualy/web-runtime/api'
import { useI18n } from '@qualy/web-i18n'
import { Field } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import type { authApi } from '../../api.ts'
import { iamMessages as m } from '../../i18n.ts'

// The boxes one kind of entrance asked for, and nothing this screen decided:
// what a CAS server or an OAuth client needs to be told is the driver's
// knowledge, declared by it and drawn here.
//
// A text box shows what is stored and an emptied one clears it. A secret box
// always starts empty - what is stored never comes back - and says whether
// there is one; leaving it empty keeps it, and clearing it is its own press.

export type EntranceKind = ApiResult<
  typeof authApi,
  'identity',
  'listAuthProviderKinds'
>['kinds'][number]

const styles = stylex.create({
  secret: { display: 'flex', alignItems: 'center', gap: 8 },
  grow: { flexGrow: 1, minWidth: 0 },
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
  /** what is stored for the text and url boxes */
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
  return (
    <>
      {kind.fields.map((field) => {
        const stored = secrets.find((one) => one.key === field.key)?.stored ?? false
        const hint =
          field.kind === 'secret' && stored
            ? format(m.methodSecretStored)
            : field.hint === null
              ? undefined
              : formatText(field.hint)
        const value =
          field.kind === 'secret'
            ? (draft[field.key] ?? '')
            : (draft[field.key] ?? config[field.key] ?? '')
        return (
          <Field
            key={field.key}
            label={formatText(field.label)}
            required={field.required}
            {...(hint === undefined ? {} : { hint })}
          >
            {(id) => {
              const input = (
                <Input
                  id={id}
                  name={`entrance-${field.key}`}
                  type={
                    field.kind === 'secret' ? 'password' : field.kind === 'url' ? 'url' : 'text'
                  }
                  autoComplete={field.kind === 'secret' ? 'new-password' : 'off'}
                  data-stored={field.kind === 'secret' ? String(stored) : undefined}
                  disabled={disabled}
                  value={value}
                  onChange={(event) => onChange({ ...draft, [field.key]: event.target.value })}
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
      })}
    </>
  )
}
