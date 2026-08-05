import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useApi, useRunApi, useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { Feedback, Field, Panel } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { iamMessages as m } from '../i18n.ts'

export function NewUserForm({
  orgNodeId,
  userTypes,
}: {
  orgNodeId: string
  userTypes: readonly { id: string; code: string; name: string }[]
}) {
  const api = useApi()
  const run = useRunApi()
  const orpc = useApiQuery()
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  const [feedback, setFeedback] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [businessNo, setBusinessNo] = useState('')
  const [userTypeId, setUserTypeId] = useState('')

  const create = useMutation({
    mutationFn: () => run(api.identity.createUser({ payload: { displayName, userTypeId, primaryOrgNodeId: orgNodeId, businessNo: businessNo.trim() === '' ? undefined : businessNo.trim() } })),
    onMutate: () => setFeedback(null),
    onSuccess: async () => {
      setDisplayName('')
      setBusinessNo('')
      await queryClient.invalidateQueries({ queryKey: orpc.identity.key() })
    },
    onError: (error: unknown) => setFeedback(formatError(error)),
  })

  return (
    <Panel title={format(m.newUser)} description={format(m.newUserHint)}>
      <Feedback message={feedback} />
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          create.mutate()
        }}
      >
        <Field label={format(m.nameLabel)}>
          {(id) => (
            <Input
              id={id}
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
            <select
              id={id}
              className="h-9 rounded-md border bg-transparent px-2 text-sm"
              value={userTypeId}
              onChange={(event) => setUserTypeId(event.target.value)}
            >
              <option value="">{format(m.selectUserType)}</option>
              {userTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Button
          size="sm"
          type="submit"
          disabled={create.isPending || displayName.trim() === '' || userTypeId === ''}
        >
          {format(m.create)}
        </Button>
      </form>
    </Panel>
  )
}
