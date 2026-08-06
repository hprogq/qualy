import type { Effect } from 'effect'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import {
  PageLink,
  useApi, useRunApi,
  useApiQuery,
  usePageRouteParams,
} from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, ConfirmDialog, Feedback, Field, Panel } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { userDetailPage, usersPage } from '../../src/ui.ts'
import { iamMessages as m } from '../i18n.ts'
import { UserGrants } from './UserGrants.tsx'

// One person: their profile, where they stand, whether they may sign in, and
// which roles they hold. The id comes from the route, typed by the page
// reference that declared the `:userId` segment.
export default function UserDetailPage() {
  const { userId } = usePageRouteParams(userDetailPage)
  const api = useApi()
  const runApi = useRunApi()
  const orpc = useApiQuery()
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  const [feedback, setFeedback] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [confirmingDisable, setConfirmingDisable] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [businessNo, setBusinessNo] = useState('')
  const [userTypeId, setUserTypeId] = useState('')
  const [placement, setPlacement] = useState('')

  const user = useQuery(orpc.identity.getUser.queryOptions({ params: { userId } }))
  const options = useQuery(orpc.identity.getUserOptions.queryOptions({ query: {} }))
  const record = user.data?.user

  useEffect(() => {
    if (!record) return
    setDisplayName(record.displayName)
    setBusinessNo(record.businessNo ?? '')
    setUserTypeId(record.userType.id)
    setPlacement(record.primaryOrgNode.id)
    setFeedback(null)
    setSaved(false)
  }, [record])

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
      api.identity.updateUser({ params: { userId }, payload: { displayName, userTypeId, businessNo: businessNo.trim() === '' ? undefined : businessNo.trim() } }),
    ),
  )
  const transfer = useMutation(
    run(() => api.identity.setUserPlacement({ params: { userId }, payload: { primaryOrgNodeId: placement } })),
  )
  const setStatus = useMutation({
    ...run((status: 'active' | 'disabled') => api.identity.setUserStatus({ params: { userId }, payload: { status } })),
    onSuccess: async () => {
      setConfirmingDisable(false)
      setSaved(true)
      await refresh()
    },
  })

  const manageable = record?.manageable ?? false
  const nodes = options.data?.nodes ?? []
  const userTypes = options.data?.userTypes ?? []

  return (
    <div className="space-y-4 p-4">
      <p className="text-sm">
        <PageLink page={usersPage}>{format(m.backToUsers)}</PageLink>
      </p>
      <AsyncSection
        pending={user.isPending}
        error={user.isError ? formatError(user.error) : null}
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => void user.refetch()}
      >
        {record && (
          <div className="space-y-4">
            <Panel
              title={`${format(m.userDetailTitle)} · ${record.displayName}`}

              actions={
                manageable ? (
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
                      value={displayName}
                      disabled={!manageable}
                      onChange={(event) => setDisplayName(event.target.value)}
                    />
                  )}
                </Field>
                <Field label={format(m.businessNoLabel)}>
                  {(id) => (
                    <Input
                      id={id}
                      value={businessNo}
                      disabled={!manageable}
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
                      disabled={!manageable}
                      onChange={(event) => setUserTypeId(event.target.value)}
                    >
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
                  disabled={!manageable || saveProfile.isPending || displayName.trim() === ''}
                >
                  {format(m.save)}
                </Button>
              </form>
            </Panel>

            <Panel title={format(m.placementSection)} description={record.primaryOrgNode.name}>
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  transfer.mutate(undefined as never)
                }}
              >
                <Field label={format(m.anchorLabel)}>
                  {(id) => (
                    <select
                      id={id}
                      className="h-9 rounded-md border bg-transparent px-2 text-sm"
                      value={placement}
                      disabled={!manageable}
                      onChange={(event) => setPlacement(event.target.value)}
                    >
                      <option value={record.primaryOrgNode.id}>
                        {record.primaryOrgNode.name}
                      </option>
                      {nodes
                        .filter(
                          (entry) =>
                            entry.manageable && entry.orgNodeId !== record.primaryOrgNode.id,
                        )
                        .map((entry) => (
                          <option key={entry.orgNodeId} value={entry.orgNodeId}>
                            {entry.name}
                          </option>
                        ))}
                    </select>
                  )}
                </Field>
                <Button
                  size="sm"
                  type="submit"
                  disabled={
                    !manageable || transfer.isPending || placement === record.primaryOrgNode.id
                  }
                >
                  {format(m.transfer)}
                </Button>
              </form>
            </Panel>

            <UserGrants userId={userId} nodes={options.data?.nodes ?? []} />

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
          </div>
        )}
      </AsyncSection>
    </div>
  )
}
