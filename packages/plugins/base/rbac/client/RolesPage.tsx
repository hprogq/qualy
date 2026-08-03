import { useQuery } from '@tanstack/react-query'
import { useApiQuery, usePageQueryState } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, Panel } from '@qualy/ui/admin'
import { rbacMessages as m } from './i18n.ts'
import { RoleEditor } from './RoleEditor.tsx'
import { NewRoleForm } from './NewRoleForm.tsx'

// Roles and what they may hold. The selected role lives in the query string
// rather than in component state, so a role is linkable and survives a
// reload; there is no separate route because this catalog is small enough
// that master and detail belong on one screen.
export default function RolesPage() {
  const orpc = useApiQuery()
  const { format, formatError } = useI18n()
  const [selected, setSelected] = usePageQueryState('role')

  const roles = useQuery(orpc.access.listRoles.queryOptions({ input: {} }))
  const canManage = roles.data?.capabilities.canManage ?? false
  const current = roles.data?.roles.find((role) => role.id === selected)

  return (
    <div className="space-y-4 p-4">
      <Panel title={format(m.rolesTitle)} description={format(m.rolesHint)}>
        <AsyncSection
          pending={roles.isPending}
          error={roles.isError ? formatError(roles.error) : null}
          loadingLabel={format(commonMessages.loading)}
          retryLabel={format(commonMessages.retry)}
          onRetry={() => void roles.refetch()}
        >
          {(roles.data?.roles ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">{format(m.rolesEmpty)}</p>
          ) : (
            <ul className="divide-y">
              {(roles.data?.roles ?? []).map((role) => (
                <li key={role.id}>
                  <button
                    type="button"
                    aria-current={role.id === selected}
                    className="flex w-full flex-col items-start gap-0.5 py-2 text-left hover:bg-muted/50"
                    onClick={() => setSelected(role.id === selected ? '' : role.id)}
                  >
                    <span className="text-sm font-medium">
                      {role.name}
                      <span className="ml-2 text-xs text-muted-foreground">{role.code}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {format(role.kind === 'tenant' ? m.tenantKind : m.orgKind)}
                      </span>
                      {role.systemKey !== null && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {format(m.systemBadge)}
                        </span>
                      )}
                      {role.status === 'draft' && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {format(m.draftBadge)}
                        </span>
                      )}
                      {role.status === 'disabled' && (
                        <span className="ml-2 text-xs text-destructive">
                          {format(m.disabledBadge)}
                        </span>
                      )}
                      {!role.assignable && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {format(m.unassignableBadge)}
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {format(m.assignmentCount, { count: role.grantCount })}
                      {role.permissions.length > 0 && ` · ${role.permissions.join(', ')}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </AsyncSection>
      </Panel>

      {current && <RoleEditor role={current} canManage={canManage} />}
      {canManage && <NewRoleForm onCreated={setSelected} />}
    </div>
  )
}
