import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useApiQuery, usePageQueryState } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import { Blank, EditorSkeleton, RailSkeleton, Screen } from '@qualy/ui/screen'
import { Button } from '@qualy/ui/button'
import { PlusIcon, UsersRoundIcon } from 'lucide-react'
import { cn } from '@qualy/ui/cn'
import { iamMessages as m } from '../i18n.ts'
import { UserTypeEditor } from './UserTypeEditor.tsx'
import { NewUserTypeForm } from './NewUserTypeForm.tsx'
import { authApi } from '../api.ts'

// User types: the placement policy and standing of a class of people. A
// handful of rows, so the list stays beside the one being edited; the
// selection lives in the query string so it stays linkable.
export default function UserTypesPage() {
  const orpc = useApiQuery(authApi)
  const { format, formatError } = useI18n()
  const [selected, setSelected] = usePageQueryState('type')
  const [creating, setCreating] = useState(false)

  const types = useQuery(orpc.identity.listUserTypes.queryOptions({}))
  const canManage = types.data?.capabilities.canManage ?? false
  const current = types.data?.userTypes.find((type) => type.id === selected)

  return (
    <Screen
      title={format(m.userTypesTitle)}
      description={format(m.userTypesHint)}
      actions={
        canManage && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <PlusIcon aria-hidden />
            {format(m.newUserType)}
          </Button>
        )
      }
    >
      <AsyncSection
        pending={types.isPending}
        error={types.isError ? formatError(types.error) : null}
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => void types.refetch()}
      >
        <div className="grid items-start gap-6 lg:grid-cols-[19rem_minmax(0,1fr)]">
          {(types.data?.userTypes ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">{format(m.userTypesEmpty)}</p>
          ) : (
            <div className="flex min-w-0 flex-col overflow-hidden rounded-lg border">
              {(types.data?.userTypes ?? []).map((type) => (
                <button
                  key={type.id}
                  type="button"
                  aria-current={type.id === selected}
                  className={cn(
                    'flex min-w-0 flex-col gap-0.5 border-t px-3 py-2.5 text-left first:border-t-0 hover:bg-accent/70',
                    type.id === selected && 'bg-accent',
                  )}
                  onClick={() => setSelected(type.id === selected ? '' : type.id)}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className={cn(
                        'min-w-0 truncate text-sm',
                        type.id === selected ? 'font-semibold' : 'font-medium',
                      )}
                    >
                      {type.name}
                    </span>
                    {type.isSystem && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {format(m.systemBadge)}
                      </span>
                    )}
                    {type.status === 'disabled' && (
                      <span className="shrink-0 text-xs text-destructive">
                        {format(m.disabledBadge)}
                      </span>
                    )}
                    <span className="flex-1" />
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {format(m.userCount, { count: type.userCount })}
                    </span>
                  </span>
                  <span
                    data-testid="type-summary"
                    data-users={String(type.userCount)}
                    data-placement={type.placementPolicy.mode}
                    className="min-w-0 truncate text-xs text-muted-foreground"
                  >
                    {type.placementPolicy.mode === 'allow-list'
                      ? format(m.placementCount, {
                          count: type.placementPolicy.orgTypeIds.length,
                        })
                      : format(
                          type.placementPolicy.mode === 'tenant-root'
                            ? m.placementTenantRoot
                            : m.placementUnrestricted,
                        )}
                  </span>
                </button>
              ))}
            </div>
          )}

          {current ? (
            <UserTypeEditor userType={current} canManage={canManage} />
          ) : (
            <Blank
              icon={<UsersRoundIcon />}
              title={format(m.pickTypeTitle)}
              description={format(m.pickTypeBody)}
            />
          )}
        </div>
      </AsyncSection>

      {canManage && (
        <NewUserTypeForm
          open={creating}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false)
            setSelected(id)
          }}
        />
      )}
    </Screen>
  )
}
