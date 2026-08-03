import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useApi, useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, CheckboxGroup, Feedback, Field, Panel } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { iamMessages as m } from '../i18n.ts'

// A type is created complete. Creating a bare one leaves it enabled with no
// sign-in channel and no permissions, which looks configured and is not.
export function NewUserTypeForm({ onCreated }: { onCreated: (userTypeId: string) => void }) {
  const api = useApi()
  const orpc = useApiQuery()
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  const [feedback, setFeedback] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [channels, setChannels] = useState<string[]>(['local'])
  const [permissionCodes, setPermissionCodes] = useState<string[]>([])

  const catalog = useQuery(
    orpc.access.listPermissions.queryOptions({
      input: { scope: 'tenant', grantChannel: 'user-type' },
    }),
  )

  const create = useMutation({
    mutationFn: () =>
      api.identity.createUserType({
        code,
        name,
        allowLocalLogin: channels.includes('local'),
        allowSsoLogin: channels.includes('sso'),
        permissionCodes,
      }),
    onMutate: () => setFeedback(null),
    onSuccess: async (result) => {
      setCode('')
      setName('')
      setPermissionCodes([])
      await queryClient.invalidateQueries({ queryKey: orpc.identity.key() })
      onCreated(result.id)
    },
    onError: (error: unknown) => setFeedback(formatError(error)),
  })

  return (
    <Panel title={format(m.newUserType)} description={format(m.newUserTypeHint)}>
      <Feedback message={feedback} />
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault()
          create.mutate()
        }}
      >
        <div className="flex flex-wrap items-end gap-2">
          <Field label={format(m.codeLabel)}>
            {(id) => (
              <Input id={id} value={code} onChange={(event) => setCode(event.target.value)} />
            )}
          </Field>
          <Field label={format(m.nameLabel)}>
            {(id) => (
              <Input id={id} value={name} onChange={(event) => setName(event.target.value)} />
            )}
          </Field>
        </div>
        <CheckboxGroup
          legend={format(m.loginChannels)}
          emptyLabel={format(m.noOptions)}
          options={[
            { value: 'local', label: format(m.allowLocalLogin) },
            { value: 'sso', label: format(m.allowSsoLogin) },
          ]}
          selected={channels}
          onChange={setChannels}
        />
        {/* a picker whose source failed to load must say so: an empty
            checkbox list is indistinguishable from "there is nothing here" */}
        <AsyncSection
          pending={catalog.isPending}
          error={catalog.isError ? formatError(catalog.error) : null}
          loadingLabel={format(commonMessages.loading)}
          retryLabel={format(commonMessages.retry)}
          onRetry={() => void catalog.refetch()}
        >
          <CheckboxGroup
            legend={format(m.permissionsLegend)}
            emptyLabel={format(m.noOptions)}
            options={(catalog.data?.permissions ?? []).map((permission) => ({
              value: permission.code,
              label: permission.name,
              hint: permission.code,
            }))}
            selected={permissionCodes}
            onChange={setPermissionCodes}
          />
        </AsyncSection>
        <Button
          size="sm"
          type="submit"
          disabled={create.isPending || code.trim() === '' || name.trim() === ''}
        >
          {format(m.create)}
        </Button>
      </form>
    </Panel>
  )
}
