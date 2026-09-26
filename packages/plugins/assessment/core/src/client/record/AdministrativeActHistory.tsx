import { useMemo } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { ChevronRightIcon } from 'lucide-react'
import { cursorPages, useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { ListEmpty } from './ListEmpty.tsx'
import { ListSkeleton } from './ListSkeleton.tsx'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { useWhen } from './when.ts'

// One finding settled on many people, as a line to come back to.
//
// The record book's third index. It answers what neither of the others can:
// which facts were one act, which is the only question a withdrawal can be
// asked. What each act comes to is counted from its own records every time -
// the number it wrote and the number still standing are different facts, and
// storing the second beside the first is how they come to disagree.
//
// The same sheet, columns and footer as the other two, because moving
// between the tabs should change what is in the columns, not what a line
// looks like.

const PAGE = 30
const wide = '@media (min-width: 900px)'

// what it was, what it filled, what it comes to now, who, and when: one line
// a record, the time at the right edge
const WIDE_COLUMNS = 'minmax(0, 1.4fr) minmax(0, 1fr) 9rem minmax(4rem, 0.7fr) 7.5rem 1rem'

const styles = stylex.create({
  card: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surface,
    boxShadow: tokens.elevation1,
  },
  head: {
    display: { default: 'none', [wide]: 'grid' },
    gridTemplateColumns: WIDE_COLUMNS,
    columnGap: 12,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    backgroundColor: tokens.surfaceInset,
    paddingInline: 16,
    paddingBlock: 10,
    fontSize: 12,
    fontWeight: 500,
    color: tokens.mutedForeground,
  },
  row: {
    display: 'grid',
    width: '100%',
    gridTemplateColumns: {
      default: 'minmax(0, 1fr) 1rem',
      [wide]: WIDE_COLUMNS,
    },
    alignItems: 'center',
    columnGap: 12,
    rowGap: 4,
    borderBottomWidth: { default: 1, ':last-child': 0 },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 60%, transparent)`,
    },
    paddingInline: 16,
    paddingBlock: { default: 12, [wide]: 11 },
    textAlign: 'start',
    cursor: 'pointer',
    transitionProperty: 'background-color',
  },
  // withdrawn whole: still on the page, no longer counting
  spent: { color: tokens.mutedForeground },
  // Across, every cell takes the next column in the order it is written;
  // narrow, each is put where the stacked card wants it.
  item: {
    gridColumnStart: { default: 1, [wide]: 'auto' },
    gridRowStart: { default: 1, [wide]: 'auto' },
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: { default: 15, [wide]: 14 },
    fontWeight: 500,
  },
  how: {
    gridColumnStart: { default: 1, [wide]: 'auto' },
    gridRowStart: { default: 2, [wide]: 'auto' },
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: { default: 13, [wide]: 14 },
  },
  // who, and when at the right edge: columns of their own across, and on a
  // phone the time joins the count for want of one
  fact: {
    display: { default: 'none', [wide]: 'block' },
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 13,
    color: tokens.mutedForeground,
  },
  when: {
    textAlign: 'end',
    fontSize: 12.5,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)`,
    fontVariantNumeric: 'tabular-nums',
  },
  standing: {
    gridColumnStart: { default: 1, [wide]: 'auto' },
    gridRowStart: { default: 3, [wide]: 'auto' },
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  tick: { width: 1, height: 10, backgroundColor: tokens.divider },
  headEnd: { textAlign: 'end' },
  phoneOnly: { display: { default: 'inline', [wide]: 'none' } },
  chevron: {
    width: 16,
    height: 16,
    gridColumnStart: { default: 2, [wide]: 'auto' },
    gridRowStart: { default: 1, [wide]: 'auto' },
    gridRowEnd: { default: 'span 3', [wide]: 'auto' },
    color: `color-mix(in oklab, ${tokens.mutedForeground} 60%, transparent)`,
  },
  empty: {
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surface,
    boxShadow: tokens.elevation1,
    paddingBlock: 48,
  },
  moreRow: { display: 'flex', justifyContent: 'center', paddingBlock: 8 },
})

