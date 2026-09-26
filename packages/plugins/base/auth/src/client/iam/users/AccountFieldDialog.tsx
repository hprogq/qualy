import { useId, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { useTerm } from '@qualy/plugin-settings/client/terms'
import { authTerms } from '@qualy/auth-contract/terms'
import { Feedback, Field, FormDialog } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { toast } from '@qualy/ui/toast'
import { iamMessages as m } from '../../i18n.ts'
import { authApi } from '../../api.ts'
import { needsReauthentication, useReauthentication } from '../../account/Reauthentication.tsx'

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
  const { format, formatError } = useI18n()
  const businessNoWord = useTerm(authTerms.businessNumber)
  const formId = useId()
  const [value, setValue] = useState(current ?? '')
  const [feedback, setFeedback] = useState<string | null>(null)
  // moving one's own address, from this screen as from one's own page
  const reauthentication = useReauthentication(undefined)
  const typed = value.trim()

  const save = useMutation({
    mutationFn: () =>
      run(
        api.identity.updateUser({
          params: { userId },
          payload: { version, ...(field === 'email' ? { email: typed } : { businessNo: typed }) },
        }),
      ),
    onMutate: () => setFeedback(null),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: query.identity.key() })
      toast.success(format(m.saved))
      onClose()
    },
    onError: (error: unknown) => {
      if (needsReauthentication(error)) reauthentication.ask(() => save.mutate())
      else setFeedback(formatError(error))
    },
  })

  const setting = current === null
  const title =
    field === 'email'
      ? format(setting ? m.emailSetTitle : m.emailChangeTitle)
      : format(setting ? m.businessNoSetTitle : m.businessNoChangeTitle, {
          businessNo: businessNoWord,
        })
  const hint = setting
    ? undefined
    : field === 'email'
      ? format(m.emailChangeConsequence)
      : format(m.businessNoChangeConsequence, { businessNo: businessNoWord })

  return (
    <>
      <FormDialog
        open
        title={title}
        onClose={onClose}
        footer={
          <>
            <Button variant="outline" onClick={onClose}>
              {format(m.cancel)}
            </Button>
            <Button
              type="submit"
              form={formId}
              disabled={save.isPending || typed === '' || typed === current}
            >
              {format(m.save)}
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
            if (!save.isPending && typed !== '' && typed !== current) save.mutate()
          }}
        >
          <Feedback message={feedback} />
          <Field
            label={field === 'email' ? format(m.emailLabel) : businessNoWord}
            {...(hint === undefined ? {} : { hint })}
          >
            {(id) => (
              <Input
                id={id}
                type={field === 'email' ? 'email' : 'text'}
                autoComplete="off"
                autoFocus
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            )}
          </Field>
        </form>
      </FormDialog>
      {reauthentication.dialog}
    </>
  )
}
