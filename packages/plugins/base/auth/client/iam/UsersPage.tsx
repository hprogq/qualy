import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useApi, useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { Label } from '@qualy/ui/label'
import { iamMessages as m } from '../i18n.ts'
import { AdminPanel, Feedback, QueryState } from './shared.tsx'

// users are administered where they stand, so the screen is anchored on an
// org node: the tree the caller may read decides which anchors exist, and
// the api authorizes at whichever one is chosen
export default function UsersPage() {
  const api = useApi()
  const orpc = useApiQuery()
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  const [feedback, setFeedback] = useState<string | null>(null)
  const [anchor, setAnchor] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [userTypeId, setUserTypeId] = useState('')

  const tree = useQuery(orpc.org.getTree.queryOptions({ input: {} }))
  const types = useQuery(orpc.iam.listUserTypes.queryOptions())
  const nodes = tree.data?.nodes ?? []
  // the first visible root is the default anchor
  const activeAnchor = anchor ?? tree.data?.roots[0] ?? null
  const users = useQuery({
    ...orpc.iam.listUsers.queryOptions({
      input: { orgNodeId: activeAnchor ?? '', subtree: true, search: search || undefined },
    }),
    enabled: activeAnchor !== null,
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.iam.key() })
  const onError = (error: unknown) => setFeedback(formatError(error))
  const create = useMutation({
    mutationFn: () =>
      api.iam.createUser({
        displayName,
        userTypeId,
        primaryOrgNodeId: activeAnchor!,
      }),
    onSuccess: () => {
      setFeedback(null)
      setDisplayName('')
      return refresh()
    },
    onError,
  })
  const setEnabled = useMutation({
    mutationFn: (input: { userId: string; enabled: boolean }) => api.iam.setUserEnabled(input),
    onSuccess: () => {
      setFeedback(null)
      return refresh()
    },
    onError,
  })

  return (
    <div className="space-y-4 p-4">
      <Feedback message={feedback} />
      <AdminPanel
        title={format(m.usersTitle)}
        actions={
          <div className="flex items-center gap-2">
            <Label htmlFor="users-anchor" className="text-xs">
              {format(m.anchorLabel)}
            </Label>
            <select
              id="users-anchor"
              className="h-8 rounded-md border bg-transparent px-2 text-sm"
              value={activeAnchor ?? ''}
              onChange={(event) => setAnchor(event.target.value)}
            >
              {nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name}
                </option>
              ))}
            </select>
            <Input
              className="h-8 w-40"
              placeholder={format(m.searchPlaceholder)}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        }
      >
        <QueryState
          pending={users.isPending && activeAnchor !== null}
          error={users.isError ? users.error : null}
          onRetry={() => void users.refetch()}
        >
          {(users.data?.users ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">{format(m.usersEmpty)}</p>
          ) : (
            <ul className="divide-y">
              {(users.data?.users ?? []).map((user) => (
                <li key={user.id} className="flex items-center justify-between gap-4 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {user.displayName}
                      {user.businessNo && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {user.businessNo}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {user.userType.name} · {user.primaryOrgNode.name}
                      {!user.enabled && ` · ${format(m.disabledBadge)}`}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={setEnabled.isPending}
                    onClick={() => setEnabled.mutate({ userId: user.id, enabled: !user.enabled })}
                  >
                    {format(user.enabled ? m.disable : m.enable)}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </AdminPanel>

      <AdminPanel title={format(m.newUser)}>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="user-name">{format(m.nameLabel)}</Label>
            <Input
              id="user-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="user-type">{format(m.userTypeLabel)}</Label>
            <select
              id="user-type"
              className="h-9 rounded-md border bg-transparent px-2 text-sm"
              value={userTypeId}
              onChange={(event) => setUserTypeId(event.target.value)}
            >
              <option value="">{format(m.selectUserType)}</option>
              {(types.data?.userTypes ?? [])
                .filter((type) => type.enabled)
                .map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
            </select>
          </div>
          <Button
            size="sm"
            disabled={
              create.isPending ||
              activeAnchor === null ||
              displayName.trim() === '' ||
              userTypeId === ''
            }
            onClick={() => create.mutate()}
          >
            {format(m.create)}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{format(m.newUserHint)}</p>
      </AdminPanel>
    </div>
  )
}
