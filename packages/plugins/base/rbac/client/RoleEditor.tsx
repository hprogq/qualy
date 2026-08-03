import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useApi, useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, CheckboxGroup, ConfirmDialog, Feedback, Field, Panel } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import type { RoleDto } from '../src/contract.ts'
import { rbacMessages as m } from './i18n.ts'

// Everything one role owns, edited in place. Each section saves on its own
// because the api treats them as separate subresources; one "save
// everything" button would have to guess which of them actually changed.
export function RoleEditor({ role, canManage }: { role: RoleDto; canManage: boolean }) {
  const api = useApi()
  const orpc = useApiQuery()
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  const [feedback, setFeedback] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [name, setName] = useState(role.name)
  const [description, setDescription] = useState(role.description ?? '')
  const [permissions, setPermissions] = useState<string[]>(role.permissions)
  const [userTypeIds, setUserTypeIds] = useState<string[]>(role.allowedUserTypeIds)
  const [orgTypeIds, setOrgTypeIds] = useState<string[]>(role.allowedOrgTypeIds)

  // a different record is a different form, so the draft re-seeds when the
  // selection changes or when a save brings back new server state
  useEffect(() => {
    setName(role.name)
    setDescription(role.description ?? '')
    setPermissions(role.permissions)
    setUserTypeIds(role.allowedUserTypeIds)
    setOrgTypeIds(role.allowedOrgTypeIds)
    setFeedback(null)
    setSaved(false)
  }, [role])

  const catalog = useQuery(
    orpc.access.listPermissions.queryOptions({
      input: { scope: role.kind === 'org' ? 'org' : 'tenant', grantChannel: 'role' },
    }),
  )
  const options = useQuery(orpc.access.getRoleOptions.queryOptions())

  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.access.key() })
  const run = <Variables,>(call: (input: Variables) => Promise<unknown>) => ({
    mutationFn: call,
    onMutate: () => {
      setFeedback(null)
      setSaved(false)
    },
    onSuccess: async () => {
      setSaved(true)
      await refresh()
    },
    onError: (error: unknown) => setFeedback(formatError(error)),
  })

  const saveProfile = useMutation(
    run(() =>
      api.access.updateRole({
        roleId: role.id,
        name,
        description: description.trim() === '' ? null : description,
      }),
    ),
  )
  const savePermissions = useMutation(
    run(() => api.access.syncRolePermissions({ roleId: role.id, codes: permissions })),
  )
  const saveEligibility = useMutation(
    run(() => api.access.syncRoleEligibility({ roleId: role.id, userTypeIds, orgTypeIds })),
  )
  const setAssignable = useMutation(
    run((assignable: boolean) => api.access.updateRole({ roleId: role.id, assignable })),
  )
  const setStatus = useMutation(
    run((status: 'active' | 'disabled') => api.access.setRoleStatus({ roleId: role.id, status })),
  )
  const remove = useMutation({
    ...run(() => api.access.deleteRole({ roleId: role.id })),
    onSuccess: async () => {
      setConfirmingDelete(false)
      await refresh()
    },
  })

  // the canonical administrator role is fixed wherever changing it would
  // lock a tenant out of its own administration
  const locked = role.isSystem
  const editable = canManage && !locked

  return (
    <Panel
      title={`${format(m.editRole)} · ${role.name}`}
      description={locked ? format(m.systemRoleHint) : undefined}
      actions={
        editable ? (
          <div className="flex shrink-0 gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={setStatus.isPending}
              onClick={() => setStatus.mutate(role.status === 'active' ? 'disabled' : 'active')}
            >
              {format(role.status === 'active' ? m.disable : m.enable)}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={setAssignable.isPending}
              onClick={() => setAssignable.mutate(!role.assignable)}
            >
              {format(m.assignableLabel)}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(true)}>
              {format(m.delete)}
            </Button>
          </div>
        ) : undefined
      }
    >
      <Feedback message={feedback} />
      {saved && !feedback && <Feedback message={format(m.saved)} tone="success" />}

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          saveProfile.mutate(undefined as never)
        }}
      >
        <Field label={format(m.nameLabel)}>
          {(id) => (
            <Input
              id={id}
              value={name}
              disabled={!canManage}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        <Field label={format(m.descriptionLabel)}>
          {(id) => (
            <Input
              id={id}
              value={description}
              disabled={!canManage}
              onChange={(event) => setDescription(event.target.value)}
            />
          )}
        </Field>
        <Button
          size="sm"
          type="submit"
          disabled={!canManage || saveProfile.isPending || name.trim() === ''}
        >
          {format(m.save)}
        </Button>
      </form>

      <AsyncSection
        pending={catalog.isPending}
        error={catalog.isError ? formatError(catalog.error) : null}
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => void catalog.refetch()}
      >
        <div className="space-y-2">
          <CheckboxGroup
            legend={format(m.permissionsLegend)}
            emptyLabel={format(m.noOptions)}
            disabled={!editable}
            options={(catalog.data?.permissions ?? []).map((permission) => ({
              value: permission.code,
              label: permission.name,
              hint: permission.code,
            }))}
            selected={permissions}
            onChange={setPermissions}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!editable || savePermissions.isPending}
            onClick={() => savePermissions.mutate(undefined as never)}
          >
            {format(m.save)}
          </Button>
        </div>
      </AsyncSection>

      {role.kind === 'org' && (
        <AsyncSection
          pending={options.isPending}
          error={options.isError ? formatError(options.error) : null}
          loadingLabel={format(commonMessages.loading)}
          retryLabel={format(commonMessages.retry)}
          onRetry={() => void options.refetch()}
        >
          <div className="space-y-2">
            <CheckboxGroup
              legend={format(m.userTypesLegend)}
              emptyLabel={format(m.noOptions)}
              disabled={!editable}
              options={(options.data?.userTypes ?? []).map((type) => ({
                value: type.id,
                label: type.name,
                hint: type.code,
              }))}
              selected={userTypeIds}
              onChange={setUserTypeIds}
            />
            <CheckboxGroup
              legend={format(m.orgTypesLegend)}
              emptyLabel={format(m.noOptions)}
              disabled={!editable}
              options={(options.data?.orgTypes ?? []).map((type) => ({
                value: type.id,
                label: type.name,
                hint: type.code,
              }))}
              selected={orgTypeIds}
              onChange={setOrgTypeIds}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!editable || saveEligibility.isPending}
              onClick={() => saveEligibility.mutate(undefined as never)}
            >
              {format(m.save)}
            </Button>
          </div>
        </AsyncSection>
      )}

      <ConfirmDialog
        open={confirmingDelete}
        title={format(m.confirmDeleteTitle)}
        description={format(m.confirmDeleteBody)}
        confirmLabel={format(m.delete)}
        cancelLabel={format(m.cancel)}
        pending={remove.isPending}
        onConfirm={() => remove.mutate(undefined as never)}
        onCancel={() => setConfirmingDelete(false)}
      />
    </Panel>
  )
}
