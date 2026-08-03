import { useQuery } from '@tanstack/react-query'
import { useApiQuery, usePageQueryState } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, Panel } from '@qualy/ui/admin'
import { iamMessages as m } from '../i18n.ts'
import { UserTypeEditor } from './UserTypeEditor.tsx'
import { NewUserTypeForm } from './NewUserTypeForm.tsx'

// User types: the sign-in policy and tenant-wide grants of a class of
// people. A handful of rows, so the selected one is edited on the same
// screen; the selection lives in the query string so it stays linkable.
export default function UserTypesPage() {
  const orpc = useApiQuery()
  const { format, formatError } = useI18n()
  const [selected, setSelected] = usePageQueryState('type')

  const types = useQuery(orpc.identity.listUserTypes.queryOptions())
  const canManage = types.data?.capabilities.canManage ?? false
  const current = types.data?.userTypes.find((type) => type.id === selected)

  return (
    <div className="space-y-4 p-4">
      <Panel title={format(m.userTypesTitle)} description={format(m.userTypesHint)}>
        <AsyncSection
          pending={types.isPending}
          error={types.isError ? formatError(types.error) : null}
          loadingLabel={format(commonMessages.loading)}
          retryLabel={format(commonMessages.retry)}
          onRetry={() => void types.refetch()}
        >
          {(types.data?.userTypes ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">{format(m.userTypesEmpty)}</p>
          ) : (
            <ul className="divide-y">
              {(types.data?.userTypes ?? []).map((type) => (
                <li key={type.id}>
                  <button
                    type="button"
                    aria-current={type.id === selected}
                    className="flex w-full flex-col items-start gap-0.5 py-2 text-left hover:bg-muted/50"
                    onClick={() => setSelected(type.id === selected ? '' : type.id)}
                  >
                    <span className="text-sm font-medium">
                      {type.name}
                      <span className="ml-2 text-xs text-muted-foreground">{type.code}</span>
                      {type.isSystem && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {format(m.systemBadge)}
                        </span>
                      )}
                      {type.status === 'disabled' && (
                        <span className="ml-2 text-xs text-destructive">
                          {format(m.disabledBadge)}
                        </span>
                      )}
                      {/* a type that opens no channel is one nobody can sign
                          in with, which is worth saying on the row itself */}
                      {!type.allowLocalLogin && !type.allowSsoLogin && (
                        <span className="ml-2 text-xs text-destructive">
                          {format(m.noLoginBadge)}
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">
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
        </AsyncSection>
      </Panel>

      {current && <UserTypeEditor userType={current} canManage={canManage} />}
      {canManage && <NewUserTypeForm onCreated={setSelected} />}
    </div>
  )
}
