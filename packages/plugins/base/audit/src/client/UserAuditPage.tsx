import { useInfiniteQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import * as stylex from '@stylexjs/stylex'
import {
  cursorPages,
  useApi,
  useApiQuery,
  usePageQueryState,
  usePageRouteParams,
  useRunApi,
} from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Card, CardFoot, FootNote, SectionHead, Spacer, TableSkeleton } from '@qualy/ui/screen'
import { ToggleGroup, ToggleGroupItem } from '@qualy/ui/toggle-group'
import { auditMessages as m } from './i18n.ts'
import { auditApi } from './api.ts'
import { EventTable } from './EventTable.tsx'

// One person's part of the trail, as a section of their record: what was
// done to their account, and what they did. Everything the trail keeps -
// who did it, from where, refused attempts too - for whoever may read the
// trail at all; the person's own account shows them a plainer account of
// the first half.

/** what the trail calls a person when one is the object of an operation */
const PERSON_TARGET = 'auth.user'

const styles = stylex.create({
  page: { display: 'flex', flexDirection: 'column', gap: 12 },
})

export default function UserAuditPage() {
  const { userId } = usePageRouteParams('userId')
  const api = useApi(auditApi)
  const runApi = useRunApi()
  const query = useApiQuery(auditApi)
  const { format } = useI18n()
  // kept in the address, so a reload or a link keeps which half is read
  const [view, setView] = usePageQueryState('view')
  const by = view === 'by'
  const filter = by ? { actorUserId: userId } : { targetKind: PERSON_TARGET, targetId: userId }
  const events = useInfiniteQuery({
    queryKey: [...query.audit.listAuditEvents.key({ query: filter }), 'infinite'],
    queryFn: ({ pageParam }) =>
      runApi(
        api.audit.listAuditEvents({
          query: { ...filter, ...(pageParam !== undefined ? { cursor: pageParam } : {}) },
        }),
      ),
    ...cursorPages,
  })
  const rows = useMemo(() => events.data?.pages.flatMap((page) => page.items) ?? [], [events.data])

  return (
    <div {...stylex.props(styles.page)} data-testid="user-audit" data-view={by ? 'by' : 'about'}>
      <SectionHead
        title={format(m.userEvents)}
        actions={
          <ToggleGroup
            aria-label={format(m.userEventsView)}
            value={by ? 'by' : 'about'}
            onValueChange={(next) => {
              if (next === '') return
              setView(next === 'by' ? 'by' : '')
            }}
          >
            <ToggleGroupItem value="about">{format(m.userEventsAbout)}</ToggleGroupItem>
            <ToggleGroupItem value="by">{format(m.userEventsBy)}</ToggleGroupItem>
          </ToggleGroup>
        }
      />
      <AsyncSection
        pending={events.isPending}
        error={events.isError ? format(m.loadFailed) : undefined}
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => void events.refetch()}
        skeleton={<TableSkeleton />}
      >
        <Card data-testid="audit-table">
          <EventTable
            rows={rows}
            empty={format(by ? m.userEventsEmptyBy : m.userEventsEmptyAbout)}
          />
          {rows.length > 0 && (
            <CardFoot>
              <FootNote>
                <span data-testid="audit-count" data-count={rows.length}>
                  {format(m.loadedCount, { count: rows.length })}
                </span>
              </FootNote>
              <Spacer />
              {events.hasNextPage && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={events.isFetchingNextPage}
                  onClick={() => void events.fetchNextPage()}
                >
                  {format(m.loadMore)}
                </Button>
              )}
            </CardFoot>
          )}
        </Card>
      </AsyncSection>
    </div>
  )
}
