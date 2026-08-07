import type { ApiResult } from '@qualy/web-runtime/api'
import type { Effect } from 'effect'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useApi, useRunApi, useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, CheckboxGroup, ConfirmDialog, Feedback, Field, Panel } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { rbacMessages as m } from './i18n.ts'
import { accessApi } from './api.ts'

// Everything one role owns, edited in place. Each section saves on its own
// because the api treats them as separate subresources; one "save
// everything" button would have to guess which of them actually changed.
/** the row as the api answers it, not a copy that can drift from it */
export type RoleRow = ApiResult<typeof accessApi, 'access', 'listRoles'>['roles'][number]

export function RoleEditor({ role, canManage }: { role: RoleRow; canManage: boolean }) {
  const api = useApi(accessApi)
  const runApi = useRunApi()
  const orpc = useApiQuery(accessApi)
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  const [feedback, setFeedback] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [name, setName] = useState(role.name)
  const [description, setDescription] = useState(role.description ?? '')
  const [permissions, setPermissions] = useState<string[]>([...role.permissions])
  const [anyUserType, setAnyUserType] = useState(role.eligibility.mode === 'unrestricted')
  const [anyOrgType, setAnyOrgType] = useState(role.anchor.mode === 'unrestricted')
  const [userTypeIds, setUserTypeIds] = useState<string[]>(
    role.eligibility.mode === 'allow-list' ? [...role.eligibility.userTypeIds] : [],
  )
  const [orgTypeIds, setOrgTypeIds] = useState<string[]>(
    role.anchor.mode === 'allow-list' ? [...role.anchor.orgTypeIds] : [],
  )

  // a different record is a different form, so the draft re-seeds when the
  // selection changes or when a save brings back new server state
  useEffect(() => {
    setName(role.name)
    setDescription(role.description ?? '')
    setPermissions([...role.permissions])
    setAnyUserType(role.eligibility.mode === 'unrestricted')
    setAnyOrgType(role.anchor.mode === 'unrestricted')
    setUserTypeIds(role.eligibility.mode === 'allow-list' ? [...role.eligibility.userTypeIds] : [])
    setOrgTypeIds(role.anchor.mode === 'allow-list' ? [...role.anchor.orgTypeIds] : [])
    setFeedback(null)
    setSaved(false)
  }, [role])

  const catalog = useQuery(
    orpc.access.listPermissions.queryOptions({
      query: { target: role.kind === 'org' ? 'org-node' : 'tenant' },
    }),
  )
  const options = useQuery(orpc.access.getRoleOptions.queryOptions())

  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.access.key() })
  // the one crossing from an effect to a promise on this screen: TanStack
  // needs a promise, and doing it here keeps every call site an effect
  const run = <Variables,>(call: (input: Variables) => Effect.Effect<unknown, unknown>) => ({
    mutationFn: (input: Variables) => runApi(call(input)),
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
      // the version this editor read: a save that cannot say what it saw is
      // a save that silently overwrites whoever went second
      api.access.updateRole({
        params: { roleId: role.id },
        payload: {
          version: role.version,
          name,
          description: description.trim() === '' ? null : description,
        },
      }),
    ),
  )
  const savePermissions = useMutation(
    run(() =>
      api.access.setRolePermissions({
        params: { roleId: role.id },
        payload: { version: role.version, codes: permissions },
      }),
    ),
  )
  const saveEligibility = useMutation(
    run(() =>
      api.access.setRoleEligibility({
        params: { roleId: role.id },
        payload: {
          version: role.version,
          eligibility: anyUserType
            ? { mode: 'unrestricted' as const }
            : { mode: 'allow-list' as const, userTypeIds },
          anchor: anyOrgType
            ? { mode: 'unrestricted' as const }
            : { mode: 'allow-list' as const, orgTypeIds },
        },
      }),
    ),
  )
  const setAssignable = useMutation(
    run((assignable: boolean) =>
      api.access.updateRole({
        params: { roleId: role.id },
        payload: { version: role.version, assignable },
      }),
    ),
  )
  const setStatus = useMutation(
    run((status: 'active' | 'disabled') =>
      api.access.setRoleStatus({
        params: { roleId: role.id },
        payload: { version: role.version, status },
      }),
    ),
  )
  const remove = useMutation({
    ...run(() =>
      api.access.deleteRole({
        params: { roleId: role.id },
        query: { version: String(role.version) },
      }),
    ),
    onSuccess: async () => {
      setConfirmingDelete(false)
      await refresh()
    },
  })

  // the canonical administrator role is fixed wherever changing it would
  // lock a tenant out of its own administration
  const locked = role.systemKey !== null
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

      {/* every role says who may hold it; only an anchored one says where
          the duty applies */}
      <AsyncSection
        pending={options.isPending}
        error={options.isError ? formatError(options.error) : null}
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => void options.refetch()}
      >
        <div className="space-y-2">
          {/* the mode first, and the list only when it is the mode: an empty
              allow-list means nobody, which is a different rule from anybody */}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={anyUserType}
              disabled={!editable}
              onChange={(event) => setAnyUserType(event.target.checked)}
            />
            {format(m.anyUserType)}
          </label>
          {!anyUserType && (
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
          )}
          {role.kind === 'org' && (
            <>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={anyOrgType}
                  disabled={!editable}
                  onChange={(event) => setAnyOrgType(event.target.checked)}
                />
                {format(m.anyOrgType)}
              </label>
              {!anyOrgType && (
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
              )}
            </>
          )}
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
