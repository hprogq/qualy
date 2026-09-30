import { useQuery } from '@tanstack/react-query'
import { useApiQuery, useLoadFailure, usePageNavigate } from '@qualy/web-runtime'
import { useI18n, useList } from '@qualy/web-i18n'

import { useState } from 'react'
import { PlusIcon } from 'lucide-react'
import { AsyncSection } from '@qualy/ui/admin'
import {
  BandAction,
  BandActions,
  Card,
  CardEmpty,
  CardHead,
  Cell,
  LeadWord,
  Screen,
  Status,
  Table,
  TableSkeleton,
  TableHead,
  TableRow,
  Tag,
} from '@qualy/ui/screen'

import type { RoleRow } from './RoleEditor.tsx'
import { NewRoleForm } from './NewRoleForm.tsx'
import { accessApi } from './api.ts'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

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
  const { locale } = useI18n()
  const describe = useLoadFailure()
  const figure = new Intl.NumberFormat(locale)
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
      title: m.roles_tenantGroup(),
      hint: m.roles_tenantGroupHint(),
      rows: all.filter((role) => role.kind === 'tenant'),
    },
    {
      key: 'org',
      title: m.roles_orgGroup(),
      hint: m.roles_orgGroupHint(),
      rows: all.filter((role) => role.kind === 'org'),
    },
  ]
  const namesOf = (ids: readonly string[], among: readonly { id: string; name: string }[]) =>
    listJoin(among.filter((one) => ids.includes(one.id)).map((one) => one.name))

  /** who may hold it: everybody, the listed kinds, or - on a draft - nothing said yet */
  const holders = (role: RoleRow) => {
    // the canonical administrator is exempt, which is not the same as unset
    if (role.systemKey !== null) return { words: m.roles_exempt(), unset: false }
    if (role.holderPolicy.mode === 'unrestricted') return { words: m.roles_anyone(), unset: false }
    const names = namesOf(role.holderPolicy.userTypeIds, options.data?.userTypes ?? [])
    return names === '' ? { words: m.roles_unset(), unset: true } : { words: names, unset: false }
  }
  /** where it may be held; a tenant role is held nowhere in particular */
  const anchors = (role: RoleRow) => {
    if (role.anchorPolicy === null)
      return { words: m.roles_notApplicable(), unset: false, quiet: true }
    if (role.anchorPolicy.mode === 'unrestricted') {
      return { words: m.roles_anywhere(), unset: false, quiet: false }
    }
    const names = namesOf(role.anchorPolicy.orgTypeIds, options.data?.orgTypes ?? [])
    return names === ''
      ? { words: m.roles_unset(), unset: true, quiet: false }
      : { words: names, unset: false, quiet: false }
  }

  return (
    <Screen
      title={m.roles_title()}
      description={m.roles_hint()}
      actions={
        canManage && (
          <BandActions
            moreLabel={commonMessages.action_more()}
            primary={
              <BandAction
                variant="primary"
                icon={<PlusIcon aria-hidden />}
                onSelect={() => setCreating(true)}
              >
                {m.roles_new()}
              </BandAction>
            }
          />
        )
      }
    >
      <AsyncSection
        pending={roles.isPending}
        error={roles.isError ? describe.of(roles.error) : null}
        // on the page's own ground, where the list would have stood in a card
        framed
        retrying={roles.isFetching}
        loadingLabel={commonMessages.state_loading()}
        retryLabel={commonMessages.action_retry()}
        onRetry={() => void roles.refetch()}
        skeleton={<TableSkeleton />}
      >
        {all.length === 0 ? (
          <Card>
            <CardEmpty>{m.roles_empty()}</CardEmpty>
          </Card>
        ) : (
          groups
            .filter((group) => group.rows.length > 0)
            .map((group) => (
              <Card key={group.key} data-testid="role-group" data-kind={group.key}>
                <CardHead title={group.title} note={group.hint} />
                <Table columns={COLUMNS} openable>
                  <TableHead>
                    <span>{m.roles_title()}</span>
                    <span>{m.roles_tabPermissions()}</span>
                    <span>{m.roles_columnGrants()}</span>
                    <span>{m.roles_columnHolders()}</span>
                    <span>{m.roles_columnAnchors()}</span>
                    <span>{m.roles_factStatus()}</span>
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
                          {role.systemKey !== null && <Tag>{m.badge_system()}</Tag>}
                          {!role.assignable && <Tag outline>{m.badge_unassignable()}</Tag>}
                        </Cell>
                        <Cell numeric>
                          {role.holdsEveryPermission
                            ? m.roles_every()
                            : m.roles_countItems({ count: role.permissions.length })}
                        </Cell>
                        {/* the column is named above, and on a phone the row
                            carries that name - so the cell is the count */}
                        {/* the number the list is scanned by: stacked, it
                            keeps the end of the row */}
                        <Cell numeric narrow="end">
                          {figure.format(role.grantCount)}
                        </Cell>
                        {/* a list of kinds, not a fact: whole it is a
                            paragraph, and three lines of it on a phone push
                            the count it shares a row with off the line */}
                        <Cell clip tone={who.unset ? 'warn' : 'muted'} title={who.words}>
                          {who.words}
                        </Cell>
                        {/* where it may be anchored matters when granting
                            one, which is not what this list is read for */}
                        <Cell
                          clip
                          narrow="drop"
                          tone={where.unset ? 'warn' : where.quiet ? 'quiet' : 'muted'}
                          title={where.words}
                        >
                          {where.words}
                        </Cell>
                        <Cell narrow={role.status === 'active' ? 'drop' : 'keep'} unlabelled>
                          <Status
                            tone={
                              role.status === 'disabled'
                                ? 'bad'
                                : role.status === 'draft'
                                  ? 'warn'
                                  : 'plain'
                            }
                          >
                            {(role.status === 'active'
                              ? m.roles_statusOn
                              : role.status === 'draft'
                                ? m.badge_draft
                                : m.badge_disabled)()}
                          </Status>
                        </Cell>
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
