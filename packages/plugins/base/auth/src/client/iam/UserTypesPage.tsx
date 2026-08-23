import { useQuery } from '@tanstack/react-query'
import { useApiQuery, usePageQueryState } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, PageHeader } from '@qualy/ui/admin'
import { PageContainer } from '@qualy/ui/page-container'
import { Card, CardContent } from '@qualy/ui/card'
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

  const types = useQuery(orpc.identity.listUserTypes.queryOptions({}))
  const canManage = types.data?.capabilities.canManage ?? false
  const current = types.data?.userTypes.find((type) => type.id === selected)

  return (
    <PageContainer size="wide" className="space-y-5">
      <PageHeader title={format(m.userTypesTitle)} description={format(m.userTypesHint)} />
      <AsyncSection
        pending={types.isPending}
        error={types.isError ? formatError(types.error) : null}
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => void types.refetch()}
      >
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <Card className="lg:sticky lg:top-20">
            <CardContent className="pt-5">
              {(types.data?.userTypes ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">{format(m.userTypesEmpty)}</p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {(types.data?.userTypes ?? []).map((type) => (
                    <li key={type.id}>
                      <button
                        type="button"
                        aria-current={type.id === selected}
                        className={cn(
                          'flex w-full flex-col items-start gap-0.5 rounded-md px-2.5 py-2 text-left hover:bg-accent',
                          type.id === selected && 'bg-accent',
                        )}
                        onClick={() => setSelected(type.id === selected ? '' : type.id)}
                      >
                        <span className="text-sm font-medium">
                          {type.name}
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            {type.code}
                          </span>
                          {type.isSystem && (
                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                              {format(m.systemBadge)}
                            </span>
                          )}
                          {type.status === 'disabled' && (
                            <span className="ml-2 text-xs font-normal text-destructive">
                              {format(m.disabledBadge)}
                            </span>
                          )}
                        </span>
                        <span
                          data-testid="type-summary"
                          data-users={String(type.userCount)}
                          data-placement={type.placementPolicy.mode}
                          className="text-xs text-muted-foreground"
                        >
                          {format(m.userCount, { count: type.userCount })}
                          {` · ${
                            type.placementPolicy.mode === 'allow-list'
                              ? format(m.placementCount, {
                                  count: type.placementPolicy.orgTypeIds.length,
                                })
                              : format(
                                  type.placementPolicy.mode === 'tenant-root'
                                    ? m.placementTenantRoot
                                    : m.placementUnrestricted,
                                )
                          }`}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <div className="space-y-4">
            {current ? (
              <UserTypeEditor userType={current} canManage={canManage} />
            ) : (
              <Card>
                <CardContent className="pt-6 text-sm text-muted-foreground">
                  {format(m.userTypeSelectHint)}
                </CardContent>
              </Card>
            )}
            {canManage && <NewUserTypeForm onCreated={setSelected} />}
          </div>
        </div>
      </AsyncSection>
    </PageContainer>
  )
}
