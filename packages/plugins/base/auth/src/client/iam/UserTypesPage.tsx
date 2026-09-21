import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useApiQuery, usePageNavigate } from '@qualy/web-runtime'
import { useI18n, useList } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import {
  BandAction,
  BandActions,
  Card,
  CardEmpty,
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
import { Button } from '@qualy/ui/button'
import { PlusIcon } from 'lucide-react'
import { iamMessages as m } from '../i18n.ts'
import { NewUserTypeForm } from './NewUserTypeForm.tsx'
import { useUserTypeFacts } from './types/facts.ts'
import { authApi } from '../api.ts'

// User types, as one table: a handful of rows, each saying where that kind of
// person may belong, how they get in and what they may carry. The row opens
// the type's own page; nothing is edited here.

const COLUMNS = 'minmax(0, 0.9fr) 6rem minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) 4.5rem'

export default function UserTypesPage() {
  const query = useApiQuery(authApi)
  const { format, formatError, locale } = useI18n()
  const figure = new Intl.NumberFormat(locale)
  const listJoin = useList()
  const navigate = usePageNavigate()
  const [creating, setCreating] = useState(false)

  const types = useQuery(query.identity.listUserTypes.queryOptions({}))
  const facts = useUserTypeFacts()
  const canManage = types.data?.capabilities.canManage ?? false
  const rows = types.data?.userTypes ?? []

  return (
    <Screen
      title={format(m.userTypesTitle)}
      description={format(m.userTypesHint)}
      actions={
        canManage && (
          <BandActions
            moreLabel={format(commonMessages.bandMore)}
            primary={
              <BandAction
                variant="primary"
                icon={<PlusIcon aria-hidden />}
                onSelect={() => setCreating(true)}
              >
                {format(m.newUserType)}
              </BandAction>
            }
          />
        )
      }
    >
      <AsyncSection
        pending={types.isPending}
        error={types.isError ? formatError(types.error) : null}
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => void types.refetch()}
        skeleton={<TableSkeleton />}
      >
        <Card>
          {rows.length === 0 ? (
            <CardEmpty>{format(m.userTypesEmpty)}</CardEmpty>
          ) : (
            <Table columns={COLUMNS} openable>
              <TableHead>
                <span>{format(m.userTypeLabel)}</span>
                <span>{format(m.columnUsers)}</span>
                <span>{format(m.placementLegend)}</span>
                <span>{format(m.signInLabel)}</span>
                <span>{format(m.openRolesLabel)}</span>
                <span>{format(m.columnStatus)}</span>
              </TableHead>
              {rows.map((type) => {
                const entrances = facts.entrances(type)?.filter((entrance) => entrance.admits)
                const openRoles = facts.openRoles(type)
                return (
                  <TableRow
                    key={type.id}
                    onOpen={() => navigate('auth/user-type', { params: { typeId: type.id } })}
                    data-testid="type-row"
                    data-users={String(type.userCount)}
                    data-placement={type.placementPolicy.mode}
                    data-status={type.status}
                    data-entrances={entrances === undefined ? 'unknown' : String(entrances.length)}
                  >
                    <Cell lead>
                      <LeadWord>{type.name}</LeadWord>
                      {type.isSystem && <Tag>{format(m.systemBadge)}</Tag>}
                    </Cell>
                    {/* the number the list is scanned by: stacked, it keeps
                        the end of the row rather than queueing among the facts */}
                    <Cell tone="muted" numeric narrow="end" unlabelled>
                      {figure.format(type.userCount)}
                    </Cell>
                    <Cell tone="muted">
                      {type.placementPolicy.mode === 'allow-list'
                        ? listJoin(facts.allowedKinds(type))
                        : format(
                            type.placementPolicy.mode === 'tenant-root'
                              ? m.placementTenantRoot
                              : m.placementAnywhere,
                          )}
                    </Cell>
                    <Cell tone={entrances?.length === 0 ? 'warn' : 'muted'}>
                      {entrances === undefined ? (
                        format(m.unknownWord)
                      ) : entrances.length === 0 ? (
                        <Status tone="warn">{format(m.signInNoneShort)}</Status>
                      ) : (
                        listJoin(entrances.map((entrance) => entrance.name))
                      )}
                    </Cell>
                    {/* two facts are what a phone row can hold and be read
                        at a glance: where they may stand and how they get
                        in. What they may carry is a press away. */}
                    <Cell tone="muted" narrow="drop">
                      {openRoles === undefined
                        ? format(m.unknownWord)
                        : openRoles.length === 0
                          ? format(m.noneWord)
                          : listJoin(openRoles.map((role) => role.name))}
                    </Cell>
                    {/* in force is the resting state and says nothing a
                        phone row has room for; out of force is the reason
                        somebody is looking at this row at all */}
                    <Cell tone="muted" narrow={type.status === 'active' ? 'drop' : 'keep'}>
                      <Status tone={type.status === 'active' ? 'plain' : 'bad'}>
                        {format(type.status === 'active' ? m.typeEnabled : m.statusDisabled)}
                      </Status>
                    </Cell>
                  </TableRow>
                )
              })}
            </Table>
          )}
        </Card>
      </AsyncSection>

      {canManage && (
        <NewUserTypeForm
          open={creating}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false)
            navigate('auth/user-type', { params: { typeId: id } })
          }}
        />
      )}
    </Screen>
  )
}
