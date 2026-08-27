import { useMemo, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { CornerDownLeftIcon, FileTextIcon, SearchIcon, ShieldIcon } from 'lucide-react'
import { useApiQuery, usePageNavigate, usePageQueryState } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { visuallyHidden } from '@qualy/ui/visually-hidden'
import { AsyncSection } from '@qualy/ui/admin'
import { Avatar, AvatarFallback } from '@qualy/ui/avatar'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import { Skeleton } from '@qualy/ui/skeleton'
import { DoneMark, Stagger } from '@qualy/ui/reveal'
import { Tabs, TabsList, TabsTrigger } from '@qualy/ui/tabs'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentApi } from '../api.ts'
import { useBatchLive } from '../live.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { BatchScreen } from '../batch/BatchScreen.tsx'
import { AwaitingSection } from './AwaitingSection.tsx'
import {
  groupByDay,
  groupByItem,
  groupByPerson,
  matchesSearch,
  rowSummary,
  timeLabel,
  clockLabel,
  writeRunScope,
  type InboxItemDto,
} from './model.ts'

// The queue, laid out three ways: by question so one standard is applied in
// a row, by submitted time to clear a backlog oldest first, by participant
// so one person's duplicates sit next to each other. Every row opens the
// same workbench; the layout only decides which rows it walks in a run.

const md = '@media (min-width: 768px)'
const belowSm = '@media (max-width: 639.98px)'
const belowMd = '@media (max-width: 767.98px)'

