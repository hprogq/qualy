import { useQuery } from '@tanstack/react-query'
import { useApiQuery, usePageNavigate } from '@qualy/web-runtime'
import { useI18n, useList } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { useState } from 'react'
import { PlusIcon } from 'lucide-react'
import { AsyncSection } from '@qualy/ui/admin'
import {
  Card,
  CardEmpty,
  CardHead,
  Cell,
  LeadWord,
  Screen,
  Status,
  Table,
  TableHead,
  TableRow,
  Tag,
} from '@qualy/ui/screen'
import { Button } from '@qualy/ui/button'
import { rbacMessages as m } from './i18n.ts'
import type { RoleRow } from './RoleEditor.tsx'
import { NewRoleForm } from './NewRoleForm.tsx'
import { accessApi } from './api.ts'

// Roles, as two tables rather than one list: a tenant-wide role acts
// everywhere the moment it is granted, a per-unit role waits to be anchored
// somewhere, and that difference is what somebody choosing a role is
// choosing between.
//
// The columns are the parts a role is configured in - what it may do, how
// many hold it, who may hold it, where it may be held, whether it is in
// force - so a row says whether a role is finished without opening it. A
// draft that has not said who may hold it shows exactly that, in the colour
// of something waiting, because that is the reason it cannot be switched on.

const COLUMNS = 'minmax(0, 1.1fr) 5.5rem 5rem minmax(0, 1fr) minmax(0, 1fr) 5rem'

export default function RolesPage() {
  const query = useApiQuery(accessApi)
  const { format, formatError } = useI18n()
  const listJoin = useList()
  const navigate = usePageNavigate()
  const [creating, setCreating] = useState(false)

  const roles = useQuery(query.access.listRoles.queryOptions({ query: {} }))
  const options = useQuery(query.access.getRoleOptions.queryOptions())
  const canManage = roles.data?.capabilities.canManage ?? false
  const all = roles.data?.roles ?? []
  const groups: { key: 'tenant' | 'org'; title: string; hint: string; rows: RoleRow[] }[] = [
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
  const namesOf = (ids: readonly string[], among: readonly { id: string; name: string }[]) =>
    listJoin(among.filter((one) => ids.includes(one.id)).map((one) => one.name))

  /** who may hold it: everybody, the listed kinds, or - on a draft - nothing said yet */
  const holders = (role: RoleRow) => {
    // the canonical administrator is exempt, which is not the same as unset
    if (role.systemKey !== null) return { words: format(m.exemptWord), unset: false }
    if (role.holderPolicy.mode === 'unrestricted') return { words: format(m.anyoneWord), unset: false }
    const names = namesOf(role.holderPolicy.userTypeIds, options.data?.userTypes ?? [])
    return names === '' ? { words: format(m.unsetWord), unset: true } : { words: names, unset: false }
  }
  /** where it may be held; a tenant role is held nowhere in particular */
  const anchors = (role: RoleRow) => {
    if (role.anchorPolicy === null) return { words: format(m.notApplicable), unset: false, quiet: true }
    if (role.anchorPolicy.mode === 'unrestricted') {
      return { words: format(m.anywhereWord), unset: false, quiet: false }
    }
    const names = namesOf(role.anchorPolicy.orgTypeIds, options.data?.orgTypes ?? [])
    return names === ''
      ? { words: format(m.unsetWord), unset: true, quiet: false }
      : { words: names, unset: false, quiet: false }
  }

  return (
    <Screen
      title={format(m.rolesTitle)}
      description={format(m.rolesHint)}
      actions={
        canManage && (
          <Button onClick={() => setCreating(true)}>
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
        {all.length === 0 ? (
          <Card>
            <CardEmpty>{format(m.rolesEmpty)}</CardEmpty>
          </Card>
        ) : (
          groups
            .filter((group) => group.rows.length > 0)
            .map((group) => (
              <Card key={group.key} data-testid="role-group" data-kind={group.key}>
                <CardHead title={group.title} note={group.hint} />
                <Table columns={COLUMNS} openable>
                  <TableHead>
                    <span>{format(m.rolesTitle)}</span>
                    <span>{format(m.tabPermissions)}</span>
                    <span>{format(m.columnGrants)}</span>
                    <span>{format(m.columnHolders)}</span>
                    <span>{format(m.columnAnchors)}</span>
                    <span>{format(m.factStatus)}</span>
                  </TableHead>
                  {group.rows.map((role) => {
                    const who = holders(role)
                    const where = anchors(role)
                    return (
                      <TableRow
                        key={role.id}
                        onOpen={() => navigate('rbac/role', { params: { roleId: role.id } })}
                        data-testid="role-row"
                        data-role-name={role.name}
                        data-role-status={role.status}
                        data-assignable={role.assignable}
                      >
                        <Cell lead>
                          <LeadWord>{role.name}</LeadWord>
                          {role.systemKey !== null && <Tag>{format(m.systemBadge)}</Tag>}
                          {!role.assignable && <Tag outline>{format(m.unassignableBadge)}</Tag>}
                        </Cell>
                        <Cell numeric>
                          {role.holdsEveryPermission
                            ? format(m.everyWord)
                            : format(m.countItems, { count: role.permissions.length })}
                        </Cell>
                        <Cell numeric>{format(m.assignmentCount, { count: role.grantCount })}</Cell>
                        <Cell tone={who.unset ? 'warn' : 'muted'} title={who.words}>
                          {who.words}
                        </Cell>
                        <Cell tone={where.unset ? 'warn' : where.quiet ? 'quiet' : 'muted'} title={where.words}>
                          {where.words}
                        </Cell>
                        <Status
                          tone={role.status === 'disabled' ? 'bad' : role.status === 'draft' ? 'warn' : 'plain'}
                        >
                          {format(
                            role.status === 'active'
                              ? m.statusOn
                              : role.status === 'draft'
                                ? m.draftBadge
                                : m.disabledBadge,
                          )}
                        </Status>
                      </TableRow>
                    )
                  })}
                </Table>
              </Card>
            ))
        )}
      </AsyncSection>

      {canManage && (
        <NewRoleForm
          open={creating}
          onClose={() => setCreating(false)}
          onCreated={(roleId) => navigate('rbac/role', { params: { roleId } })}
        />
      )}
    </Screen>
  )
}
