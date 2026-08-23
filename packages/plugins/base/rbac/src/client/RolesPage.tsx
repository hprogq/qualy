import { useQuery } from '@tanstack/react-query'
import { useApiQuery, usePageQueryState } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, PageHeader } from '@qualy/ui/admin'
import { PageContainer } from '@qualy/ui/page-container'
import { Card, CardContent } from '@qualy/ui/card'
import { cn } from '@qualy/ui/cn'
import { rbacMessages as m } from './i18n.ts'
import { RoleEditor, type RoleRow } from './RoleEditor.tsx'
import { NewRoleForm } from './NewRoleForm.tsx'
import { accessApi } from './api.ts'

// Roles and what they may hold, grouped the way they take effect: a
// tenant-wide role acts everywhere the moment it is granted, a per-unit role
// waits to be anchored somewhere. The selected role lives in the query
// string rather than in component state, so a role is linkable and survives
// a reload.
export default function RolesPage() {
  const orpc = useApiQuery(accessApi)
  const { format, formatError } = useI18n()
  const [selected, setSelected] = usePageQueryState('role')

  const roles = useQuery(orpc.access.listRoles.queryOptions({ query: {} }))
  const canManage = roles.data?.capabilities.canManage ?? false
  const all = roles.data?.roles ?? []
  const current = all.find((role) => role.id === selected)
  const groups: { key: string; title: string; hint: string; rows: RoleRow[] }[] = [
    {
      key: 'tenant',
      title: format(m.tenantGroup),
      hint: format(m.tenantGroupHint),
      rows: all.filter((role) => role.kind === 'tenant'),
    },
    {
      key: 'org',
      title: format(m.orgGroup),
      hint: format(m.orgGroupHint),
      rows: all.filter((role) => role.kind === 'org'),
    },
  ]

  return (
    <PageContainer size="wide" className="space-y-5">
      <PageHeader title={format(m.rolesTitle)} description={format(m.rolesHint)} />
      <AsyncSection
        pending={roles.isPending}
        error={roles.isError ? formatError(roles.error) : null}
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => void roles.refetch()}
      >
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <Card className="lg:sticky lg:top-20">
            <CardContent className="space-y-4 pt-5">
              {all.length === 0 ? (
                <p className="text-sm text-muted-foreground">{format(m.rolesEmpty)}</p>
              ) : (
                groups
                  .filter((group) => group.rows.length > 0)
                  .map((group) => (
                    <section key={group.key} className="space-y-1">
                      <h3 className="flex items-baseline gap-2 px-2.5 text-xs font-medium">
                        {group.title}
                        <span className="font-normal text-muted-foreground">{group.hint}</span>
                      </h3>
                      <ul className="flex flex-col gap-0.5">
                        {group.rows.map((role) => (
                          <li key={role.id}>
                            <button
                              type="button"
                              aria-current={role.id === selected}
                              className={cn(
                                'flex w-full flex-col items-start gap-0.5 rounded-md px-2.5 py-2 text-left hover:bg-accent',
                                role.id === selected && 'bg-accent',
                              )}
                              onClick={() => setSelected(role.id === selected ? '' : role.id)}
                            >
                              <span className="text-sm font-medium">
                                {role.name}
                                <span className="ml-2 text-xs font-normal text-muted-foreground">
                                  {role.code}
                                </span>
                                {role.systemKey !== null && (
                                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                                    {format(m.systemBadge)}
                                  </span>
                                )}
                                {role.status === 'draft' && (
                                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                                    {format(m.draftBadge)}
                                  </span>
                                )}
                                {role.status === 'disabled' && (
                                  <span className="ml-2 text-xs font-normal text-destructive">
                                    {format(m.disabledBadge)}
                                  </span>
                                )}
                                {!role.assignable && (
                                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                                    {format(m.unassignableBadge)}
                                  </span>
                                )}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {format(m.assignmentCount, { count: role.grantCount })}
                                {role.permissions.length > 0 &&
                                  ` · ${format(m.permissionCount, { count: role.permissions.length })}`}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))
              )}
            </CardContent>
          </Card>

          <div className="space-y-4">
            {current ? (
              <RoleEditor role={current} canManage={canManage} />
            ) : (
              <Card>
                <CardContent className="pt-6 text-sm text-muted-foreground">
                  {format(m.roleSelectHint)}
                </CardContent>
              </Card>
            )}
            {canManage && <NewRoleForm onCreated={setSelected} />}
          </div>
        </div>
      </AsyncSection>
    </PageContainer>
  )
}
