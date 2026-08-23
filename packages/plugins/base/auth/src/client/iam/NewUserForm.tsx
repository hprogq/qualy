import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useApi, useRunApi, useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { Feedback, Field, FormDialog } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import { iamMessages as m } from '../i18n.ts'
import { authApi } from '../api.ts'

export function NewUserForm({
  open,
  onClose,
  orgNodeId,
  userTypes,
}: {
  open: boolean
  onClose: () => void
  orgNodeId: string
  userTypes: readonly { id: string; code: string; name: string }[]
}) {
  const api = useApi(authApi)
  const run = useRunApi()
  const orpc = useApiQuery(authApi)
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  const [feedback, setFeedback] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [businessNo, setBusinessNo] = useState('')
  const [userTypeId, setUserTypeId] = useState('')

  const create = useMutation({
    mutationFn: () =>
      run(
        api.identity.createUser({
          payload: {
            displayName,
            userTypeId,
            primaryOrgNodeId: orgNodeId,
            businessNo: businessNo.trim() === '' ? undefined : businessNo.trim(),
          },
        }),
      ),
    onMutate: () => setFeedback(null),
    onSuccess: async () => {
      setDisplayName('')
      setBusinessNo('')
      onClose()
      await queryClient.invalidateQueries({ queryKey: orpc.identity.key() })
    },
    onError: (error: unknown) => setFeedback(formatError(error)),
  })

  return (
    <FormDialog
      open={open}
      title={format(m.newUser)}
      description={format(m.newUserHint)}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {format(m.cancel)}
          </Button>
          <Button
            type="submit"
            form="new-user"
            disabled={create.isPending || displayName.trim() === '' || userTypeId === ''}
          >
            {format(m.create)}
          </Button>
        </>
      }
    >
      <Feedback message={feedback} />
      <form
        id="new-user"
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault()
          create.mutate()
        }}
      >
        <Field label={format(m.nameLabel)}>
          {(id) => (
            <Input
              id={id}
              autoFocus
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          )}
        </Field>
        <Field label={format(m.businessNoLabel)}>
          {(id) => (
            <Input
              id={id}
              value={businessNo}
              onChange={(event) => setBusinessNo(event.target.value)}
            />
          )}
        </Field>
        <Field label={format(m.userTypeLabel)}>
          {(id) => (
            <Select value={userTypeId} onValueChange={setUserTypeId}>
              <SelectTrigger id={id} className="w-full">
                <SelectValue placeholder={format(m.selectUserType)} />
              </SelectTrigger>
              <SelectContent>
                {userTypes.map((type) => (
                  <SelectItem key={type.id} value={type.id}>
                    {type.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>
      </form>
    </FormDialog>
  )
}
