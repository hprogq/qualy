import type { ApiResult } from '@qualy/api-client/effect'
import type { Effect } from 'effect'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useApi, useRunApi, useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, CheckboxGroup, ConfirmDialog, Feedback, Field, Panel } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { iamMessages as m } from '../i18n.ts'
import { authApi } from '../api.ts'

// Everything a user type owns: display, sign-in policy and the tenant-wide
// permissions it carries. Disabling a type that people still hold is refused
// by the api, so the control says so up front rather than after a round trip.
/** the row as the api answers it, not a copy that can drift from it */
export type UserTypeRow = ApiResult<typeof authApi, 'identity', 'listUserTypes'>['userTypes'][number]

export function UserTypeEditor({
  userType,
  canManage,
}: {
  userType: UserTypeRow
  canManage: boolean
}) {
  const api = useApi(authApi)
  const runApi = useRunApi()
  const orpc = useApiQuery(authApi)
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  const [feedback, setFeedback] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [name, setName] = useState(userType.name)
  const [description, setDescription] = useState(userType.description ?? '')
  const [channels, setChannels] = useState<string[]>([])
  const [unrestricted, setUnrestricted] = useState(userType.placementPolicy.mode === 'unrestricted')
  const [orgTypeIds, setOrgTypeIds] = useState<string[]>(
    userType.placementPolicy.mode === 'allow-list' ? [...userType.placementPolicy.orgTypeIds] : [],
  )

  useEffect(() => {
    setName(userType.name)
    setDescription(userType.description ?? '')
    setChannels([
      ...(userType.allowLocalLogin ? ['local'] : []),
      ...(userType.allowSsoLogin ? ['sso'] : []),
    ])

    setFeedback(null)
    setSaved(false)
  }, [userType])

  // A user type decides where its people may stand, and nothing about what
  // they may do (that is what roles are for). Its own options endpoint, so
  // administering types needs no permission over roles.
  const catalog = useQuery(orpc.identity.getUserTypeOptions.queryOptions())
  useEffect(() => {
    setUnrestricted(userType.placementPolicy.mode === 'unrestricted')
    setOrgTypeIds(
      userType.placementPolicy.mode === 'allow-list'
        ? [...userType.placementPolicy.orgTypeIds]
        : [],
    )
  }, [userType])

  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.identity.key() })
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
      api.identity.updateUserType({
        params: { userTypeId: userType.id },
        payload: {
          version: userType.version,
          name,
          description: description.trim() === '' ? null : description,
          allowLocalLogin: channels.includes('local'),
          allowSsoLogin: channels.includes('sso'),
        },
      }),
    ),
  )
  const savePlacement = useMutation(
    run(() =>
      api.identity.setPlacementPolicy({
        params: { userTypeId: userType.id },
        payload: {
          version: userType.version,
          policy: unrestricted ? { mode: 'unrestricted' } : { mode: 'allow-list', orgTypeIds },
        },
      }),
    ),
  )
  const setStatus = useMutation(
    run((status: 'active' | 'disabled') =>
      api.identity.setUserTypeStatus({
        params: { userTypeId: userType.id },
        payload: { status, version: userType.version },
      }),
    ),
  )
  const remove = useMutation({
    ...run(() =>
      api.identity.deleteUserType({
        params: { userTypeId: userType.id },
        query: { version: String(userType.version) },
      }),
    ),
    onSuccess: async () => {
      setConfirmingDelete(false)
      await refresh()
    },
  })

  const populated = userType.userCount > 0

  return (
    <Panel
      title={`${format(m.editUserType)} · ${userType.name}`}
      description={userType.isSystem ? format(m.systemTypeHint) : undefined}
      actions={
        canManage ? (
          <div className="flex shrink-0 gap-2">
            <Button
              variant="outline"
              size="sm"
              // a populated type cannot be disabled at all: the api refuses
              // it, so offering the button would only produce an error
              disabled={setStatus.isPending || (userType.status === 'active' && populated)}
              onClick={() => setStatus.mutate(userType.status === 'active' ? 'disabled' : 'active')}
            >
              {format(userType.status === 'active' ? m.disable : m.enable)}
            </Button>
            {!userType.isSystem && (
              <Button
                variant="ghost"
                size="sm"
                disabled={populated}
                onClick={() => setConfirmingDelete(true)}
              >
                {format(m.delete)}
              </Button>
            )}
          </div>
        ) : undefined
      }
    >
      <Feedback message={feedback} />
      {saved && !feedback && <Feedback message={format(m.saved)} tone="success" />}

      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault()
          saveProfile.mutate(undefined as never)
        }}
      >
        <div className="flex flex-wrap items-end gap-2">
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
        </div>
        <CheckboxGroup
          legend={format(m.loginChannels)}
          emptyLabel={format(m.noOptions)}
          disabled={!canManage}
          options={[
            { value: 'local', label: format(m.allowLocalLogin) },
            { value: 'sso', label: format(m.allowSsoLogin) },
          ]}
          selected={channels}
          onChange={setChannels}
        />
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
          <p className="text-xs text-muted-foreground">{format(m.placementHint)}</p>
          {userType.placementPolicy.mode === 'tenant-root' ? (
            <p className="text-sm">{format(m.placementTenantRoot)}</p>
          ) : (
            <>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={unrestricted}
                  disabled={!canManage || userType.isSystem}
                  onChange={(event) => setUnrestricted(event.target.checked)}
                />
                {format(m.placementUnrestricted)}
              </label>
              {!unrestricted && (
                <CheckboxGroup
                  legend={format(m.allowedOrgTypesLegend)}
                  emptyLabel={format(m.noOptions)}
                  disabled={!canManage || userType.isSystem}
                  options={(catalog.data?.orgTypes ?? []).map((type) => ({
                    value: type.id,
                    label: type.name,
                    hint: type.code,
                  }))}
                  selected={orgTypeIds}
                  onChange={setOrgTypeIds}
                />
              )}
              <Button
                size="sm"
                variant="outline"
                // an allow-list naming nothing is not a policy, and the api says
                // so; the button says so first
                disabled={
                  !canManage ||
                  userType.isSystem ||
                  savePlacement.isPending ||
                  (!unrestricted && orgTypeIds.length === 0)
                }
                onClick={() => savePlacement.mutate(undefined as never)}
              >
                {format(m.save)}
              </Button>
            </>
          )}
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
