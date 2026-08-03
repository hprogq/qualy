import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { PageLink, useApiQuery, usePageQueryState } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, Feedback, Field, Panel } from '@qualy/ui/admin'
import { Input } from '@qualy/ui/input'
import { Label } from '@qualy/ui/label'
import { userDetailPage } from '../../src/ui.ts'
import { iamMessages as m } from '../i18n.ts'
import { NewUserForm } from './NewUserForm.tsx'

// Users are administered where they stand, so the screen is anchored on one
// of the caller's own authorization anchors. The anchor, the scope and the
// search term live in the query string: this is exactly the state someone
// wants back after a reload or in a link sent to a colleague.
export default function UsersPage() {
  const orpc = useApiQuery()
  const { format, formatError } = useI18n()
  const [anchor, setAnchor] = usePageQueryState('anchor')
  const [scope, setScope] = usePageQueryState('scope', 'subtree')
  const [search, setSearch] = usePageQueryState('q')
  const [draft, setDraft] = useState(search)

  // one call gives both the anchors this caller may use and the types they
  // may hand out, so the screen needs no permission beyond its own
  const options = useQuery(orpc.identity.getUserOptions.queryOptions({ input: {} }))
  const anchors = options.data?.nodes ?? []
  const active = anchors.find((entry) => entry.orgNodeId === anchor) ?? anchors[0]

  // typing should not fire a request per keystroke
  useEffect(() => {
    const timer = setTimeout(() => setSearch(draft), 300)
    return () => clearTimeout(timer)
  }, [draft, setSearch])

  const users = useQuery({
    ...orpc.identity.listUsers.queryOptions({
      input: {
        orgNodeId: active?.orgNodeId ?? '',
        scope: scope === 'self' ? ('self' as const) : ('subtree' as const),
        search: search || undefined,
      },
    }),
    enabled: active !== undefined,
  })

  return (
    <div className="space-y-4 p-4">
      <Panel
        title={format(m.usersTitle)}
        description={format(m.usersHint)}
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <Field label={format(m.anchorLabel)}>
              {(id) => (
                <select
                  id={id}
                  className="h-9 rounded-md border bg-transparent px-2 text-sm"
                  value={active?.orgNodeId ?? ''}
                  onChange={(event) => setAnchor(event.target.value)}
                >
                  {anchors.map((entry) => (
                    <option key={entry.orgNodeId} value={entry.orgNodeId}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Label className="flex h-9 items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={scope !== 'self'}
                // a self anchor covers one node, so a subtree request from it
                // returns that node alone; the server intersects either way
                onChange={(event) => setScope(event.target.checked ? 'subtree' : 'self')}
              />
              {format(m.scopeLabel)}
            </Label>
            <Field label={format(m.searchPlaceholder)}>
              {(id) => (
                <Input
                  id={id}
                  className="w-40"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                />
              )}
            </Field>
          </div>
        }
      >
        {options.isError && <Feedback message={formatError(options.error)} />}
        {!options.isPending && anchors.length === 0 ? (
          <p className="text-sm text-muted-foreground">{format(m.noAnchors)}</p>
        ) : (
          <AsyncSection
            pending={options.isPending || (users.isPending && active !== undefined)}
            error={users.isError ? formatError(users.error) : null}
            loadingLabel={format(commonMessages.loading)}
            retryLabel={format(commonMessages.retry)}
            onRetry={() => void users.refetch()}
          >
            {(users.data?.items ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">{format(m.usersEmpty)}</p>
            ) : (
              <ul className="divide-y">
                {(users.data?.items ?? []).map((user) => (
                  <li key={user.id} className="flex items-center justify-between gap-4 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        <PageLink page={userDetailPage} params={{ userId: user.id }}>
                          {user.displayName}
                        </PageLink>
                        {user.businessNo && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {user.businessNo}
                          </span>
                        )}
                        {user.status === 'disabled' && (
                          <span className="ml-2 text-xs text-destructive">
                            {format(m.disabledBadge)}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {user.userType.name} · {user.primaryOrgNode.name}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {/* the page says when it is not the whole answer, rather than
                truncating in silence the way a bare limit did */}
            {users.data?.nextCursor && (
              <p className="text-xs text-muted-foreground">{format(commonMessages.moreResults)}</p>
            )}
          </AsyncSection>
        )}
      </Panel>

      {active?.manageable && (
        // only the kinds of person this node may hold: the api refuses the
        // rest, and a picker offering them turns a rule into an error message
        <NewUserForm
          orgNodeId={active.orgNodeId}
          userTypes={(options.data?.userTypes ?? []).filter(
            (type) =>
              type.placementPolicy.mode === 'unrestricted' ||
              type.placementPolicy.orgTypeIds.includes(active.orgTypeId),
          )}
        />
      )}
    </div>
  )
}
