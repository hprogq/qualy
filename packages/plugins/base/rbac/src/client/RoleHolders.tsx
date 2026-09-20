import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { useApiQuery, usePageHref, usePageNavigate } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import { Pager } from '@qualy/ui/pager'
import { CardEmpty, CardFoot, Cell, Table, TableHead, TableRow, Tag } from '@qualy/ui/screen'
import { GrantOrigin } from './GrantOrigin.tsx'
import { rbacMessages as m } from './i18n.ts'
import { accessApi } from './api.ts'
import { useMoment } from './when.ts'

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
  const { format, formatError } = useI18n()
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
      error={held.isError ? formatError(held.error) : null}
      loadingLabel={format(commonMessages.loading)}
      retryLabel={format(commonMessages.retry)}
      onRetry={() => void held.refetch()}
    >
      {items.length === 0 ? (
        <CardEmpty>{format(m.holdersEmpty)}</CardEmpty>
      ) : (
        <Table columns="minmax(0, 1fr) minmax(0, 1.2fr) minmax(0, 1.2fr)" openable={personReachable}>
          <TableHead>
            <span>{format(m.holderColumn)}</span>
            <span>{format(m.grantScope)}</span>
            <span>{format(m.columnOrigin)}</span>
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
                  ? format(m.tenantWide)
                  : format(grant.target.coverage === 'subtree' ? m.atSubtree : m.atNode, {
                      node: grant.target.orgNodeName,
                    })}
              </Cell>
              <Cell>
                <span {...stylex.props(styles.origin)}>
                  {grant.resource === null ? (
                    <Tag outline>{format(m.organizationalWord)}</Tag>
                  ) : (
                    <GrantOrigin grant={grant} />
                  )}
                  {grant.validUntil !== null && (
                    <span>{format(m.validUntil, { when: moment(grant.validUntil) })}</span>
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
          label={format(m.pagerLabel)}
          page={held.data?.page ?? page}
          pageSize={PER_PAGE}
          total={held.data?.total ?? 0}
          disabled={held.isFetching}
          summary={format(m.holderCount, { count: held.data?.total ?? 0 })}
          onPage={setPage}
        />
      </CardFoot>
    </AsyncSection>
  )
}
