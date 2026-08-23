import { useQuery } from '@tanstack/react-query'
import { useApiQuery, usePageQueryState } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { useState } from 'react'
import { PlusIcon } from 'lucide-react'
import { AsyncSection } from '@qualy/ui/admin'
import { Screen } from '@qualy/ui/screen'
import { Button } from '@qualy/ui/button'
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
  const [creating, setCreating] = useState(false)

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
    <Screen
      title={format(m.rolesTitle)}
      description={format(m.rolesHint)}
      actions={
        canManage && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <PlusIcon aria-hidden />
            {format(m.newRole)}
          </Button>
        )
      }
    >
      <AsyncSection
        pending={roles.isPending}
        error={roles.isError ? formatError(roles.error) : null}
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => void roles.refetch()}
      >
        <div className="grid items-start gap-6 lg:grid-cols-[19rem_minmax(0,1fr)]">
          {all.length === 0 ? (
            <p className="text-sm text-muted-foreground">{format(m.rolesEmpty)}</p>
          ) : (
            <div className="flex min-w-0 flex-col gap-4">
              {groups
                .filter((group) => group.rows.length > 0)
                .map((group) => (
                  <section key={group.key} className="flex min-w-0 flex-col gap-1.5">
                    <h2 className="flex items-baseline gap-2 text-xs font-medium">
                      {group.title}
                      <span className="font-normal text-muted-foreground">{group.hint}</span>
                    </h2>
                    <div className="flex min-w-0 flex-col overflow-hidden rounded-lg border">
                      {group.rows.map((role) => (
                        <button
                          key={role.id}
                          type="button"
                          aria-current={role.id === selected}
                          className={cn(
                            'flex min-w-0 flex-col gap-0.5 border-t px-3 py-2.5 text-left first:border-t-0 hover:bg-accent/70',
                            role.id === selected && 'bg-accent',
                          )}
                          onClick={() => setSelected(role.id === selected ? '' : role.id)}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <span
                              className={cn(
                                'min-w-0 truncate text-sm',
                                role.id === selected ? 'font-semibold' : 'font-medium',
                              )}
                            >
                              {role.name}
                            </span>
                            {role.systemKey !== null && (
                              <span className="shrink-0 text-xs text-muted-foreground">
                                {format(m.systemBadge)}
                              </span>
                            )}
                            {role.status === 'draft' && (
                              <span className="shrink-0 text-xs text-muted-foreground">
                                {format(m.draftBadge)}
                              </span>
                            )}
                            {role.status === 'disabled' && (
                              <span className="shrink-0 text-xs text-destructive">
                                {format(m.disabledBadge)}
                              </span>
                            )}
                            {!role.assignable && (
                              <span className="shrink-0 text-xs text-muted-foreground">
                                {format(m.unassignableBadge)}
                              </span>
                            )}
                            <span className="flex-1" />
                            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                              {format(m.assignmentCount, { count: role.grantCount })}
                            </span>
                          </span>
                          <span className="min-w-0 truncate text-xs text-muted-foreground">
                            {format(m.permissionCount, { count: role.permissions.length })}
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
            </div>
          )}

          {current ? (
            <RoleEditor role={current} canManage={canManage} />
          ) : (
            <p className="text-sm text-muted-foreground">{format(m.roleSelectHint)}</p>
          )}
        </div>
      </AsyncSection>

      {canManage && (
        <NewRoleForm
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