const styles = stylex.create({
  fill: {
    display: 'flex',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
  },
  queue: {
    display: 'flex',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
    gap: 16,
  },
  // One register per breakpoint. On a phone the row is the segmented switch
  // and one search key - the two selects and the counters are desktop
  // instruments, and stacked together here they were a wall of controls
  // above three rows of work. On a desk the row is exactly what it was:
  // everything at tab height, side by side.
  controls: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  controlRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  tabCount: {
    borderRadius: tokens.radiusSm,
    backgroundColor: tokens.surfaceMuted,
    paddingInline: 4,
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
  },
  seekKey: {
    width: 36,
    height: 36,
    display: {
      default: 'inline-flex',
      [md]: 'none',
    },
  },
  seekKeyOpen: {
    backgroundColor: tokens.surfaceMuted,
  },
  // every control on this row is the same height as the tabs beside it: a
  // row of filters that do not line up reads as two rows
  deskOnly: {
    display: {
      default: 'none',
      [md]: 'contents',
    },
  },
  // one narrowing of the queue never wider than its longest sensible name
  filterWidth: {
    maxWidth: 208,
  },
  searchSeat: {
    position: 'relative',
  },
  searchIcon: {
    pointerEvents: 'none',
    position: 'absolute',
    top: '50%',
    left: 12,
    width: 14,
    height: 14,
    transform: 'translateY(-50%)',
    color: tokens.mutedForeground,
  },
  searchInput: {
    height: 36,
    width: 240,
    paddingLeft: 34,
  },
  searchInputWide: {
    height: 36,
    width: '100%',
    paddingLeft: 34,
  },
  phoneSearchSeat: {
    position: 'relative',
    display: {
      default: 'block',
      [md]: 'none',
    },
  },
  spacer: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  // the same three numbers the desk keeps at the row's end, as one quiet
  // line: a phone without them made the two registers count different things
  phoneStats: {
    display: {
      default: 'flex',
      [md]: 'none',
    },
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: 6,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  phoneStatNum: {
    fontWeight: 500,
    color: tokens.foreground,
    fontVariantNumeric: 'tabular-nums',
  },
  stats: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: 20,
  },
  stat: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 2,
  },
  statLabel: {
    fontSize: 12,
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
  statValue: {
    fontSize: 16,
    lineHeight: 1,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
  },
  quietFiled: {
    color: tokens.mutedForeground,
  },
  noMatches: {
    borderRadius: `calc(${tokens.radiusLg} + 4px)`,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    paddingInline: 20,
    paddingBlock: 16,
    fontSize: 14,
    color: tokens.mutedForeground,
  },
  groups: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  groupFrame: {
    overflow: 'hidden',
    borderRadius: `calc(${tokens.radiusLg} + 4px)`,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
  },
  groupHead: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 50%, transparent)`,
    paddingInline: 16,
    paddingBlock: 10,
  },
  groupHeadTight: {
    paddingBlock: 8,
  },
  groupTitle: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 14,
    fontWeight: 600,
  },
  groupTitleNums: {
    fontVariantNumeric: 'tabular-nums',
  },
  groupCount: {
    fontSize: 12,
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
  personAvatar: {
    width: 28,
    height: 28,
  },
  personInitial: {
    fontSize: 12,
  },
  personUnit: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  runCount: {
    fontVariantNumeric: 'tabular-nums',
  },
  /** the column names, which name nothing once the columns are gone */
  head: {
    display: {
      default: 'grid',
      [belowMd]: 'none',
    },
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    paddingInline: 16,
    paddingBlock: 6,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  headValues: {
    display: 'flex',
    minWidth: 0,
    gap: 12,
  },
  /**
   * One queued filing.
   *
   * A table of columns where there is room for one, and two lines where
   * there is not: who and when on the first, what they filed on the second.
   * The track widths are inline, so narrow says flex instead of overriding
   * them - a grid told 11rem of name on a 390px screen has nowhere to put
   * the rest of the row, and the whole queue leaves the side of the phone.
   */
  row: {
    display: {
      default: 'grid',
      [belowMd]: 'flex',
    },
    width: '100%',
    cursor: 'pointer',
    alignItems: 'center',
    gap: {
      default: 12,
      [belowMd]: null,
    },
    flexWrap: {
      default: null,
      [belowMd]: 'wrap',
    },
    columnGap: {
      default: null,
      [belowMd]: 8,
    },
    rowGap: {
      default: null,
      [belowMd]: 4,
    },
    borderBottomWidth: {
      default: 1,
      ':last-child': 0,
    },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    paddingInline: 16,
    paddingBlock: 10,
    textAlign: 'left',
    fontSize: 14,
    transitionProperty: 'color, background-color',
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 50%, transparent)`,
    },
  },
  /** what drops to a line of its own under the row's first line */
  wraps: {
    order: {
      default: null,
      [belowMd]: 9999,
    },
    flexBasis: {
      default: null,
      [belowMd]: '100%',
    },
  },
  who: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'baseline',
    gap: 8,
    flexGrow: {
      default: null,
      [belowMd]: 1,
    },
  },
  whoName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontWeight: 500,
  },
  whoNo: {
    flexShrink: 0,
    fontSize: 12,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  values: {
    display: 'flex',
    minWidth: 0,
    gap: 12,
  },
  value: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  when: {
    fontSize: 12,
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  titleCell: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  titleCellGrows: {
    flexGrow: {
      default: null,
      [belowMd]: 1,
    },
  },
  titleCellStrong: {
    fontWeight: 500,
  },
  summaryCell: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
  filesCell: {
    fontSize: 12,
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
  chipCell: {
    display: 'flex',
    justifyContent: 'flex-end',
  },
  // ---- the queue's own shape, greyed ----
  skColumn: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  skControls: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  skSearch: {
    height: 36,
    width: 288,
    flexGrow: {
      default: null,
      [belowSm]: 1,
    },
  },
  skFilter: {
    height: 36,
    width: 112,
    display: {
      default: 'block',
      [belowSm]: 'none',
    },
  },
  skSpacer: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    display: {
      default: 'block',
      [belowSm]: 'none',
    },
  },
  skStats: {
    height: 36,
    width: 160,
    display: {
      default: 'block',
      [belowSm]: 'none',
    },
  },
  skFrame: {
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: `calc(${tokens.radiusLg} + 4px)`,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
  },
  skRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    borderTopWidth: {
      default: 1,
      ':first-child': 0,
    },
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    paddingInline: 16,
    paddingBlock: 14,
  },
  skName: {
    height: 16,
    width: 96,
    flexShrink: 0,
  },
  skValue: {
    height: 16,
  },
  skWhen: {
    marginLeft: 'auto',
    height: 16,
    width: 56,
    flexShrink: 0,
    display: {
      default: 'block',
      [belowSm]: 'none',
    },
  },
  skChip: {
    height: 32,
    width: 64,
    flexShrink: 0,
  },
  // ---- a quiet day, said in full ----
  emptyScreen: {
    display: 'flex',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBlock: 64,
  },
  emptyStack: {
    display: 'flex',
    maxWidth: '28rem',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 20,
    textAlign: 'center',
  },
  emptyBadge: {
    display: 'flex',
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '9999px',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    color: tokens.mutedForeground,
  },
  emptyIcon: {
    width: 20,
    height: 20,
  },
  emptyWords: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: 600,
    letterSpacing: '-0.025em',
  },
  emptyBody: {
    fontSize: 14,
    lineHeight: 1.625,
    textWrap: 'pretty',
    color: tokens.mutedForeground,
  },
})

