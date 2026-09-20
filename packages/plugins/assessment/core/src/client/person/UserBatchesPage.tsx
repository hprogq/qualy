import { useInfiniteQuery } from '@tanstack/react-query'
import { GraduationCapIcon } from 'lucide-react'
import { cursorPages, PageLink, useApi, useApiQuery, usePageRouteParams, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { AsyncSection } from '@qualy/ui/admin'
import { Blank, EditorSkeleton, SectionHead } from '@qualy/ui/screen'
import { PageContainer } from '@qualy/ui/page-container'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { StatusBadge } from '../batch/StatusBadge.tsx'
import { useWhen } from '../batch/when.ts'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'

// The rounds one person took part in, as a section of their record. Roster
// membership and nothing else: what they helped run is the grants screen's
// story, and what they filed is the page beside this one.

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

export default function UserBatchesPage() {
  const { userId } = usePageRouteParams('userId')
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const query = useApiQuery(assessmentApi)
  const { format, formatError } = useI18n()
  const when = useWhen()

  const rows = useInfiniteQuery({
    queryKey: [
      ...query.assessment.listUserBatches.key({ params: { userId }, query: {} }),
      'infinite',
    ],
    queryFn: ({ pageParam }) =>
      run(
        api.assessment.listUserBatches({
          params: { userId },
          query: pageParam === undefined ? {} : { cursor: pageParam },
        }),
      ),
    ...cursorPages,
  })
  const items = rows.data?.pages.flatMap((page) => page.items) ?? []

  return (
    <PageContainer size="default" xstyle={styles.page}>
      <SectionHead title={format(m.personBatchesTab)} count={rows.data ? items.length : undefined} />
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
            icon={<GraduationCapIcon />}
            title={format(m.personBatchesEmpty)}
            xstyle={styles.compactBlank}
          />
        ) : (
          <ul {...stylex.props(styles.list)}>
            {items.map(({ batch, membership }) => (
              <li
                key={batch.id}
                data-testid="person-batch"
                data-batch-id={batch.id}
                data-membership={membership.status}
                {...stylex.props(styles.row)}
              >
                <div {...stylex.props(styles.text)}>
                  <p {...stylex.props(styles.name)}>
                    <span>{batch.name}</span>
                    <StatusBadge status={batch.status} currentPhaseId={batch.currentPhaseId} />
                    {membership.status === 'excluded' ? (
                      <Badge variant="outline">{format(m.personMembershipExcluded)}</Badge>
                    ) : (
                      <Badge variant="secondary">{format(m.personMembershipActive)}</Badge>
                    )}
                  </p>
                  <p {...stylex.props(styles.meta)}>
                    <span>{membership.anchorNodeName ?? format(m.personAnchorGone)}</span>
                    {batch.currentPhaseName !== null && <span>{batch.currentPhaseName}</span>}
                    <span>
                      {format(m.personIncludedAt, {
                        when: when.moment(new Date(membership.includedAt).getTime()),
                      })}
                    </span>
                    {membership.excludedAt !== null && (
                      <span>
                        {format(m.personExcludedAt, {
                          when: when.moment(new Date(membership.excludedAt).getTime()),
                        })}
                      </span>
                    )}
                  </p>
                </div>
                <PageLink
                  page="assessment/batch"
                  params={{ batchId: batch.id }}
                  className={stylex.props(styles.link).className}
                  unavailable={null}
                >
                  {format(m.personOpenBatch)}
                </PageLink>
              </li>
            ))}
          </ul>
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