export function AdministrativeActHistory({
  batchId,
  onOpen,
}: {
  batchId: string
  onOpen: (operationId: string) => void
}) {
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const query = useApiQuery(assessmentApi)
  const { format, formatError } = useI18n()
  const whenOf = useWhen()

  const history = useInfiniteQuery({
    queryKey: [
      ...query.assessment.listAdministrativeRecords.key({ params: { batchId }, query: {} }),
      'infinite',
    ],
    queryFn: ({ pageParam }) =>
      run(
        api.assessment.listAdministrativeRecords({
          params: { batchId },
          query: {
            limit: String(PAGE),
            ...(pageParam !== undefined ? { cursor: pageParam } : {}),
          },
        }),
      ),
    ...cursorPages,
  })

  const rows = useMemo(
    () => history.data?.pages.flatMap((page) => page.items) ?? [],
    [history.data],
  )

  return (
    <AsyncSection
      pending={history.isPending}
      error={history.isError ? formatError(history.error) : null}
      loadingLabel={format(commonMessages.loading)}
      retryLabel={format(commonMessages.retry)}
      onRetry={() => void history.refetch()}
      skeleton={<ListSkeleton kind="history" />}
    >
      {rows.length === 0 ? (
        <ListEmpty
          title={format(m.recordActsEmpty)}
          said={format(m.recordActsEmptyHint)}
          testId="administrative-acts-empty"
        />
      ) : (
        <>
          <div {...stylex.props(styles.card)} data-testid="administrative-acts">
            <div {...stylex.props(styles.head)} aria-hidden>
              <span>{format(m.recordActItem)}</span>
              <span>{format(m.recordTargets)}</span>
              <span>{format(m.importColumnStanding)}</span>
              <span>{format(m.recordColumnActor)}</span>
              <span {...stylex.props(styles.headEnd)}>{format(m.recordColumnWhen)}</span>
              <span />
            </div>
            {rows.map((row) => {
              // nothing this act wrote is left standing
              const spent = row.recordedCount > 0 && row.voidedCount >= row.recordedCount
              const when = whenOf(row.createdAt)
              return (
                <button
                  key={row.id}
                  type="button"
                  data-testid="administrative-act"
                  data-act={row.id}
                  data-count={row.recordedCount}
                  data-voided={row.voidedCount}
                  onClick={() => onOpen(row.id)}
                  {...stylex.props(styles.row, spent && styles.spent)}
                >
                  <span {...stylex.props(styles.item)}>{row.itemTitle}</span>
                  <span {...stylex.props(styles.how)}>
                    {format(
                      row.targetKind === 'organization' ? m.recordActByUnits : m.recordActByPeople,
                    )}
                  </span>
                  <span {...stylex.props(styles.standing)}>
                    <span>{format(m.recordActCount, { count: row.recordedCount })}</span>
                    {row.voidedCount > 0 && (
                      <>
                        <span aria-hidden {...stylex.props(styles.tick)} />
                        <span>{format(m.recordActVoided, { count: row.voidedCount })}</span>
                      </>
                    )}
                    <span aria-hidden {...stylex.props(styles.tick, styles.phoneOnly)} />
                    <span {...stylex.props(styles.phoneOnly)}>{when}</span>
                  </span>
                  <span {...stylex.props(styles.fact)}>
                    {row.actorName ?? format(m.recordActorUnknown)}
                  </span>
                  <span {...stylex.props(styles.fact, styles.when)}>{when}</span>
                  <ChevronRightIcon aria-hidden {...stylex.props(styles.chevron)} />
                </button>
              )
            })}
          </div>
          {history.hasNextPage && (
            <div {...stylex.props(styles.moreRow)}>
              <Button
                size="sm"
                variant="ghost"
                disabled={history.isFetchingNextPage}
                onClick={() => void history.fetchNextPage()}
              >
                {format(m.recordMoreWho)}
              </Button>
            </div>
          )}
        </>
      )}
    </AsyncSection>
  )
}
