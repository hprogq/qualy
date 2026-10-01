import { assertNever } from '@qualy/web-i18n'
import { useApiMutation, useApi, useApiQuery } from '@qualy/web-runtime'
import { useId, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'

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
  const query = useApiQuery(authApi)
  const queryClient = useQueryClient()

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

  const save = useApiMutation({
    mutationFn: () =>
      api.identity.updateUser({
        params: { userId },
        payload: { version, ...(field === 'email' ? { email: typed } : { businessNo: typed }) },
      }),
    onMutate: () => {
      setFeedback(null)
      setTaken(null)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: query.identity.key() })
      toast.success(m.feedback_saved())
      onClose()
    },
    onError: (error) => {
      let failure: string
      switch (error._tag) {
        case 'AUTH_DEMO_ACCOUNT_LOCKED':
          failure = m.error_demoAccountLocked()
          break
        case 'AUTH_REAUTHENTICATION_REQUIRED':
          failure = m.error_reauthenticationRequired()
          break
        case 'GRANT_INCOMPATIBLE':
          failure = m.error_grantIncompatible({ grantCount: error.grantCount })
          break
        case 'LAST_ADMINISTRATOR':
          failure = m.error_lastAdministrator()
          break
        case 'SYSTEM_ACCOUNT_PROTECTED':
          failure = m.error_systemAccountProtected()
          break
        case 'USER_CONFLICT':
          failure = m.error_userConflict()
          break
        case 'USER_EMAIL_CONFLICT':
          failure = m.error_userEmailConflict()
          break
        case 'USER_PLACEMENT_NOT_FOUND':
          failure = m.error_userPlacementNotFound()
          break
        case 'USER_TYPE_DISABLED':
          failure = m.error_userTypeDisabled()
          break
        case 'USER_TYPE_NOT_FOUND':
          failure = m.error_userTypeNotFound()
          break
        case 'USER_TYPE_PLACEMENT_NOT_ALLOWED':
          failure = m.error_userTypePlacementNotAllowed()
          break
        case 'USER_VERSION_CONFLICT':
          failure = m.error_userVersionConflict()
          break
        default:
          assertNever(error)
      }
      if (needsReauthentication(error)) reauthentication.ask(() => save.mutate())
      else if (refusedField(error) === field) setTaken(failure)
      else setFeedback(failure)
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
