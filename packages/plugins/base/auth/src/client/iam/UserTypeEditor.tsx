import type { ApiResult } from '@qualy/web-runtime/api'
import type { Effect } from 'effect'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useApi, useRunApi, useApiQuery, PageLink } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, ConfirmDialog, Feedback, Field, FormDialog } from '@qualy/ui/admin'
import { Barred, DefRow, EditorHead, ModeChoice, PickGrid } from '@qualy/ui/screen'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { iamMessages as m } from '../i18n.ts'
import { authApi } from '../api.ts'

// What one user type decides, which is only where its people may stand: a
// type confers no authority at all, so everything else on this screen is a
// consequence stated back to the reader rather than a control.
//
// The consequences are read through queries that are allowed to fail. Who may
// sign in through which entrance, and which roles admit this type, are facts
// owned by other domains; a reader without those reads gets a screen without
// those rows rather than a screen that cannot load.
/** the row as the api answers it, not a copy that can drift from it */
export type UserTypeRow = ApiResult<
  typeof authApi,
  'identity',
  'listUserTypes'
>['userTypes'][number]

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
  const [renaming, setRenaming] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [name, setName] = useState(userType.name)
  const [description, setDescription] = useState(userType.description ?? '')
  const stored =
    userType.placementPolicy.mode === 'allow-list' ? [...userType.placementPolicy.orgTypeIds] : []
  const [mode, setMode] = useState<'unrestricted' | 'allow-list'>(
    userType.placementPolicy.mode === 'unrestricted' ? 'unrestricted' : 'allow-list',
  )
  const [orgTypeIds, setOrgTypeIds] = useState<string[]>(stored)

  // a different record is a different form, so the draft re-seeds when the
  // selection changes or when a save brings back new server state
  useEffect(() => {
    setName(userType.name)
    setDescription(userType.description ?? '')
    setMode(userType.placementPolicy.mode === 'unrestricted' ? 'unrestricted' : 'allow-list')
    setOrgTypeIds(
      userType.placementPolicy.mode === 'allow-list'
        ? [...userType.placementPolicy.orgTypeIds]
        : [],
    )
    setFeedback(null)
    setSaved(false)
  }, [userType])

  // its own options endpoint, so administering types needs no permission over
  // the organization
  const catalog = useQuery(orpc.identity.getUserTypeOptions.queryOptions())
  const providers = useQuery({
    ...orpc.identity.listAuthProviders.queryOptions(),
    retry: false,
  })
  const roles = useQuery({ ...orpc.access.listRoles.queryOptions({ query: {} }), retry: false })

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

  const saveProfile = useMutation({
    ...run(() =>
      api.identity.updateUserType({
        params: { userTypeId: userType.id },
        payload: {
          // the version this editor read: a save that cannot say what it saw
          // is a save that silently overwrites whoever went second
          version: userType.version,
          name,
          description: description.trim() === '' ? null : description,
        },
      }),
    ),
    onSuccess: async () => {
      setRenaming(false)
      await refresh()
    },
  })
  const savePlacement = useMutation(
    run(() =>
      api.identity.setPlacementPolicy({
        params: { userTypeId: userType.id },
        payload: {
          version: userType.version,
          policy:
            mode === 'unrestricted' ? { mode: 'unrestricted' } : { mode: 'allow-list', orgTypeIds },
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

  const fixed = userType.placementPolicy.mode === 'tenant-root'
  const editable = canManage && !userType.isSystem && !fixed
  const populated = userType.userCount > 0
  const dirty =
    mode !== (userType.placementPolicy.mode === 'unrestricted' ? 'unrestricted' : 'allow-list') ||
    [...orgTypeIds].sort().join(',') !== [...stored].sort().join(',')
  const revert = () => {
    setMode(userType.placementPolicy.mode === 'unrestricted' ? 'unrestricted' : 'allow-list')
    setOrgTypeIds(stored)
  }

  // which entrances admit this type, and which roles it may hold - both
  // stated as sentences, because a reader is checking a consequence rather
  // than editing anything here
  const admitting = (providers.data?.providers ?? [])
    .filter(
      (provider) =>
        provider.status === 'active' &&
        (provider.audience.mode === 'unrestricted' ||
          provider.audience.userTypeIds.includes(userType.id)),
    )
    .map((provider) => provider.name)
  const openRoles = (roles.data?.roles ?? [])
    .filter(
      (role) =>
        role.status === 'active' &&
        (role.holderPolicy.mode === 'unrestricted' ||
          role.holderPolicy.userTypeIds.includes(userType.id)),
    )
    .map((role) => role.name)

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <EditorHead
        title={userType.name}
        chips={[
          ...(userType.isSystem ? [{ label: format(m.systemBadge), tone: 'quiet' as const }] : []),
          ...(userType.status === 'disabled'
            ? [{ label: format(m.statusDisabled), tone: 'alert' as const }]
            : []),
          { label: format(m.userCount, { count: userType.userCount }), tone: 'quiet' as const },
        ]}
        actions={
          canManage && (
            <Button variant="outline" size="sm" onClick={() => setRenaming(true)}>
              {format(m.rename)}
            </Button>
          )
        }
      />

      <Feedback message={feedback} />
      {saved && feedback === null && <Feedback message={format(m.saved)} tone="success" />}

      <AsyncSection
        pending={catalog.isPending}
        error={catalog.isError ? formatError(catalog.error) : null}
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => void catalog.refetch()}
      >
        <div data-testid="placement-panel" className="flex min-w-0 flex-col gap-3">
          {fixed ? (
            <p className="text-sm">{format(m.placementTenantRoot)}</p>
          ) : (
            <>
              <ModeChoice
                legend={format(m.placementLegend)}
                value={mode}
                onChange={setMode}
                disabled={!editable}
                options={[
                  { value: 'unrestricted', label: format(m.placementAnywhere) },
                  { value: 'allow-list', label: format(m.placementListed) },
                ]}
                {...(dirty ? { hint: format(m.unsaved) } : {})}
              />
              {mode === 'allow-list' && (
                <PickGrid
                  legend={format(m.allowedOrgTypesLegend)}
                  emptyLabel={format(m.noOptions)}
                  disabled={!editable}
                  options={(catalog.data?.orgTypes ?? []).map((type) => ({
                    value: type.id,
                    label: type.name,
                  }))}
                  selected={orgTypeIds}
                  onChange={setOrgTypeIds}
                />
              )}
              {editable && (
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    // an allow-list naming nothing is not a policy, and the
                    // api says so; the button says so first
                    disabled={
                      !dirty ||
                      savePlacement.isPending ||
                      (mode === 'allow-list' && orgTypeIds.length === 0)
                    }
                    onClick={() => savePlacement.mutate(undefined as never)}
                  >
                    {format(m.save)}
                  </Button>
                  {dirty && (
                    <Button variant="ghost" size="sm" onClick={revert}>
                      {format(m.discard)}
                    </Button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </AsyncSection>

      {providers.isSuccess && (
        <DefRow
          label={format(m.signInLabel)}
          action={
            <PageLink page="auth/login-methods" className="text-xs font-medium hover:underline">
              {format(m.signInSettings)}
            </PageLink>
          }
        >
          {admitting.length === 0 ? (
            <span className="text-destructive">{format(m.signInNone)}</span>
          ) : (
            admitting.join('、')
          )}
        </DefRow>
      )}

      {roles.isSuccess && (
        <DefRow label={format(m.openRolesLabel)}>
          {openRoles.length === 0 ? format(m.openRolesNone) : openRoles.join('、')}
        </DefRow>
      )}

      <DefRow label={format(m.lifecycleLabel)}>
        <div className="flex min-w-0 flex-col gap-3">
          <Barred
            actions={[
              { label: format(m.disable), barred: populated },
              { label: format(m.delete), barred: populated || userType.isSystem },
            ]}
            {...(populated
              ? { reason: format(m.blockerInUse, { count: userType.userCount }) }
              : userType.isSystem
                ? { reason: format(m.blockerSystem) }
                : {})}
          />
          {canManage && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                // a populated type cannot be disabled at all: the api refuses
                // it, so offering the button would only produce an error
                disabled={setStatus.isPending || (userType.status === 'active' && populated)}
                onClick={() =>
                  setStatus.mutate(userType.status === 'active' ? 'disabled' : 'active')
                }
              >
                {format(userType.status === 'active' ? m.disable : m.enable)}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={populated || userType.isSystem}
                onClick={() => setConfirmingDelete(true)}
              >
                {format(m.delete)}
              </Button>
            </div>
          )}
        </div>
      </DefRow>

      <FormDialog
        open={renaming}
        title={format(m.rename)}
        onClose={() => setRenaming(false)}
        footer={
          <>
            <Button variant="outline" onClick={() => setRenaming(false)}>
              {format(m.cancel)}
            </Button>
            <Button
              type="submit"
              form="rename-user-type"
              disabled={saveProfile.isPending || name.trim() === ''}
            >
              {format(m.save)}
            </Button>
          </>
        }
      >
        <form
          id="rename-user-type"
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            saveProfile.mutate(undefined as never)
          }}
        >
          <Field label={format(m.nameLabel)}>
            {(id) => (
              <Input id={id} value={name} onChange={(event) => setName(event.target.value)} />
            )}
          </Field>
          <Field label={format(m.descriptionLabel)}>
            {(id) => (
              <Input
                id={id}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            )}
          </Field>
        </form>
      </FormDialog>

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
    </div>
  )
}
