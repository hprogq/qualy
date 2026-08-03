import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useApi, useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, CheckboxGroup, Feedback, Field, Panel } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { rbacMessages as m } from './i18n.ts'

// A role is created complete. Creating a bare one and configuring it later
// leaves a window where it is enabled, assignable and grants nothing, which
// is indistinguishable from a misconfiguration.
export function NewRoleForm({ onCreated }: { onCreated: (roleId: string) => void }) {
  const api = useApi()
  const orpc = useApiQuery()
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  const [feedback, setFeedback] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [permissionCodes, setPermissionCodes] = useState<string[]>([])
  const [allowedUserTypeIds, setAllowedUserTypeIds] = useState<string[]>([])
  const [allowedOrgTypeIds, setAllowedOrgTypeIds] = useState<string[]>([])

  const catalog = useQuery(
    orpc.access.listPermissions.queryOptions({
      input: { scope: 'org', grantChannel: 'role' },
    }),
  )
  const options = useQuery(orpc.access.getRoleOptions.queryOptions())

  const create = useMutation({
    mutationFn: () =>
      api.access.createOrgRole({
        code,
        name,
        permissionCodes,
        allowedUserTypeIds,
        allowedOrgTypeIds,
      }),
    onMutate: () => setFeedback(null),
    onSuccess: async (result) => {
      setCode('')
      setName('')
      setPermissionCodes([])
      setAllowedUserTypeIds([])
      setAllowedOrgTypeIds([])
      await queryClient.invalidateQueries({ queryKey: orpc.access.key() })
      onCreated(result.id)
    },
    onError: (error: unknown) => setFeedback(formatError(error)),
  })

  const incomplete =
    code.trim() === '' ||
    name.trim() === '' ||
    allowedUserTypeIds.length === 0 ||
    allowedOrgTypeIds.length === 0

  return (
    <Panel title={format(m.newRole)} description={format(m.newRoleHint)}>
      <Feedback message={feedback} />
      <form
        className="space-y-4"
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
        <AsyncSection
          pending={options.isPending}
          error={options.isError ? formatError(options.error) : null}
          loadingLabel={format(commonMessages.loading)}
          retryLabel={format(commonMessages.retry)}
          onRetry={() => void options.refetch()}
        >
          <div className="space-y-3">
            <CheckboxGroup
              legend={format(m.userTypesLegend)}
              emptyLabel={format(m.noOptions)}
              options={(options.data?.userTypes ?? []).map((type) => ({
                value: type.id,
                label: type.name,
                hint: type.code,
              }))}
              selected={allowedUserTypeIds}
              onChange={setAllowedUserTypeIds}
            />
            <CheckboxGroup
              legend={format(m.orgTypesLegend)}
              emptyLabel={format(m.noOptions)}
              options={(options.data?.orgTypes ?? []).map((type) => ({
                value: type.id,
                label: type.name,
                hint: type.code,
              }))}
              selected={allowedOrgTypeIds}
              onChange={setAllowedOrgTypeIds}
            />
          </div>
        </AsyncSection>
        <Button size="sm" type="submit" disabled={create.isPending || incomplete}>
          {format(m.create)}
        </Button>
      </form>
    </Panel>
  )
}
