import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  loadFailureKind,
  useApiQuery,
  useLoadFailure,
  usePageHref,
  usePageNavigate,
} from '@qualy/web-runtime'
import { useTerm } from '@qualy/plugin-settings/client/terms'
import { authTerms } from '@qualy/auth-contract/terms'

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

import { authApi } from '../../api.ts'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

// The people of one user type, a page at a time.
//
// The type's page said how many there are and nothing about who, and "860
// people hold this type, so it cannot be disabled" left the reader to find
// them through the roster's filter. Reading people is a grant of its own: a
// reader without it gets no card rather than an empty one. A reading that
// failed for any other reason is said in the card, with another try, rather
// than taking the card away as though the reader had no such grant.

const PER_PAGE = 20

export function TypeMembers({ userTypeId }: { userTypeId: string }) {
  const query = useApiQuery(authApi)
  const navigate = usePageNavigate()

  const describe = useLoadFailure()
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
  const withheld = options.isError && loadFailureKind(options.error) === 'denied'
  if (withheld || (options.isSuccess && root === undefined)) return null
  const items = people.data?.items ?? []
  const failure = options.isError
    ? describe.of(options.error)
    : people.isError
      ? describe.of(people.error)
      : null

  return (
    <Card data-testid="type-members" data-total={people.data?.total ?? 0}>
      <CardHead title={m.userTypes_members()} />
      <AsyncSection
        pending={failure === null && (options.isPending || people.isPending)}
        error={failure}
        retrying={options.isFetching || people.isFetching}
        loadingLabel={commonMessages.state_loading()}
        retryLabel={commonMessages.action_retry()}
        onRetry={() => void (options.isError ? options.refetch() : people.refetch())}
      >
        {items.length === 0 ? (
          <CardEmpty>{m.users_empty()}</CardEmpty>
        ) : (
          <Table
            columns="8.5rem minmax(0, 0.8fr) minmax(0, 1.2fr) 4.5rem"
            openable={personReachable}
          >
            <TableHead>
              <span>{businessNo}</span>
              <span>{m.users_columnName()}</span>
              <span>{m.users_columnUnit()}</span>
              <span>{m.users_columnStatus()}</span>
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
                  {user.businessNo ?? m.person_noBusinessNo({ businessNo })}
                </Cell>
                <Cell tone="plain">{user.displayName}</Cell>
                <Cell>{user.primaryOrgNode.name}</Cell>
                <Status tone={user.status === 'active' ? 'plain' : 'bad'}>
                  {(user.status === 'disabled' ? m.badge_disabled : m.users_statusActive)()}
                </Status>
              </TableRow>
            ))}
          </Table>
        )}
        <CardFoot>
          <Pager
            testId="type-members-pager"
            label={m.users_pager()}
            page={people.data?.page ?? page}
            pageSize={PER_PAGE}
            total={people.data?.total ?? 0}
            disabled={people.isFetching}
            summary={m.userTypes_userCount({ count: people.data?.total ?? 0 })}
            onPage={setPage}
          />
        </CardFoot>
      </AsyncSection>
    </Card>
  )
}
