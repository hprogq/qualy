import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useApiQuery, useLoadFailure, usePageNavigate } from '@qualy/web-runtime'
import { useI18n, useList } from '@qualy/web-i18n'

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
import { PlusIcon } from 'lucide-react'

import { NewUserTypeForm } from './NewUserTypeForm.tsx'
import { useUserTypeFacts } from './types/facts.ts'
import { authApi } from '../api.ts'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

// User types, as one table: a handful of rows, each saying where that kind of
// person may belong, how they get in and what they may carry. The row opens
// the type's own page; nothing is edited here.

const COLUMNS = 'minmax(0, 0.9fr) 6rem minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) 4.5rem'

export default function UserTypesPage() {
  const query = useApiQuery(authApi)
  const { locale } = useI18n()
  const describe = useLoadFailure()
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
      title={m.userTypes_title()}
      description={m.userTypes_hint()}
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
                {m.userTypes_new()}
              </BandAction>
            }
          />
        )
      }
    >
      <AsyncSection
        pending={types.isPending}
        error={types.isError ? describe.of(types.error) : null}
        // on the page's own ground, where the list would have stood in a card
        framed
        retrying={types.isFetching}
        loadingLabel={commonMessages.state_loading()}
        retryLabel={commonMessages.action_retry()}
        onRetry={() => void types.refetch()}
        skeleton={<TableSkeleton />}
      >
        <Card>
          {rows.length === 0 ? (
            <CardEmpty>{m.userTypes_empty()}</CardEmpty>
          ) : (
            <Table columns={COLUMNS} openable>
              <TableHead>
                <span>{m.field_userType()}</span>
                <span>{m.userTypes_columnUsers()}</span>
                <span>{m.userTypes_placementLegend()}</span>
                <span>{m.userTypes_signIn()}</span>
                <span>{m.userTypes_openRoles()}</span>
                <span>{m.users_columnStatus()}</span>
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
                      {type.isSystem && <Tag>{m.badge_system()}</Tag>}
                    </Cell>
                    {/* the number the list is scanned by: stacked, it keeps
                        the end of the row rather than queueing among the facts */}
                    <Cell tone="muted" numeric narrow="end" unlabelled>
                      {figure.format(type.userCount)}
                    </Cell>
                    <Cell tone="muted">
                      {type.placementPolicy.mode === 'allow-list'
                        ? listJoin(facts.allowedKinds(type))
                        : (type.placementPolicy.mode === 'tenant-root'
                            ? m.field_placementTenantRoot
                            : m.userTypes_placementAnywhere)()}
                    </Cell>
                    <Cell tone={entrances?.length === 0 ? 'warn' : 'muted'}>
                      {entrances === undefined ? (
                        m.word_unknown()
                      ) : entrances.length === 0 ? (
                        <Status tone="warn">{m.userTypes_signInNoneShort()}</Status>
                      ) : (
                        listJoin(entrances.map((entrance) => entrance.name))
                      )}
                    </Cell>
                    {/* two facts are what a phone row can hold and be read
                        at a glance: where they may stand and how they get
                        in. What they may carry is a press away. */}
                    <Cell tone="muted" narrow="drop">
                      {openRoles === undefined
                        ? m.word_unknown()
                        : openRoles.length === 0
                          ? m.word_none()
                          : listJoin(openRoles.map((role) => role.name))}
                    </Cell>
                    {/* in force is the resting state and says nothing a
                        phone row has room for; out of force is the reason
                        somebody is looking at this row at all */}
                    <Cell tone="muted" narrow={type.status === 'active' ? 'drop' : 'keep'}>
                      <Status tone={type.status === 'active' ? 'plain' : 'bad'}>
                        {(type.status === 'active' ? m.state_enabled : m.state_disabled)()}
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
