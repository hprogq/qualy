import { useEffect, useId, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { ChevronDownIcon, CircleCheckIcon } from 'lucide-react'
import { PageLink, useApiQuery, useLoadFailure, usePageHref } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@qualy/ui/dialog'
import { Pager } from '@qualy/ui/pager'
import { Skeleton } from '@qualy/ui/skeleton'
import { UnitPath } from '@qualy/ui/unit-path'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { DialogBlank } from '../DialogBlank.tsx'
import { UNNAMED } from './unit-path.ts'

// Which questions some people on the roster cannot file, and who they are.
//
// A question's ordinary route asks, step by step, for kinds of unit; somebody
// who sits under none of them has nowhere for their filing to go (§32.93).
// The two ways out are the question's and the list's: change the route, or
// take the people off. So each question says what its steps ask for, leads
// to its settings, and shows its people a page at a time on request - a
// school's worth of names is not laid out on arrival - each of whom opens
// on a press.

/** people per page under one question */
const PAGE_SIZE = 10

const styles = stylex.create({
  // as tall as what it holds, up to a ceiling where the questions scroll
  panel: { maxHeight: 'min(90dvh, 44rem)' },
  body: { gap: 12 },
  waiting: { display: 'flex', flexDirection: 'column', gap: 8 },
  waitingRow: { height: 64, width: '100%' },
  list: {
    display: 'flex',
    flexDirection: 'column',
    margin: 0,
    padding: 0,
    listStyleType: 'none',
    borderRadius: tokens.radiusMd,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    backgroundColor: tokens.surface,
  },
  question: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    paddingInline: 16,
    paddingBlock: 12,
    borderTopWidth: { default: 1, ':first-child': 0 },
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
  },
  head: {
    display: 'flex',
    flexWrap: { default: 'nowrap', [breakpoints.phone]: 'wrap' },
    alignItems: 'center',
    columnGap: 12,
    rowGap: 6,
  },
  what: { display: 'flex', minWidth: 0, flexGrow: 1, flexDirection: 'column', gap: 2 },
  title: {
    minWidth: 0,
    fontSize: 14,
    lineHeight: '1.25rem',
    fontWeight: 500,
    overflowWrap: 'anywhere',
  },
  levels: { fontSize: 12.5, color: tokens.mutedForeground },
  count: {
    flexShrink: 0,
    fontSize: 13,
    fontVariantNumeric: 'tabular-nums',
    color: tokens.mutedForeground,
    whiteSpace: 'nowrap',
  },
  keys: { display: 'flex', flexShrink: 0, alignItems: 'center', gap: 6 },
  chevron: { transitionProperty: 'transform', transitionDuration: '120ms' },
  chevronOpen: { transform: 'rotate(180deg)' },
  people: {
    display: 'flex',
    flexDirection: 'column',
    margin: 0,
    padding: 0,
    listStyleType: 'none',
    borderRadius: tokens.radiusMd,
    backgroundColor: tokens.surfaceInset,
  },
  person: {
    display: 'grid',
    width: '100%',
    // the same columns on every row, so the numbers and units line up down
    // the list; a long name gives way first
    gridTemplateColumns: {
      default: 'minmax(0, 10rem) 6.5rem minmax(0, 1fr)',
      [breakpoints.phone]: 'minmax(0, 1fr) auto',
    },
    alignItems: 'center',
    columnGap: 12,
    rowGap: 2,
    minHeight: 36,
    borderWidth: 0,
    borderRadius: tokens.radiusMd,
    paddingInline: 10,
    paddingBlock: 6,
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 60%, transparent)`,
    },
    fontFamily: 'inherit',
    fontSize: 13,
    textAlign: 'start',
    color: tokens.foreground,
    cursor: 'pointer',
    outline: 'none',
    boxShadow: { default: 'none', ':focus-visible': `inset 0 0 0 2px ${tokens.focusRing}` },
  },
  personName: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  personNumber: {
    fontVariantNumeric: 'tabular-nums',
    color: tokens.mutedForeground,
    whiteSpace: 'nowrap',
  },
  personUnit: {
    display: 'flex',
    minWidth: 0,
    color: tokens.mutedForeground,
    gridColumn: { default: null, [breakpoints.phone]: '1 / -1' },
  },
  pages: { display: 'flex', paddingTop: 4 },
})

type Route = {
  readonly itemId: string
  readonly itemTitle: string
  readonly participants: number
  readonly levelNames: readonly string[]
}

export function UnreachableDialog({
  batchId,
  open,
  onClose,
  onOpenPerson,
}: {
  batchId: string
  open: boolean
  onClose: () => void
  /** open somebody's account, from the roster this dialog stands over */
  onOpenPerson: (participantId: string) => void
}) {
  const query = useApiQuery(assessmentApi)
  const { format } = useI18n()
  const failures = useLoadFailure()
  // the same reading the roster's notice counts from
  const alerts = useQuery({
    ...query.assessment.reviewAlerts.queryOptions({ params: { batchId } }),
    enabled: open,
  })
  const routes: readonly Route[] = (alerts.data?.unreachable.routes ?? []).filter(
    (route) => route.route === 'normal',
  )
  // one question's people at a time: two lists open read as one
  const [unfolded, setUnfolded] = useState<string | null>(null)
  useEffect(() => {
    if (!open) setUnfolded(null)
  }, [open])

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent data-testid="unreachable-dialog" size="44rem" xstyle={styles.panel}>
        <DialogHeader>
          <DialogTitle>{format(m.unreachableTitle)}</DialogTitle>
          {routes.length > 0 && <DialogDescription>{format(m.unreachableHint)}</DialogDescription>}
        </DialogHeader>
        <DialogBody xstyle={styles.body}>
          <AsyncSection
            pending={alerts.isPending}
            error={alerts.isError ? failures.of(alerts.error) : null}
            retrying={alerts.isFetching}
            loadingLabel={format(commonMessages.loading)}
            retryLabel={format(commonMessages.retry)}
            onRetry={() => void alerts.refetch()}
            skeleton={
              <div {...stylex.props(styles.waiting)}>
                <Skeleton className={stylex.props(styles.waitingRow).className} />
                <Skeleton className={stylex.props(styles.waitingRow).className} />
              </div>
            }
          >
            {routes.length === 0 ? (
              <DialogBlank
                testId="unreachable-quiet"
                icon={<CircleCheckIcon />}
                title={format(m.unreachableQuiet)}
              />
            ) : (
              <ul data-testid="unreachable-questions" {...stylex.props(styles.list)}>
                {routes.map((route) => (
                  <QuestionRow
                    key={route.itemId}
                    batchId={batchId}
                    route={route}
                    unfolded={unfolded === route.itemId}
                    onUnfold={() =>
                      setUnfolded((now) => (now === route.itemId ? null : route.itemId))
                    }
                    onOpenPerson={onOpenPerson}
                  />
                ))}
              </ul>
            )}
          </AsyncSection>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {format(commonMessages.close)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** one question, what its steps ask for, and its people on request */
function QuestionRow({
  batchId,
  route,
  unfolded,
  onUnfold,
  onOpenPerson,
}: {
  batchId: string
  route: Route
  unfolded: boolean
  onUnfold: () => void
  onOpenPerson: (participantId: string) => void
}) {
  const { format, locale } = useI18n()
  const peopleId = useId()
  // a reader who cannot open the question's settings is not led to a closed door
  const settings = usePageHref('assessment/batch-items', {
    params: { batchId },
    search: { question: route.itemId },
  })
  const levels =
    route.levelNames.length === 0
      ? null
      : new Intl.ListFormat(locale, { type: 'conjunction', style: 'narrow' }).format(
          route.levelNames,
        )
  return (
    <li
      data-testid="unreachable-question"
      data-item={route.itemId}
      data-count={route.participants}
      {...stylex.props(styles.question)}
    >
      <div {...stylex.props(styles.head)}>
        <span {...stylex.props(styles.what)}>
          <span {...stylex.props(styles.title)}>{route.itemTitle}</span>
          {levels !== null && (
            <span {...stylex.props(styles.levels)}>{format(m.unreachableLevels, { levels })}</span>
          )}
        </span>
        <span {...stylex.props(styles.count)}>
          {format(m.unreachableCount, { count: route.participants })}
        </span>
        <span {...stylex.props(styles.keys)}>
          {settings !== undefined && (
            <Button size="sm" variant="outline" asChild>
              <PageLink
                page="assessment/batch-items"
                params={{ batchId }}
                search={{ question: route.itemId }}
              >
                {format(m.unreachableEditQuestion)}
              </PageLink>
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={unfolded}
            aria-controls={peopleId}
            onClick={onUnfold}
          >
            {format(unfolded ? m.unreachableHidePeople : m.unreachableShowPeople)}
            <ChevronDownIcon
              aria-hidden
              {...stylex.props(styles.chevron, unfolded && styles.chevronOpen)}
            />
          </Button>
        </span>
      </div>
      {unfolded && (
        <div id={peopleId}>
          <PeopleOf batchId={batchId} itemId={route.itemId} onOpenPerson={onOpenPerson} />
        </div>
      )}
    </li>
  )
}

/** the people one question's ordinary route finds nowhere, a page at a time */
function PeopleOf({
  batchId,
  itemId,
  onOpenPerson,
}: {
  batchId: string
  itemId: string
  onOpenPerson: (participantId: string) => void
}) {
  const query = useApiQuery(assessmentApi)
  const { format } = useI18n()
  const failures = useLoadFailure()
  const [page, setPage] = useState(1)
  const people = useQuery({
    ...query.assessment.listUnreachableParticipants.queryOptions({
      params: { batchId },
      query: { itemId, route: 'normal', page: String(page), limit: String(PAGE_SIZE) },
    }),
    placeholderData: keepPreviousData,
  })
  const rows = people.data?.items ?? []
  const total = people.data?.total ?? 0
  return (
    <AsyncSection
      pending={people.isPending}
      error={people.isError ? failures.of(people.error) : null}
      retrying={people.isFetching}
      loadingLabel={format(commonMessages.loading)}
      retryLabel={format(commonMessages.retry)}
      onRetry={() => void people.refetch()}
    >
      <ul data-testid="unreachable-people" data-total={total} {...stylex.props(styles.people)}>
        {rows.map((row) => {
          // said from the top down, less the root everybody shares
          const steps = (row.unitPath.length > 1 ? row.unitPath.slice(1) : row.unitPath).map(
            (name) => name ?? UNNAMED,
          )
          return (
            <li key={row.participantId}>
              <button
                type="button"
                data-testid="unreachable-person"
                data-participant={row.participantId}
                onClick={() => onOpenPerson(row.participantId)}
                {...stylex.props(styles.person)}
              >
                <span title={row.displayName} {...stylex.props(styles.personName)}>
                  {row.displayName}
                </span>
                <span {...stylex.props(styles.personNumber)}>{row.businessNo ?? ''}</span>
                {steps.length > 0 && (
                  <span {...stylex.props(styles.personUnit)}>
                    <UnitPath steps={steps} />
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
      {total > PAGE_SIZE && (
        <div {...stylex.props(styles.pages)}>
          <Pager
            compact
            testId="unreachable-pager"
            label={format(m.unreachablePeoplePager)}
            page={people.data?.page ?? page}
            pageSize={PAGE_SIZE}
            total={total}
            disabled={people.isFetching}
            onPage={setPage}
          />
        </div>
      )}
    </AsyncSection>
  )
}
