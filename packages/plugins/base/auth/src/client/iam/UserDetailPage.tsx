import type { Effect } from 'effect'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { ChevronLeftIcon, KeyRoundIcon } from 'lucide-react'
import { PageLink, useApi, useRunApi, useApiQuery, usePageRouteParams } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, ConfirmDialog, Feedback, Field, FormDialog } from '@qualy/ui/admin'
import { Blank, EditorSkeleton, SectionHead, Segmented } from '@qualy/ui/screen'
import { PageContainer } from '@qualy/ui/page-container'
import { Avatar, AvatarFallback } from '@qualy/ui/avatar'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import { Stagger } from '@qualy/ui/reveal'
import { initialsOf } from '@qualy/ui/person'
import { cn } from '@qualy/ui/cn'
import { iamMessages as m } from '../i18n.ts'
import { NodePicker } from './NodePicker.tsx'
import { UserGrants } from './UserGrants.tsx'
import { authApi } from '../api.ts'

// One person, in full. The header carries who they are and the three things
// worth doing to them; the tabs carry the two questions somebody arrives
// with - can they get in, and what have they been given.
//
// The id comes from the route, typed by the page reference that declared the
// `:userId` segment.
export default function UserDetailPage() {
  const { userId } = usePageRouteParams('userId')
  const api = useApi(authApi)
  const runApi = useRunApi()
  const orpc = useApiQuery(authApi)
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  const [tab, setTab] = useState<'identities' | 'roles'>('identities')
  const [feedback, setFeedback] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [editing, setEditing] = useState(false)
  const [moving, setMoving] = useState(false)
  const [confirmingDisable, setConfirmingDisable] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [businessNo, setBusinessNo] = useState('')
  const [userTypeId, setUserTypeId] = useState('')
  const [placement, setPlacement] = useState('')

  const user = useQuery(orpc.identity.getUser.queryOptions({ params: { userId } }))
  const options = useQuery(orpc.identity.getUserOptions.queryOptions({ query: {} }))
  const record = user.data?.user

  // a different person is a different form, so the draft re-seeds when the
  // record changes or when a save brings back new server state
  useEffect(() => {
    if (!record) return
    setDisplayName(record.displayName)
    setBusinessNo(record.businessNo ?? '')
    setUserTypeId(record.userType?.id ?? '')
    setPlacement(record.primaryOrgNode?.id ?? '')
    setFeedback(null)
    setSaved(false)
  }, [record])

  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.identity.key() })
  // the one crossing from an effect to a promise on this screen: TanStack
  // needs a promise, and doing so here keeps every call site an effect
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
      api.identity.updateUser({
        params: { userId },
        payload: {
          version: record?.version ?? 1,
          displayName,
          userTypeId,
          businessNo: businessNo.trim() === '' ? undefined : businessNo.trim(),
        },
      }),
    ),
    onSuccess: async () => {
      setEditing(false)
      setSaved(true)
      await refresh()
    },
  })
  const transfer = useMutation({
    ...run(() =>
      api.identity.setUserPlacement({
        params: { userId },
        payload: { primaryOrgNodeId: placement, version: record?.version ?? 1 },
      }),
    ),
    onSuccess: async () => {
      setMoving(false)
      setSaved(true)
      await refresh()
    },
  })
  const setStatus = useMutation({
    ...run((status: 'active' | 'disabled' | 'deleted') =>
      api.identity.setUserStatus({
        params: { userId },
        payload: { status, version: record?.version ?? 1 },
      }),
    ),
    onSuccess: async () => {
      setConfirmingDisable(false)
      setConfirmingDelete(false)
      setSaved(true)
      await refresh()
    },
  })

  const manageable = record?.manageable ?? false
  const nodes = options.data?.nodes ?? []
  const userTypes = options.data?.userTypes ?? []
  const identities = user.data?.identities ?? []

  return (
    <PageContainer size="default" className="flex flex-col gap-5">
      <p className="text-sm">
        <PageLink
          page="auth/users"
          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
        >
          <ChevronLeftIcon className="size-3.5" aria-hidden />
          {format(m.backToUsers)}
        </PageLink>
      </p>

      <AsyncSection
        pending={user.isPending}
        error={user.isError ? formatError(user.error) : null}
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => void user.refetch()}
        skeleton={<EditorSkeleton />}
      >
        {record && (
          <div className="flex flex-col gap-5">
            {/* who somebody is, before what may be done to them */}
            <div className="flex flex-wrap items-center gap-4 border-b pb-5">
              <Avatar className="size-12 rounded-xl">
                <AvatarFallback className="rounded-xl bg-primary text-sm font-medium text-primary-foreground">
                  {initialsOf(record.displayName)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="flex flex-wrap items-center gap-2 text-lg font-semibold">
                  {record.displayName}
                  {record.status === 'deleted' ? (
                    <Badge variant="outline">{format(m.deletedBadge)}</Badge>
                  ) : record.status === 'disabled' ? (
                    <Badge variant="destructive">{format(m.disabledBadge)}</Badge>
                  ) : (
                    <Badge variant="secondary">{format(m.statusActive)}</Badge>
                  )}
                </p>
                <p className="flex min-w-0 flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
                  {record.businessNo && <span className="tabular-nums">{record.businessNo}</span>}
                  <span>{record.userType?.name ?? '—'}</span>
                  <span className="min-w-0 truncate">
                    {(user.data?.orgPath ?? []).map((node) => node.name).join(' / ')}
                  </span>
                </p>
              </div>
              {record.status === 'deleted' ? (
                // what comes back is the person, disabled: access is a
                // second, explicit act
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  disabled={setStatus.isPending}
                  onClick={() => setStatus.mutate('disabled')}
                >
                  {format(m.restoreAction)}
                </Button>
              ) : (
                manageable && (
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                      {format(m.editProfile)}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setMoving(true)}>
                      {format(m.moveLabel)}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={setStatus.isPending}
                      onClick={() =>
                        record.status === 'active'
                          ? setConfirmingDisable(true)
                          : setStatus.mutate('active')
                      }
                    >
                      {format(record.status === 'active' ? m.disable : m.enable)}
                    </Button>
                    {record.status === 'disabled' && (
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={setStatus.isPending}
                        onClick={() => setConfirmingDelete(true)}
                      >
                        {format(m.deleteAction)}
                      </Button>
                    )}
                  </div>
                )
              )}
            </div>

            <Feedback message={feedback} />
            {saved && feedback === null && <Feedback message={format(m.saved)} tone="success" />}

            <Segmented
              label={format(m.userDetailTitle)}
              value={tab}
              onChange={setTab}
              options={[
                { value: 'identities', label: format(m.profileTabIdentities) },
                { value: 'roles', label: format(m.profileTabRoles) },
              ]}
            />

            {tab === 'identities' && (
              <div className="flex min-w-0 flex-col gap-3">
                <SectionHead
                  title={format(m.boundHeading)}
                  count={format(m.boundCount, { count: identities.length })}
                  actions={
                    <PageLink
                      page="auth/login-methods"
                      className="text-xs font-medium hover:underline"
                      unavailable={null}
                    >
                      {format(m.manageWaysIn)}
                    </PageLink>
                  }
                />
                {identities.length === 0 ? (
                  <Blank
                    icon={<KeyRoundIcon />}
                    title={format(m.boundEmptyTitle)}
                    description={format(m.boundEmptyBody)}
                    className="min-h-[14rem]"
                  />
                ) : (
                  <Stagger className="min-w-0 divide-y overflow-hidden rounded-lg border">
                    {identities.map((identity) => (
                      <div
                        key={identity.id}
                        data-entrance-status={identity.providerStatus}
                        className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-4 px-4 py-3"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="min-w-0 truncate text-sm font-medium">
                            {identity.providerName}
                          </span>
                          <Badge variant="secondary" className="shrink-0">
                            {format(identity.hasCredential ? m.localAccount : m.federatedAccount)}
                          </Badge>
                          {identity.providerStatus === 'disabled' && (
                            <Badge variant="destructive" className="shrink-0">
                              {format(m.entranceDisabled)}
                            </Badge>
                          )}
                        </span>
                        <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                          {identity.identifier}
                        </span>
                        <span
                          className={cn(
                            'shrink-0 text-xs text-muted-foreground',
                            identity.lastUsedAt === null && 'text-destructive',
                          )}
                        >
                          {identity.lastUsedAt === null
                            ? format(m.neverUsed)
                            : format(m.lastUsed, {
                                when: new Date(identity.lastUsedAt).toLocaleDateString(),
                              })}
                        </span>
                      </div>
                    ))}
                  </Stagger>
                )}
              </div>
            )}

            {tab === 'roles' && <UserGrants userId={userId} nodes={nodes} />}

            <FormDialog
              open={editing}
              title={format(m.editProfile)}
              onClose={() => setEditing(false)}
              footer={
                <>
                  <Button variant="outline" onClick={() => setEditing(false)}>
                    {format(m.cancel)}
                  </Button>
                  <Button
                    type="submit"
                    form="edit-profile"
                    disabled={saveProfile.isPending || displayName.trim() === ''}
                  >
                    {format(m.save)}
                  </Button>
                </>
              }
            >
              <form
                id="edit-profile"
                className="flex flex-col gap-4"
                onSubmit={(event) => {
                  event.preventDefault()
                  saveProfile.mutate(undefined as never)
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

            <FormDialog
              open={moving}
              title={format(m.moveLabel)}
              onClose={() => setMoving(false)}
              footer={
                <>
                  <Button variant="outline" onClick={() => setMoving(false)}>
                    {format(m.cancel)}
                  </Button>
                  <Button
                    disabled={transfer.isPending || placement === record.primaryOrgNode?.id}
                    onClick={() => transfer.mutate(undefined as never)}
                  >
                    {format(m.moveAction)}
                  </Button>
                </>
              }
            >
              <Field label={format(m.anchorLabel)}>
                {(id) => (
                  <NodePicker
                    id={id}
                    label={format(m.anchorLabel)}
                    nodes={nodes}
                    value={placement}
                    onChange={setPlacement}
                    placeholder={format(m.movePick)}
                  />
                )}
              </Field>
            </FormDialog>

            <ConfirmDialog
              open={confirmingDisable}
              title={format(m.confirmDisableTitle)}
              description={format(m.confirmDisableBody)}
              confirmLabel={format(m.disable)}
              cancelLabel={format(m.cancel)}
              pending={setStatus.isPending}
              onConfirm={() => setStatus.mutate('disabled')}
              onCancel={() => setConfirmingDisable(false)}
            />

            <ConfirmDialog
              open={confirmingDelete}
              title={format(m.confirmUserDeleteTitle)}
              description={format(m.confirmUserDeleteBody)}
              confirmLabel={format(m.deleteAction)}
              cancelLabel={format(m.cancel)}
              pending={setStatus.isPending}
              onConfirm={() => setStatus.mutate('deleted')}
              onCancel={() => setConfirmingDelete(false)}
            />
          </div>
        )}
      </AsyncSection>
    </PageContainer>
  )
}
