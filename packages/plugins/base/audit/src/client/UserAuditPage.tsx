import { useQuery } from '@tanstack/react-query'
import { pageNumber } from '@qualy/api-kit/schema'
import * as stylex from '@stylexjs/stylex'
import {
  useApiQuery,
  useLoadFailure,
  usePageQueryState,
  usePageRouteParams,
  usePageQueryUpdate,
} from '@qualy/web-runtime'

import { AsyncSection } from '@qualy/ui/admin'
import { Card, SectionHead, TableSkeleton } from '@qualy/ui/screen'
import { ToggleGroup, ToggleGroupItem } from '@qualy/ui/toggle-group'

import { auditApi } from './api.ts'
import { EventTable } from './EventTable.tsx'
import { EventPager } from './EventPager.tsx'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

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
  const query = useApiQuery(auditApi)

  const describe = useLoadFailure()
  // kept in the address, so a reload or a link keeps which half is read
  const [view] = usePageQueryState('view')
  const [pageParam, setPageParam] = usePageQueryState('page')
  const write = usePageQueryUpdate()
  const by = view === 'by'
  const filter = by ? { actorUserId: userId } : { targetKind: PERSON_TARGET, targetId: userId }
  const filterKey = JSON.stringify(filter)
  const events = useQuery({
    ...query.audit.listAuditEvents.queryOptions({
      query: { ...filter, page: String(pageNumber(pageParam)) },
    }),
    meta: { auditFilter: filterKey },
    // Keep the current page while turning it, but never show a different filter's rows.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.meta?.['auditFilter'] === filterKey ? previous : undefined,
  })
  const rows = events.data?.items ?? []

  return (
    <div {...stylex.props(styles.page)} data-testid="user-audit" data-view={by ? 'by' : 'about'}>
      <SectionHead
        title={m.userEvents_title()}
        actions={
          <ToggleGroup
            aria-label={m.userEvents_view()}
            value={by ? 'by' : 'about'}
            onValueChange={(next) => {
              if (next === '') return
              write({ view: next === 'by' ? 'by' : '', page: '' })
            }}
          >
            <ToggleGroupItem value="about">{m.userEvents_about()}</ToggleGroupItem>
            <ToggleGroupItem value="by">{m.userEvents_by()}</ToggleGroupItem>
          </ToggleGroup>
        }
      />
      <section
        data-testid="audit-results"
        aria-label={m.userEvents_title()}
        aria-busy={events.isFetching}
        tabIndex={-1}
      >
        <AsyncSection
          pending={events.isPending}
          error={events.isError ? describe.of(events.error) : undefined}
          retrying={events.isFetching}
          framed
          loadingLabel={commonMessages.state_loading()}
          retryLabel={commonMessages.action_retry()}
          onRetry={() => void events.refetch()}
          skeleton={<TableSkeleton />}
        >
          <Card data-testid="audit-table">
            <EventTable
              rows={rows}
              empty={(by ? m.userEvents_emptyBy : m.userEvents_emptyAbout)()}
              // what was done to them is all about them: their name on every row says nothing
              hideTarget={!by}
            />
            {events.data && (
              <EventPager
                result={events.data}
                busy={events.isFetching}
                onPage={(next) => setPageParam(next === 1 ? '' : String(next))}
              />
            )}
          </Card>
        </AsyncSection>
      </section>
    </div>
  )
}
