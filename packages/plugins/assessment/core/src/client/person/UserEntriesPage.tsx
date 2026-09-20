import { useInfiniteQuery } from '@tanstack/react-query'
import { FileTextIcon } from 'lucide-react'
import { cursorPages, PageLink, useApi, useApiQuery, usePageRouteParams, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { AsyncSection } from '@qualy/ui/admin'
import { Blank, EditorSkeleton, SectionHead } from '@qualy/ui/screen'
import { PageContainer } from '@qualy/ui/page-container'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { useWhen } from '../batch/when.ts'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'

// What one person filed, across the rounds the reader may look into. A
// list to scan rather than a place to act: each line leads to the round,
// where the claim is handled by whoever handles it.

const styles = stylex.create({
  page: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
  },
  head: {
    textAlign: 'left',
    fontSize: '0.75rem',
    lineHeight: '1rem',
    fontWeight: 500,
    color: tokens.mutedForeground,
    paddingInline: 8,
    paddingBlock: 6,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
  },
  cell: {
    paddingInline: 8,
    paddingBlock: 10,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    verticalAlign: 'top',
  },
  quietCell: {
    color: tokens.mutedForeground,
    whiteSpace: 'nowrap',
  },
  // the two columns a phone has no room for
  wideOnly: {
    display: {
      default: null,
      [breakpoints.phone]: 'none',
    },
  },
  link: {
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

type EntryStatus = 'draft' | 'in_review' | 'needs_revision' | 'approved' | 'rejected' | 'voided'
type EntrySource = 'self' | 'proxy' | 'record' | 'import' | 'system'

export default function UserEntriesPage() {
  const { userId } = usePageRouteParams('userId')
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const query = useApiQuery(assessmentApi)
  const { format, formatError } = useI18n()
  const when = useWhen()

  const rows = useInfiniteQuery({
    queryKey: [
      ...query.assessment.listUserEntries.key({ params: { userId }, query: {} }),
      'infinite',
    ],
    queryFn: ({ pageParam }) =>
      run(
        api.assessment.listUserEntries({
          params: { userId },
          query: pageParam === undefined ? {} : { cursor: pageParam },
        }),
      ),
    ...cursorPages,
  })
  const items = rows.data?.pages.flatMap((page) => page.items) ?? []

  const statusWord: Record<EntryStatus, string> = {
    draft: format(m.entryStatusDraft),
    in_review: format(m.entryStatusInReview),
    needs_revision: format(m.entryStatusNeedsRevision),
    approved: format(m.entryStatusApproved),
    rejected: format(m.entryStatusRejected),
    voided: format(m.entryStatusVoided),
  }
  const sourceWord: Record<EntrySource, string> = {
    self: format(m.entrySourceSelf),
    proxy: format(m.entrySourceProxy),
    record: format(m.entrySourceRecord),
    import: format(m.entrySourceImport),
    system: format(m.entrySourceSystem),
  }

  return (
    <PageContainer size="default" xstyle={styles.page}>
      <SectionHead title={format(m.personEntriesTab)} count={rows.data ? items.length : undefined} />
      <AsyncSection
        pending={rows.isPending}
        error={rows.isError ? formatError(rows.error) : null}
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => void rows.refetch()}
        skeleton={<EditorSkeleton />}
      >
        {items.length === 0 ? (
          <Blank
            icon={<FileTextIcon />}
            title={format(m.personEntriesEmpty)}
            xstyle={styles.compactBlank}
          />
        ) : (
          <table {...stylex.props(styles.table)}>
            <thead>
              <tr>
                <th {...stylex.props(styles.head)}>{format(m.personColumnBatch)}</th>
                <th {...stylex.props(styles.head)}>{format(m.personColumnItem)}</th>
                <th {...stylex.props(styles.head)}>{format(m.personColumnStatus)}</th>
                <th {...stylex.props(styles.head, styles.wideOnly)}>
                  {format(m.personColumnSource)}
                </th>
                <th {...stylex.props(styles.head, styles.wideOnly)}>
                  {format(m.personColumnWhen)}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((entry) => (
                <tr
                  key={entry.id}
                  data-testid="person-entry"
                  data-entry-id={entry.id}
                  data-entry-status={entry.status}
                >
                  <td {...stylex.props(styles.cell)}>
                    <PageLink
                      page="assessment/batch"
                      params={{ batchId: entry.batchId }}
                      className={stylex.props(styles.link).className}
                    >
                      {entry.batchName}
                    </PageLink>
                  </td>
                  <td {...stylex.props(styles.cell)}>{entry.itemTitle}</td>
                  <td {...stylex.props(styles.cell)}>
                    <Badge variant={entry.status === 'approved' ? 'secondary' : 'outline'}>
                      {statusWord[entry.status]}
                    </Badge>
                  </td>
                  <td {...stylex.props(styles.cell, styles.quietCell, styles.wideOnly)}>
                    {sourceWord[entry.source]}
                  </td>
                  <td {...stylex.props(styles.cell, styles.quietCell, styles.wideOnly)}>
                    {when.moment(new Date(entry.createdAt).getTime())}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {rows.hasNextPage && (
          <Button
            variant="outline"
            size="sm"
            className={stylex.props(styles.more).className}
            disabled={rows.isFetchingNextPage}
            onClick={() => void rows.fetchNextPage()}
          >
            {format(m.personLoadMore)}
          </Button>
        )}
      </AsyncSection>
    </PageContainer>
  )
}
