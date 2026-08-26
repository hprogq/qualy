import { useQuery } from '@tanstack/react-query'
import { useApiQuery, usePageQueryState } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { useState } from 'react'
import { PlusIcon, ShieldIcon } from 'lucide-react'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { AsyncSection } from '@qualy/ui/admin'
import { Blank, Rail, RailRow, Screen } from '@qualy/ui/screen'
import { Button } from '@qualy/ui/button'
import { rbacMessages as m } from './i18n.ts'
import { RoleEditor, type RoleRow } from './RoleEditor.tsx'
import { NewRoleForm } from './NewRoleForm.tsx'
import { accessApi } from './api.ts'

// Roles and what they may hold, grouped the way they take effect: a
// tenant-wide role acts everywhere the moment it is granted, a per-unit role
// waits to be anchored somewhere. The selected role lives in the query
// string rather than in component state, so a role is linkable and survives
// a reload.

const styles = stylex.create({
  split: {
    display: 'grid',
    alignItems: 'start',
    gap: 24,
    gridTemplateColumns: {
      default: 'none',
      '@media (min-width: 1024px)': '19rem minmax(0, 1fr)',
    },
  },
  emptyNote: {
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    color: tokens.mutedForeground,
  },
  groups: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 16,
  },
  group: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 6,
  },
  groupHead: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
    fontSize: '0.75rem',
    lineHeight: '1rem',
    fontWeight: 500,
  },
  groupHint: {
    fontWeight: 400,
    color: tokens.mutedForeground,
  },
})

export default function RolesPage() {
  const query = useApiQuery(accessApi)
  const { format, formatError } = useI18n()
  const [selected, setSelected] = usePageQueryState('role')
  const [creating, setCreating] = useState(false)

  const roles = useQuery(query.access.listRoles.queryOptions({ query: {} }))
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
        <div {...stylex.props(styles.split)}>
          {all.length === 0 ? (
            <p {...stylex.props(styles.emptyNote)}>{format(m.rolesEmpty)}</p>
          ) : (
            <div {...stylex.props(styles.groups)}>
              {groups
                .filter((group) => group.rows.length > 0)
                .map((group) => (
                  <section key={group.key} {...stylex.props(styles.group)}>
                    <h2 {...stylex.props(styles.groupHead)}>
                      {group.title}
                      <span {...stylex.props(styles.groupHint)}>{group.hint}</span>
                    </h2>
                    <Rail>
                      {group.rows.map((role) => (
                        <RailRow
                          key={role.id}
                          name={role.name}
                          badges={[
                            ...(role.systemKey !== null ? [{ label: format(m.systemBadge) }] : []),
                            ...(role.status === 'draft' ? [{ label: format(m.draftBadge) }] : []),
                            ...(role.status === 'disabled'
                              ? [{ label: format(m.disabledBadge), tone: 'alert' as const }]
                              : []),
                            ...(role.assignable ? [] : [{ label: format(m.unassignableBadge) }]),
                          ]}
                          tally={format(m.assignmentCount, { count: role.grantCount })}
                          meta={[
                            { text: format(m.permissionCount, { count: role.permissions.length }) },
                          ]}
                          selected={role.id === selected}
                          onSelect={() => setSelected(role.id === selected ? '' : role.id)}
                        />
                      ))}
                    </Rail>
                  </section>
                ))}
            </div>
          )}

          {current ? (
            <RoleEditor role={current} canManage={canManage} />
          ) : (
            <Blank
              icon={<ShieldIcon />}
              title={format(m.pickRoleTitle)}
              description={format(m.pickRoleBody)}
            />
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
