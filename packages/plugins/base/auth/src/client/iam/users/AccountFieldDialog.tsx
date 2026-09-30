import { useId, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { useTerm } from '@qualy/plugin-settings/client/terms'
import { authTerms } from '@qualy/auth-contract/terms'
import { Feedback, Field, FormDialog, useSettledCheck } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { toast } from '@qualy/ui/toast'

import { authApi } from '../../api.ts'
import { needsReauthentication, useReauthentication } from '../../account/Reauthentication.tsx'
import { emailShaped, refusedField } from './field-refusals.ts'
import * as m from '#messages'

// One field of a person's account, set where it is found missing: the
// profile's address line, a way in that finds them by it. The banner's
// "edit profile" still edits the whole record; this asks for the one thing
// the reader came to fill in.

const styles = stylex.create({
  form: { display: 'flex', flexDirection: 'column', gap: 14 },
})

export function AccountFieldDialog({
  userId,
  field,
  current,
  version,
  onClose,
}: {
  userId: string
  field: 'email' | 'businessNo'
  /** what the field holds now; null when it is missing */
  current: string | null
  /** the person's version the write is made against */
  version: number
  onClose: () => void
}) {
  const api = useApi(authApi)
  const run = useRunApi()
  const query = useApiQuery(authApi)
  const queryClient = useQueryClient()
  const { formatError } = useI18n()
  const businessNoWord = useTerm(authTerms.businessNumber)
  const formId = useId()
  const [value, setValue] = useState(current ?? '')
  const [feedback, setFeedback] = useState<string | null>(null)
  // a refusal about the value itself - somebody else holds it - which the
  // reader fixes in the field, so it is said under the field
  const [taken, setTaken] = useState<string | null>(null)
  // moving one's own address, from this screen as from one's own page
  const reauthentication = useReauthentication(undefined)
  const typed = value.trim()
  const shape = useSettledCheck(value, (next) =>
    field === 'email' && !emailShaped(next) ? m.person_emailInvalid() : null,
  )
  const writable = typed !== '' && typed !== current && (field !== 'email' || emailShaped(typed))

  const save = useMutation({
    mutationFn: () =>
      run(
        api.identity.updateUser({
          params: { userId },
          payload: { version, ...(field === 'email' ? { email: typed } : { businessNo: typed }) },
        }),
      ),
    onMutate: () => {
      setFeedback(null)
      setTaken(null)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: query.identity.key() })
      toast.success(m.feedback_saved())
      onClose()
    },
    onError: (error: unknown) => {
      if (needsReauthentication(error)) reauthentication.ask(() => save.mutate())
      else if (refusedField(error) === field) setTaken(formatError(error))
      else setFeedback(formatError(error))
    },
  })

  const setting = current === null
  const title =
    field === 'email'
      ? (setting ? m.account_emailSetTitle : m.account_emailChangeTitle)()
      : (setting ? m.person_businessNoSetTitle : m.person_businessNoChangeTitle)({
          businessNo: businessNoWord,
        })
  const hint =
    field === 'email'
      ? (setting ? m.person_emailPurpose : m.person_emailChangeConsequence)()
      : setting
        ? undefined
        : m.person_businessNoChangeConsequence({ businessNo: businessNoWord })

  return (
    <>
      <FormDialog
        open
        title={title}
        onClose={onClose}
        footer={
          <>
            <Button variant="outline" onClick={onClose}>
              {m.action_cancel()}
            </Button>
            <Button type="submit" form={formId} disabled={save.isPending || !writable}>
              {m.action_save()}
            </Button>
          </>
        }
      >
        <form
          id={formId}
          data-testid="account-field-form"
          data-field={field}
          {...stylex.props(styles.form)}
          onSubmit={(event: FormEvent) => {
            event.preventDefault()
            if (!save.isPending && writable) save.mutate()
          }}
        >
          <Feedback message={feedback} />
          <Field
            label={field === 'email' ? m.users_email() : businessNoWord}
            required
            error={taken ?? shape.error}
            {...(hint === undefined ? {} : { hint })}
          >
            {(id, control) => (
              <Input
                id={id}
                {...control}
                type={field === 'email' ? 'email' : 'text'}
                autoComplete="off"
                autoFocus
                value={value}
                onBlur={shape.onBlur}
                onChange={(event) => {
                  setValue(event.target.value)
                  setTaken(null)
                }}
              />
            )}
          </Field>
        </form>
      </FormDialog>
      {reauthentication.dialog}
    </>
  )
}