type View = 'item' | 'time' | 'person' | 'asked'

export default function ReviewInboxPage() {
  const { format } = useI18n()
  const [view, setView] = usePageQueryState('view', 'item')
  return (
    <BatchScreen title={format(m.reviewTab)} description={format(m.reviewHint)} size="wide">
      {(batch) =>
        batch.capabilities.review ? (
          <Queue batchId={batch.id} view={(view as View) || 'item'} onView={setView} />
        ) : (
          // said as what it is: no standing here, not an empty queue -
          // pretending otherwise makes permission problems look like quiet
          // days
          <EmptyScreen
            icon={<ShieldIcon aria-hidden className={stylex.props(styles.emptyIcon).className} />}
            title={format(m.reviewNoRoleTitle)}
            body={format(m.reviewNoStandingHint)}
          />
        )
      }
    </BatchScreen>
  )
}

function Queue({
  batchId,
  view,
  onView,
}: {
  batchId: string
  view: View
  onView: (next: string) => void
}) {
  const query = useApiQuery(assessmentApi)
  const { format, formatError } = useI18n()
  const [itemFilter, setItemFilter] = usePageQueryState('item')
  const [unitFilter, setUnitFilter] = usePageQueryState('unit')
  const [search, setSearch] = usePageQueryState('q')
  // the phone's search input stands behind its key; a search already typed
  // (arriving via the address) keeps the input on show
  const [seeking, setSeeking] = useState(search !== '')
  const queryClient = useQueryClient()
  // queue changes arrive as wake-ups; the poll below is the fallback pace
  const { live } = useBatchLive(batchId, (kind) => {
    if (
      kind !== 'sync' &&
      kind !== 'phase-changed' &&
      kind !== 'review-inbox-changed' &&
      kind !== 'review-instance-changed'
    ) {
      return
    }
    void queryClient.invalidateQueries({
      queryKey: query.assessment.listReviewInbox.key({ query: { batchId } }),
    })
    void queryClient.invalidateQueries({
      queryKey: query.assessment.listAwaitingSupplements.key({ query: { batchId } }),
    })
  })
  const inbox = useQuery({
    ...query.assessment.listReviewInbox.queryOptions({ query: { batchId } }),
    refetchInterval: live ? 60_000 : 30_000,
  })
  // the same read the section below makes; one request either way, and the
  // header can say how much is out with somebody else without owning the list
  const asked = useQuery({
    ...query.assessment.listAwaitingSupplements.queryOptions({ query: { batchId } }),
    refetchInterval: live ? 60_000 : 30_000,
  })
  const awaiting = asked.data?.items.length ?? 0
  const all = useMemo(
    () => (inbox.data?.items ?? []).filter((item) => item.batchId === batchId),
    [inbox.data, batchId],
  )
  const rows = useMemo(
    () =>
      all.filter(
        (row) =>
          (itemFilter === '' || row.itemId === itemFilter) &&
          (unitFilter === '' || row.unitId === unitFilter) &&
          matchesSearch(row, search.trim()),
      ),
    [all, itemFilter, unitFilter, search],
  )
  const itemOptions = useMemo(
    () =>
      [...new Map(all.map((row) => [row.itemId, row.itemTitle])).entries()]
        .map(([id, title]) => [id, title] as const)
        .sort(([, a], [, b]) => a.localeCompare(b)),
    [all],
  )
  const unitOptions = useMemo(
    () =>
      [
        ...new Map(
          all.flatMap((row) => (row.unitId === null ? [] : [[row.unitId, row.unitName ?? '']])),
        ).entries(),
      ]
        .map(([id, name]) => [id, String(name)] as const)
        .sort(([, a], [, b]) => a.localeCompare(b)),
    [all],
  )

  return (
    <AsyncSection
      pending={inbox.isPending}
      error={inbox.error ? formatError(inbox.error) : null}
      loadingLabel={format(commonMessages.loading)}
      retryLabel={format(commonMessages.retry)}
      onRetry={() => void inbox.refetch()}
      skeleton={
        // the queue's own shape, greyed: the control row, then rows of
        // work - not one anonymous slab
        <div {...stylex.props(styles.skColumn)}>
          <div {...stylex.props(styles.skControls)}>
            <Skeleton className={stylex.props(styles.skSearch).className} />
            <Skeleton className={stylex.props(styles.skFilter).className} />
            <Skeleton className={stylex.props(styles.skFilter).className} />
            <span {...stylex.props(styles.skSpacer)} />
            <Skeleton className={stylex.props(styles.skStats).className} />
          </div>
          <div {...stylex.props(styles.skFrame)}>
            {['33%', '50%', '40%', '25%', '40%'].map((width, index) => (
              <div key={index} {...stylex.props(styles.skRow)}>
                <Skeleton className={stylex.props(styles.skName).className} />
                <Skeleton className={stylex.props(styles.skValue).className} style={{ width }} />
                <Skeleton className={stylex.props(styles.skWhen).className} />
                <Skeleton className={stylex.props(styles.skChip).className} />
              </div>
            ))}
          </div>
        </div>
      }
      xstyle={styles.fill}
    >
      <div {...stylex.props(styles.queue)}>
        <div {...stylex.props(styles.controls)}>
          <div {...stylex.props(styles.controlRow)}>
            <Tabs
              variant="segmented"
              value={view}
              onValueChange={onView}
              className="max-md:min-w-0 max-md:flex-1"
            >
              <TabsList className="max-md:grid max-md:w-full max-md:grid-cols-4">
                <TabsTrigger value="item">{format(m.reviewTabByItem)}</TabsTrigger>
                <TabsTrigger value="time">{format(m.reviewTabByTime)}</TabsTrigger>
                <TabsTrigger value="person">{format(m.reviewTabByPerson)}</TabsTrigger>
                {/* Its own room, not a section under the queue: what is out
                    with somebody else is nothing to decide now, and stacked
                    below the queue it shouted over every empty state. The
                    count rides the tab so the door says whether it is worth
                    opening. */}
                <TabsTrigger value="asked">
                  {format(m.reviewAwaitingTab)}
                  {awaiting > 0 && <span {...stylex.props(styles.tabCount)}>{awaiting}</span>}
                </TabsTrigger>
              </TabsList>
            </Tabs>
            {view !== 'asked' && (
              <Button
                variant="outline"
                size="icon"
                className={stylex.props(styles.seekKey, seeking && styles.seekKeyOpen).className}
                aria-pressed={seeking}
                onClick={() => setSeeking((open) => !open)}
              >
                <SearchIcon aria-hidden />
                <span {...stylex.props(visuallyHidden.text)}>
                  {format(m.reviewSearchPlaceholder)}
                </span>
              </Button>
            )}
            <div {...stylex.props(styles.deskOnly)}>
              {view !== 'person' && view !== 'asked' && (
                <Filter
                  label={format(m.reviewFilterAllItems)}
                  value={itemFilter}
                  options={itemOptions}
                  onChange={setItemFilter}
                />
              )}
              {view !== 'time' && view !== 'asked' && unitOptions.length > 0 && (
                <Filter
                  label={format(m.reviewFilterAllUnits)}
                  value={unitFilter}
                  options={unitOptions}
                  onChange={setUnitFilter}
                />
              )}
              {view !== 'asked' && (
                <div {...stylex.props(styles.searchSeat)}>
                  <SearchIcon aria-hidden className={stylex.props(styles.searchIcon).className} />
                  <Input
                    name="review-search"
                    aria-label={format(m.reviewSearchPlaceholder)}
                    className={stylex.props(styles.searchInput).className}
                    value={search}
                    placeholder={format(m.reviewSearchPlaceholder)}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
              )}
              <span {...stylex.props(styles.spacer)} />
              <Stats
                pending={all.length}
                handledToday={inbox.data?.handledToday ?? 0}
                awaiting={awaiting}
              />
            </div>
          </div>
          <p {...stylex.props(styles.phoneStats)}>
            <span>{format(m.reviewStatPending)}</span>
            <span {...stylex.props(styles.phoneStatNum)}>{all.length}</span>
            {awaiting > 0 && (
              <>
                <span aria-hidden>·</span>
                <span>{format(m.reviewAwaitingTab)}</span>
                <span {...stylex.props(styles.phoneStatNum)}>{awaiting}</span>
              </>
            )}
            <span aria-hidden>·</span>
            <span>{format(m.reviewStatToday)}</span>
            <span {...stylex.props(styles.phoneStatNum)}>{inbox.data?.handledToday ?? 0}</span>
          </p>
          {seeking && view !== 'asked' && (
            <div {...stylex.props(styles.phoneSearchSeat)}>
              <SearchIcon aria-hidden className={stylex.props(styles.searchIcon).className} />
              <Input
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                name="review-search"
                aria-label={format(m.reviewSearchPlaceholder)}
                className={stylex.props(styles.searchInputWide).className}
                value={search}
                placeholder={format(m.reviewSearchPlaceholder)}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          )}
        </div>

        {/* the awaiting view is its own room; the queue's empty states are
            about the queue alone, so all-done gets its whole screen back */}
        {view === 'asked' ? (
          <AwaitingSection batchId={batchId} />
        ) : all.length === 0 ? (
          // two different quiet days: everything handled, or nothing has
          // arrived yet. The counter is what tells them apart
          (inbox.data?.handledToday ?? 0) > 0 ? (
            <EmptyScreen
              mark={<DoneMark />}
              title={format(m.reviewAllDoneTitle)}
              body={format(m.reviewAllDoneBody, { count: inbox.data?.handledToday ?? 0 })}
            />
          ) : (
            <EmptyScreen
              icon={
                <FileTextIcon aria-hidden className={stylex.props(styles.emptyIcon).className} />
              }
              title={format(m.reviewNothingTitle)}
              body={format(m.reviewNothingBody)}
            />
          )
        ) : rows.length === 0 ? (
          <p {...stylex.props(styles.noMatches)}>{format(m.reviewMatchesNone)}</p>
        ) : view === 'item' ? (
          <ByItem batchId={batchId} rows={rows} />
        ) : view === 'time' ? (
          <ByTime batchId={batchId} rows={rows} />
        ) : (
          <ByPerson batchId={batchId} rows={rows} />
        )}
      </div>
    </AsyncSection>
  )
}

