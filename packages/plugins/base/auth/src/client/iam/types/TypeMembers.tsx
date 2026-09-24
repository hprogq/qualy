import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useApiQuery, usePageHref, usePageNavigate } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { useTerm } from '@qualy/plugin-settings/client/terms'
import { authTerms } from '@qualy/auth-contract/terms'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import { Pager } from '@qualy/ui/pager'
import {
  Card,
  CardEmpty,
  CardFoot,
  CardHead,
  Cell,
  Status,
  Table,
  TableHead,
  TableRow,
} from '@qualy/ui/screen'
import { iamMessages as m } from '../../i18n.ts'
import { authApi } from '../../api.ts'

// The people of one user type, a page at a time.
//
// The type's page said how many there are and nothing about who, and "860
// people hold this type, so it cannot be disabled" left the reader to find
// them through the roster's filter. Reading people is a grant of its own: a
// reader without it gets no card rather than an empty one.

const PER_PAGE = 20

export function TypeMembers({ userTypeId }: { userTypeId: string }) {
  const query = useApiQuery(authApi)
  const navigate = usePageNavigate()
  const { format, formatError } = useI18n()
  const businessNo = useTerm(authTerms.businessNumber)
  const [page, setPage] = useState(1)
  const personReachable = usePageHref('auth/user-detail', { params: { userId: '0' } }) !== undefined
  // the top of what this reader may see: everybody of the type stands under it
  const options = useQuery({
    ...query.identity.getUserOptions.queryOptions({ query: {} }),
    retry: false,
  })
  const nodes = options.data?.nodes ?? []
  const root = nodes.find((node) => node.parentId === null) ?? nodes[0]
  const people = useQuery({
    ...query.identity.listUsers.queryOptions({
      query: {
        orgNodeId: root?.orgNodeId ?? '',
        scope: 'subtree',
        userTypeId,
        page: String(page),
        limit: String(PER_PAGE),
      },
    }),
    enabled: root !== undefined,
    placeholderData: keepPreviousData,
  })
  if (options.isError || (options.isSuccess && root === undefined)) return null
  const items = people.data?.items ?? []

  return (
    <Card data-testid="type-members" data-total={people.data?.total ?? 0}>
      <CardHead title={format(m.typeMembersTitle)} />
      <AsyncSection
        pending={options.isPending || people.isPending}
        error={people.isError ? formatError(people.error) : null}
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => void people.refetch()}
      >
        {items.length === 0 ? (
          <CardEmpty>{format(m.usersEmpty)}</CardEmpty>
        ) : (
          <Table
            columns="8.5rem minmax(0, 0.8fr) minmax(0, 1.2fr) 4.5rem"
            openable={personReachable}
          >
            <TableHead>
              <span>{businessNo}</span>
              <span>{format(m.columnName)}</span>
              <span>{format(m.columnUnit)}</span>
              <span>{format(m.columnStatus)}</span>
            </TableHead>
            {items.map((user) => (
              <TableRow
                key={user.id}
                height="compact"
                data-testid="type-member"
                {...(personReachable
                  ? { onOpen: () => navigate('auth/user-detail', { params: { userId: user.id } }) }
                  : {})}
              >
                <Cell lead numeric tone={user.businessNo === null ? 'quiet' : 'plain'}>
                  {user.businessNo ?? format(m.personNoBusinessNo, { businessNo })}
                </Cell>
                <Cell tone="plain">{user.displayName}</Cell>
                <Cell>{user.primaryOrgNode.name}</Cell>
                <Status tone={user.status === 'active' ? 'plain' : 'bad'}>
                  {format(user.status === 'disabled' ? m.disabledBadge : m.statusActive)}
                </Status>
              </TableRow>
            ))}
          </Table>
        )}
        <CardFoot>
          <Pager
            testId="type-members-pager"
            label={format(m.pagerLabel)}
            page={people.data?.page ?? page}
            pageSize={PER_PAGE}
            total={people.data?.total ?? 0}
            disabled={people.isFetching}
            summary={format(m.userCount, { count: people.data?.total ?? 0 })}
            onPage={setPage}
          />
        </CardFoot>
      </AsyncSection>
    </Card>
  )
}
