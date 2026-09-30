import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { useApiQuery, useLoadFailure, usePageHref, usePageNavigate } from '@qualy/web-runtime'

import { AsyncSection } from '@qualy/ui/admin'
import { Pager } from '@qualy/ui/pager'
import { CardEmpty, CardFoot, Cell, Table, TableHead, TableRow, Tag } from '@qualy/ui/screen'
import { GrantOrigin } from './GrantOrigin.tsx'

import { accessApi } from './api.ts'
import { useMoment } from './when.ts'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

// Who holds one role, a page at a time.
//
// The role's page said how many hold it and nothing about who: finding them
// meant opening people one by one. Each row is a grant rather than a person,
// because the same person may hold the role over two units, and where it is
// held is half of what the row says. A grant confined to one object says
// which, in its owner's words, and that is the way to it; an ordinary one
// leads to the holder's own grants, where it can be withdrawn.

const PER_PAGE = 20

const styles = stylex.create({
  origin: { display: 'flex', minWidth: 0, flexWrap: 'wrap', alignItems: 'center', columnGap: 10 },
})

export function RoleHolders({ roleId }: { roleId: string }) {
  const query = useApiQuery(accessApi)
  const navigate = usePageNavigate()

  const describe = useLoadFailure()
  const moment = useMoment()
  const [page, setPage] = useState(1)
  const personReachable =
    usePageHref('rbac/user-role-grants', { params: { userId: '0' } }) !== undefined
  const held = useQuery({
    ...query.access.listRoleGrants.queryOptions({
      query: { roleId, page: String(page), limit: String(PER_PAGE) },
    }),
    placeholderData: keepPreviousData,
  })
  const items = held.data?.items ?? []

  return (
    <AsyncSection
      pending={held.isPending}
      error={held.isError ? describe.of(held.error) : null}
      retrying={held.isFetching}
      loadingLabel={commonMessages.state_loading()}
      retryLabel={commonMessages.action_retry()}
      onRetry={() => void held.refetch()}
    >
      {items.length === 0 ? (
        <CardEmpty>{m.holders_empty()}</CardEmpty>
      ) : (
        <Table
          columns="minmax(0, 1fr) minmax(0, 1.2fr) minmax(0, 1.2fr)"
          openable={personReachable}
        >
          <TableHead>
            <span>{m.holders_column()}</span>
            <span>{m.grants_scope()}</span>
            <span>{m.grants_columnOrigin()}</span>
          </TableHead>
          {items.map((grant) => (
            <TableRow
              key={grant.id}
              nested
              height="compact"
              data-testid="role-holder"
              data-grant-kind={grant.scoped ? 'confined' : 'organizational'}
              {...(personReachable
                ? {
                    onOpen: () =>
                      navigate('rbac/user-role-grants', { params: { userId: grant.userId } }),
                  }
                : {})}
            >
              <Cell lead>{grant.userDisplayName}</Cell>
              <Cell>
                {grant.target.kind === 'tenant'
                  ? m.grants_tenantWide()
                  : (grant.target.coverage === 'subtree' ? m.grants_atSubtree : m.grants_atNode)({
                      node: grant.target.orgNodeName,
                    })}
              </Cell>
              <Cell>
                <span {...stylex.props(styles.origin)}>
                  {grant.resource === null ? (
                    <Tag outline>{m.holders_organizational()}</Tag>
                  ) : (
                    <GrantOrigin grant={grant} />
                  )}
                  {grant.validUntil !== null && (
                    <span>{m.grants_validUntil({ when: moment(grant.validUntil) })}</span>
                  )}
                </span>
              </Cell>
            </TableRow>
          ))}
        </Table>
      )}
      <CardFoot>
        <Pager
          testId="role-holders-pager"
          label={m.pager()}
          page={held.data?.page ?? page}
          pageSize={PER_PAGE}
          total={held.data?.total ?? 0}
          disabled={held.isFetching}
          summary={m.roles_holderCount({ count: held.data?.total ?? 0 })}
          onPage={setPage}
        />
      </CardFoot>
    </AsyncSection>
  )
}