/** how much is waiting and how much moved, beside the filters they describe */
function Stats({
  pending,
  handledToday,
  awaiting,
}: {
  pending: number
  handledToday: number
  /** out with somebody else; shown only when there is any, never as a zero */
  awaiting: number
}) {
  const { format } = useI18n()
  return (
    <div {...stylex.props(styles.stats)}>
      <Stat label={format(m.reviewStatPending)} value={pending} />
      {awaiting > 0 && <Stat label={format(m.reviewAwaitingTitle)} value={awaiting} />}
      <Stat label={format(m.reviewStatToday)} value={handledToday} />
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span {...stylex.props(styles.stat)}>
      <span {...stylex.props(styles.statLabel)}>{label}</span>
      <span {...stylex.props(styles.statValue)}>{value}</span>
    </span>
  )
}

/**
 * One answer in a list cell.
 *
 * A field that asks for files is a field: it keeps its own column under its
 * own name and says how many were filed under it. Folding every such field
 * into a single "materials" count at the end of the row made "the
 * certificate" and "a photo of the ceremony" into the same fact.
 */
function FiledValue({ pair }: { pair: InboxItemDto['values'][number] }) {
  const { format } = useI18n()
  if (pair.files === null) return <>{pair.value}</>
  return (
    <span {...stylex.props(pair.files === 0 && styles.quietFiled)}>
      {format(m.reviewFilesCount, { count: pair.files })}
    </span>
  )
}

