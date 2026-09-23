import { useInfiniteQuery } from '@tanstack/react-query'
import {
  cursorPages,
  usePageHref,
  usePageNavigate,
} from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { AsyncSection } from '@qualy/ui/admin'
import {
  Card,
  CardEmpty,
  CardFoot,
  Cell,
  EditorSkeleton,
  LeadWord,
  SectionHead,
  Spacer,
  Status,
  Table,
  TableHead,
  TableRow,
} from '@qualy/ui/screen'
import { Button } from '@qualy/ui/button'
import { StatusBadge } from '../batch/StatusBadge.tsx'
import { useWhen } from '../batch/when.ts'
import type { ApiResult } from '@qualy/web-runtime/api'
import type { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'

// The rounds one person took part in: the person's record in the
// administration, and the reader's own account. Roster membership and
// nothing else: what they helped run is the grants screen's story, and what
// they filed is elsewhere. Which person, and asked how, is the caller's.

const styles = stylex.create({
  page: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
  },
  row: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: { default: 1, ':first-child': 0 },
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    paddingInline: 16,
    paddingBlock: 12,
  },
  text: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '12rem',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  name: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    fontWeight: 500,
  },
  meta: {
    display: 'flex',
    flexWrap: 'wrap',
    columnGap: 12,
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
  link: {
    flexShrink: 0,
    fontSize: '0.75rem',
    lineHeight: '1rem',
    fontWeight: 500,
    textDecoration: {
      default: 'none',
      ':hover': 'underline',
    },
  },
  compactBlank: {
    minHeight: '14rem',
  },
  more: {
    alignSelf: 'flex-start',
  },
})

/** one page of a person's rounds, as the api answers */
export type BatchMembershipPage = ApiResult<typeof assessmentApi, 'assessment', 'listUserBatches'>

export function BatchMemberships({
  queryKey,
  fetchPage,
}: {
  /** what the pages are cached under */
  queryKey: readonly unknown[]
  /** one page, from where the last one ended */
  fetchPage: (cursor: string | undefined) => Promise<BatchMembershipPage>
}) {
  const { format, formatError } = useI18n()
  const when = useWhen()
  const navigate = usePageNavigate()
  // a row is a way into the round only for a reader who may open rounds
  const batchReachable = usePageHref('assessment/batch', { params: { batchId: '0' } }) !== undefined

  const rows = useInfiniteQuery({
    queryKey: [...queryKey, 'infinite'],
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    ...cursorPages,
  })
  const items = rows.data?.pages.flatMap((page) => page.items) ?? []

  return (
    <div {...stylex.props(styles.page)}>
      <SectionHead
        title={format(m.personBatchesTab)}
        count={rows.data ? items.length : undefined}
      />
      <AsyncSection
        pending={rows.isPending}
        error={rows.isError ? formatError(rows.error) : null}
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => void rows.refetch()}
        skeleton={<EditorSkeleton />}
      >
        <Card>
          {items.length === 0 ? (
            <CardEmpty>{format(m.personBatchesEmpty)}</CardEmpty>
          ) : (
            <Table columns="minmax(0, 1.4fr) minmax(0, 1fr) 6rem 8.5rem" openable={batchReachable}>
              <TableHead>
                <span>{format(m.personBatchColumn)}</span>
                <span>{format(m.personAnchorColumn)}</span>
                <span>{format(m.personMembershipColumn)}</span>
                <span>{format(m.personIncludedColumn)}</span>
              </TableHead>
              {items.map(({ batch, membership }) => (
                <TableRow
                  key={batch.id}
                  data-testid="person-batch"
                  data-batch-id={batch.id}
                  data-membership={membership.status}
                  {...(batchReachable
                    ? {
                        onOpen: () =>
                          navigate('assessment/batch', { params: { batchId: batch.id } }),
                      }
                    : {})}
                >
                  <Cell lead>
                    <LeadWord>{batch.name}</LeadWord>
                    <StatusBadge status={batch.status} currentPhaseId={batch.currentPhaseId} />
                  </Cell>
                  <Cell title={membership.anchorNodeName ?? undefined}>
                    {membership.anchorNodeName ?? format(m.personAnchorGone)}
                  </Cell>
                  {/* still in the round or taken off it: what this list is
                      scanned for, kept at the end of the stacked row */}
                  <Cell narrow="end" unlabelled>
                    <Status tone={membership.status === 'excluded' ? 'bad' : 'plain'}>
                      {format(
                        membership.status === 'excluded'
                          ? m.personMembershipExcluded
                          : m.personMembershipActive,
                      )}
                    </Status>
                  </Cell>
                  <Cell numeric>{when.moment(new Date(membership.includedAt).getTime())}</Cell>
                </TableRow>
              ))}
            </Table>
          )}
          {rows.hasNextPage && (
            <CardFoot>
              <Spacer />
              <Button
                variant="outline"
                size="sm"
                disabled={rows.isFetchingNextPage}
                onClick={() => void rows.fetchNextPage()}
              >
                {format(m.personLoadMore)}
              </Button>
            </CardFoot>
          )}
        </Card>
      </AsyncSection>
    </div>
  )
}
