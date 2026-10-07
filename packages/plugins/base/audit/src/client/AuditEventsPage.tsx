import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { pageNumber } from '@qualy/api-kit/schema'
import { UserRoundIcon, UserRoundXIcon, XIcon } from 'lucide-react'
import { peoplePicker, type PeoplePickerContext } from '@qualy/ui-contract'
import * as stylex from '@stylexjs/stylex'
import {
  UiSlot,
  useApiQuery,
  useLoadFailure,
  useManifest,
  usePageQueryState,
  usePageQueryUpdate,
} from '@qualy/web-runtime'

import { AsyncSection, FormDialog } from '@qualy/ui/admin'
import { Blank, Card, Screen, TableSkeleton } from '@qualy/ui/screen'
import { Skeleton } from '@qualy/ui/skeleton'
import { Button } from '@qualy/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'

import { auditApi } from './api.ts'
import { EventTable } from './EventTable.tsx'
import { EventPager } from './EventPager.tsx'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

// The trail, newest first. One table, three filters, a row opens into its
// correlation ids and details - reading is the whole page, because writing
// is done by operations, never here.
//
// Choosing whose operations to read takes the people picker, which is only
// there for a reader who may look people up. Without it the choice is not
// offered at all - a row's "only this person" still narrows the trail, and
// the narrowing it leaves can still be cleared.

// the select refuses an empty value, and "everything" is a real choice
const ALL = 'all'

const styles = stylex.create({
  filters: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  actionFilter: { width: { default: '14rem', [breakpoints.phone]: '100%' } },
  outcomeFilter: { width: { default: '9rem', [breakpoints.phone]: '100%' } },
  // the third filter, sized like the two beside it: content-width it read
  // as a stray button in a row of fields
  actorFilter: {
    maxWidth: { default: '14rem', [breakpoints.phone]: 'none' },
    width: { default: null, [breakpoints.phone]: '100%' },
    justifyContent: { default: null, [breakpoints.phone]: 'flex-start' },
  },
  actorWord: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  pickerSeat: { display: 'flex', minHeight: 0, flexDirection: 'column' },
  pickerWaiting: { height: '18rem', borderRadius: tokens.radiusLg },
})

export default function AuditEventsPage() {
  const query = useApiQuery(auditApi)
  const failures = useLoadFailure()
  const [action] = usePageQueryState('action')
  const [outcome] = usePageQueryState('outcome')
  const [actor] = usePageQueryState('actor')
  const [pageParam, setPageParam] = usePageQueryState('page')
  const write = usePageQueryUpdate()
  const setActor = (value: string) => write({ actor: value, page: '' })
  const [pickingActor, setPickingActor] = useState(false)
  const pickable = (useManifest().slots[peoplePicker.key]?.length ?? 0) > 0

  const options = useQuery(query.audit.getAuditEventOptions.queryOptions({}))

  const outcomeFilter: 'success' | 'denied' | 'failure' | undefined =
    outcome === 'success' || outcome === 'denied' || outcome === 'failure' ? outcome : undefined
  const filter = {
    ...(action ? { actionCode: action } : {}),
    ...(actor ? { actorUserId: actor } : {}),
    ...(outcomeFilter !== undefined ? { outcome: outcomeFilter } : {}),
  }
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
    <Screen title={m.events_title()} description={m.events_hint()} size="broad">
      <div {...stylex.props(styles.filters)}>
        <Select
          value={action || ALL}
          onValueChange={(value) => write({ action: value === ALL ? '' : value, page: '' })}
        >
          <SelectTrigger size="sm" xstyle={styles.actionFilter}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{m.events_anyAction()}</SelectItem>
            {(options.data?.actions ?? []).map((entry) => (
              <SelectItem key={entry.code} value={entry.code}>
                {entry.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={outcome || ALL}
          onValueChange={(value) => write({ outcome: value === ALL ? '' : value, page: '' })}
        >
          <SelectTrigger size="sm" xstyle={styles.outcomeFilter}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{m.events_anyOutcome()}</SelectItem>
            <SelectItem value="success">{m.events_outcomeSuccess()}</SelectItem>
            <SelectItem value="denied">{m.events_outcomeDenied()}</SelectItem>
            <SelectItem value="failure">{m.events_outcomeFailure()}</SelectItem>
          </SelectContent>
        </Select>
        {actor === '' ? (
          pickable && (
            <Button
              size="sm"
              variant="outline"
              className={stylex.props(styles.actorFilter).className}
              onClick={() => setPickingActor(true)}
            >
              <UserRoundIcon aria-hidden />
              {m.filter_anyActor()}
            </Button>
          )
        ) : (
          <Button
            size="sm"
            variant="outline"
            className={stylex.props(styles.actorFilter).className}
            data-testid="actor-filter"
            data-actor={actor}
            onClick={() => setActor('')}
          >
            <span {...stylex.props(styles.actorWord)}>
              {rows.find((row) => row.actorUserId === actor)?.actorLabel ?? m.filter_oneActor()}
            </span>
            <XIcon aria-hidden />
          </Button>
        )}
      </div>

      <section
        data-testid="audit-results"
        aria-label={m.events_title()}
        aria-busy={events.isFetching}
        tabIndex={-1}
      >
        <AsyncSection
          pending={events.isPending}
          error={events.isError ? failures.of(events.error) : undefined}
          retrying={events.isFetching}
          framed
          loadingLabel={commonMessages.state_loading()}
          retryLabel={commonMessages.action_retry()}
          onRetry={() => void events.refetch()}
          skeleton={<TableSkeleton />}
        >
          <Card data-testid="audit-table">
            <EventTable rows={rows} empty={m.events_empty()} onlyActor={setActor} />
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
      {/* a tree beside a roster, which is the shape the picker has wherever
          it is opened; at a form's width the two columns had a few
          characters each */}
      <FormDialog
        open={pickingActor && pickable}
        size="wide"
        title={m.filter_pickActor()}
        onClose={() => setPickingActor(false)}
      >
        <div {...stylex.props(styles.pickerSeat)}>
          <UiSlot
            token={peoplePicker}
            context={
              {
                value: actor === '' ? [] : [actor],
                onChange: (ids) => {
                  setActor(ids[0] ?? '')
                  setPickingActor(false)
                },
                single: true,
              } satisfies PeoplePickerContext
            }
            loading={<Skeleton className={stylex.props(styles.pickerWaiting).className} />}
            fallback={
              <Blank
                size="compact"
                icon={<UserRoundXIcon />}
                title={m.filter_pickActorUnavailableTitle()}
                description={m.filter_pickActorUnavailable()}
              />
            }
          />
        </div>
      </FormDialog>
    </Screen>
  )
}