/** where the round stands, as one small chip on the row */
function StateChip({ row }: { row: InboxItemDto }) {
  const { format } = useI18n()
  if (row.route === 'escalation') {
    return <Badge variant="outline">{format(m.reviewStateEscalated)}</Badge>
  }
  if (row.roundNo > 1) {
    return <Badge variant="outline">{format(m.reviewStateRound, { round: row.roundNo })}</Badge>
  }
  return <Badge variant="secondary">{format(m.reviewStateWaiting)}</Badge>
}

function useOpenRow(batchId: string) {
  const navigate = usePageNavigate()
  return (row: InboxItemDto, run: string) =>
    navigate('assessment/review-instance', {
      params: { batchId, instanceId: row.instanceId },
      search: run === '' ? {} : { run },
    })
}

function ByItem({ batchId, rows }: { batchId: string; rows: readonly InboxItemDto[] }) {
  const { format } = useI18n()
  const open = useOpenRow(batchId)
  const groups = groupByItem(rows)
  return (
    <div {...stylex.props(styles.groups)}>
      {groups.map((group) => {
        const run = writeRunScope({ kind: 'item', itemId: group.itemId })
        return (
          <section key={group.itemId} {...stylex.props(styles.groupFrame)}>
            <header {...stylex.props(styles.groupHead)}>
              <h3 {...stylex.props(styles.groupTitle)}>{group.itemTitle}</h3>
              <span {...stylex.props(styles.groupCount)}>
                {format(m.reviewGroupCount, { count: group.rows.length })}
              </span>
              <span {...stylex.props(styles.spacer)} />
              <Button size="sm" variant="outline" onClick={() => open(group.rows[0]!, run)}>
                {format(m.reviewRunStart)}
                <Badge variant="secondary" className={stylex.props(styles.runCount).className}>
                  {group.rows.length}
                </Badge>
                <CornerDownLeftIcon aria-hidden />
              </Button>
            </header>
            <div {...stylex.props(styles.head)} style={{ gridTemplateColumns: GRID_ITEM }}>
              <span>{format(m.reviewColumnParticipant)}</span>
              <span {...stylex.props(styles.headValues)}>
                {group.columns.map((column, index) => (
                  <span key={index} {...stylex.props(styles.value)}>
                    {column}
                  </span>
                ))}
              </span>
              <span>{format(m.reviewColumnWhen)}</span>
              <span />
            </div>
            <ul>
              {group.rows.map((row) => (
                <li key={row.instanceId}>
                  <button
                    type="button"
                    {...stylex.props(styles.row)}
                    style={{ gridTemplateColumns: GRID_ITEM }}
                    onClick={() => open(row, run)}
                  >
                    <span {...stylex.props(styles.who)}>
                      <span {...stylex.props(styles.whoName)}>{row.participantName}</span>
                      {row.businessNo !== null && (
                        <span {...stylex.props(styles.whoNo)}>{row.businessNo}</span>
                      )}
                    </span>
                    <span {...stylex.props(styles.values, styles.wraps)}>
                      {row.values.map((pair, index) => (
                        <span key={index} {...stylex.props(styles.value)}>
                          <FiledValue pair={pair} />
                        </span>
                      ))}
                    </span>
                    <span {...stylex.props(styles.when)}>{timeLabel(row.submittedAt)}</span>
                    <span {...stylex.props(styles.chipCell)}>
                      <StateChip row={row} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

const GRID_ITEM = '11rem minmax(0,1fr) 7rem 6rem'
const GRID_TIME = '4rem 11rem 12rem minmax(0,1fr) 6rem'
const GRID_PERSON = '12rem minmax(0,1fr) 4rem 7rem 6rem'

function ByTime({ batchId, rows }: { batchId: string; rows: readonly InboxItemDto[] }) {
  const { format } = useI18n()
  const open = useOpenRow(batchId)
  const days = groupByDay(rows)
  return (
    <div {...stylex.props(styles.groups)}>
      {days.map((day) => (
        <section key={day.day} {...stylex.props(styles.groupFrame)}>
          <header {...stylex.props(styles.groupHead)}>
            <h3 {...stylex.props(styles.groupTitle, styles.groupTitleNums)}>{day.day}</h3>
            <span {...stylex.props(styles.groupCount)}>
              {format(m.reviewGroupCount, { count: day.rows.length })}
            </span>
          </header>
          <div {...stylex.props(styles.head)} style={{ gridTemplateColumns: GRID_TIME }}>
            <span>{format(m.reviewColumnTime)}</span>
            <span>{format(m.reviewColumnParticipant)}</span>
            <span>{format(m.reviewColumnItem)}</span>
            <span>{format(m.reviewColumnSummary)}</span>
            <span />
          </div>
          <ul>
            {day.rows.map((row) => (
              <li key={row.instanceId}>
                <button
                  type="button"
                  {...stylex.props(styles.row)}
                  style={{ gridTemplateColumns: GRID_TIME }}
                  onClick={() => open(row, '')}
                >
                  <span {...stylex.props(styles.when)}>{clockLabel(row.submittedAt)}</span>
                  <span {...stylex.props(styles.who)}>
                    <span {...stylex.props(styles.whoName)}>{row.participantName}</span>
                    {row.businessNo !== null && (
                      <span {...stylex.props(styles.whoNo)}>{row.businessNo}</span>
                    )}
                  </span>
                  <span {...stylex.props(styles.titleCell, styles.titleCellGrows)}>
                    {row.itemTitle}
                  </span>
                  <span {...stylex.props(styles.summaryCell, styles.wraps)}>{rowSummary(row)}</span>
                  <span {...stylex.props(styles.chipCell)}>
                    <StateChip row={row} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function ByPerson({ batchId, rows }: { batchId: string; rows: readonly InboxItemDto[] }) {
  const { format } = useI18n()
  const open = useOpenRow(batchId)
  const people = groupByPerson(rows)
  return (
    <div {...stylex.props(styles.groups)}>
      {people.map((person) => {
        const run = writeRunScope({ kind: 'person', businessNo: person.key })
        return (
          <section key={person.key} {...stylex.props(styles.groupFrame)}>
            <header {...stylex.props(styles.groupHead, styles.groupHeadTight)}>
              <Avatar className={stylex.props(styles.personAvatar).className}>
                <AvatarFallback className={stylex.props(styles.personInitial).className}>
                  {person.name.slice(0, 1)}
                </AvatarFallback>
              </Avatar>
              <h3 {...stylex.props(styles.groupTitle)}>{person.name}</h3>
              {person.businessNo !== null && (
                <span {...stylex.props(styles.whoNo)}>{person.businessNo}</span>
              )}
              {person.unitName !== null && (
                <span {...stylex.props(styles.personUnit)}>{person.unitName}</span>
              )}
              <span {...stylex.props(styles.spacer)} />
              <span {...stylex.props(styles.groupCount)}>
                {format(m.reviewGroupCount, { count: person.rows.length })}
              </span>
              <Button size="sm" variant="outline" onClick={() => open(person.rows[0]!, run)}>
                {format(m.reviewRunStart)}
                <Badge variant="secondary" className={stylex.props(styles.runCount).className}>
                  {person.rows.length}
                </Badge>
                <CornerDownLeftIcon aria-hidden />
              </Button>
            </header>
            <div {...stylex.props(styles.head)} style={{ gridTemplateColumns: GRID_PERSON }}>
              <span>{format(m.reviewColumnItem)}</span>
              <span>{format(m.reviewColumnSummary)}</span>
              <span>{format(m.reviewColumnWhen)}</span>
              <span />
            </div>
            <ul>
              {person.rows.map((row) => (
                <li key={row.instanceId}>
                  <button
                    type="button"
                    {...stylex.props(styles.row)}
                    style={{ gridTemplateColumns: GRID_PERSON }}
                    onClick={() => open(row, run)}
                  >
                    <span
                      {...stylex.props(
                        styles.titleCell,
                        styles.titleCellStrong,
                        styles.titleCellGrows,
                      )}
                    >
                      {row.itemTitle}
                    </span>
                    <span {...stylex.props(styles.summaryCell, styles.wraps)}>
                      {rowSummary(row)}
                    </span>
                    <span {...stylex.props(styles.filesCell)}>
                      {format(m.reviewFilesCount, { count: row.attachmentCount })}
                    </span>
                    <span {...stylex.props(styles.when)}>{timeLabel(row.submittedAt)}</span>
                    <span {...stylex.props(styles.chipCell)}>
                      <StateChip row={row} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

/**
 * A quiet day, said in full: the screen a reviewer lands on when there is
 * nothing to do is the screen they see most often, so it gets the room.
 */
function EmptyScreen({
  icon,
  mark,
  title,
  body,
}: {
  icon?: ReactNode
  /** a drawn mark instead of a still icon, where the emptiness was earned */
  mark?: ReactNode
  title: string
  body: string
}) {
  return (
    <div {...stylex.props(styles.emptyScreen)}>
      <Stagger className={stylex.props(styles.emptyStack).className} step={0.08}>
        {mark ?? <span {...stylex.props(styles.emptyBadge)}>{icon}</span>}
        <div {...stylex.props(styles.emptyWords)}>
          <h2 {...stylex.props(styles.emptyTitle)}>{title}</h2>
          <p {...stylex.props(styles.emptyBody)}>{body}</p>
        </div>
      </Stagger>
    </div>
  )
}

/**
 * One narrowing of the queue: everything, or one of something.
 *
 * The empty value is the whole list rather than a blank, so the control
 * always says what the reader is looking at instead of what they are not.
 */
function Filter({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: readonly (readonly [string, string])[]
  onChange: (next: string) => void
}) {
  return (
    <Select
      value={value === '' ? ALL : value}
      onValueChange={(next) => onChange(next === ALL ? '' : next)}
    >
      <SelectTrigger aria-label={label} xstyle={styles.filterWidth}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{label}</SelectItem>
        {options.map(([id, name]) => (
          <SelectItem key={id} value={id}>
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** radix refuses an empty option value, so "no filter" needs a name of its own */
const ALL = 'all'
