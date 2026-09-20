import type { ApiResult } from '@qualy/web-runtime/api'
import { useI18n } from '@qualy/web-i18n'
import { Field } from '@qualy/ui/admin'
import { Input } from '@qualy/ui/input'
import type { authApi } from '../../api.ts'
import { iamMessages as m } from '../../i18n.ts'

// The boxes one kind of entrance asked for, and nothing this screen decided:
// what a CAS server or an OAuth client needs to be told is the driver's
// knowledge, declared by it and drawn here.

export type EntranceKind = ApiResult<
  typeof authApi,
  'identity',
  'listAuthProviderKinds'
>['kinds'][number]

export function MethodFields({
  kind,
  values,
  onChange,
  editing,
  disabled = false,
}: {
  kind: EntranceKind
  values: Readonly<Record<string, string>>
  onChange: (next: Record<string, string>) => void
  /** an entrance that already exists: a secret left empty stays as it was */
  editing: boolean
  disabled?: boolean
}) {
  const { format, formatText } = useI18n()
  return (
    <>
      {kind.fields.map((field) => (
        <Field
          key={field.key}
          label={formatText(field.label)}
          required={field.required && !(editing && field.kind === 'secret')}
          {...(field.kind === 'secret' && editing
            ? { hint: format(m.methodSecretKept) }
            : field.hint === null
              ? {}
              : { hint: formatText(field.hint) })}
        >
          {(id) => (
            <Input
              id={id}
              name={`entrance-${field.key}`}
              type={field.kind === 'secret' ? 'password' : field.kind === 'url' ? 'url' : 'text'}
              autoComplete={field.kind === 'secret' ? 'new-password' : 'off'}
              disabled={disabled}
              value={values[field.key] ?? ''}
              onChange={(event) => onChange({ ...values, [field.key]: event.target.value })}
            />
          )}
        </Field>
      ))}
    </>
  )
}
