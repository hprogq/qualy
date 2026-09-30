import { useMemo } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { ChevronRightIcon } from 'lucide-react'
import { cursorPages, useApi, useApiQuery, useLoadFailure, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { ListEmpty } from './ListEmpty.tsx'
import { ListSkeleton } from './ListSkeleton.tsx'
import { recordColumns } from './columns.stylex.ts'
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

const styles = stylex.create({
  card: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surface,
    boxShadow: tokens.elevation1,
    containerType: 'inline-size',
  },
  head: {
    display: { default: 'grid', [recordColumns.stacked]: 'none' },
    gridTemplateColumns: {
      default: recordColumns.acts,
      [recordColumns.desk]: recordColumns.actsDesk,
    },
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
      default: recordColumns.acts,
      [recordColumns.stacked]: recordColumns.historyStacked,
      [recordColumns.desk]: recordColumns.actsDesk,
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
    paddingBlock: { default: 11, [recordColumns.stacked]: 12 },
    textAlign: 'start',
    cursor: 'pointer',
    transitionProperty: 'background-color',
  },
  // withdrawn whole: still on the page, no longer counting
  spent: { color: tokens.mutedForeground },
  // Across, every cell takes the next column in the order it is written;
  // narrow, each is put where the stacked card wants it.
  item: {
    gridColumnStart: { default: 'auto', [recordColumns.stacked]: 1 },
    gridRowStart: { default: 'auto', [recordColumns.stacked]: 1 },
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: { default: 14, [recordColumns.stacked]: 15 },
    fontWeight: 500,
  },
  how: {
    gridColumnStart: { default: 'auto', [recordColumns.stacked]: 1 },
    gridRowStart: { default: 'auto', [recordColumns.stacked]: 2 },
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: { default: 14, [recordColumns.stacked]: 13 },
  },
  // who, and when at the right edge: columns of their own across, and on a
  // phone the time joins the count for want of one
  fact: {
    display: { default: 'block', [recordColumns.stacked]: 'none' },
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
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  standing: {
    gridColumnStart: { default: 'auto', [recordColumns.stacked]: 1 },
    gridRowStart: { default: 'auto', [recordColumns.stacked]: 3 },
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
  phoneOnly: { display: { default: 'none', [recordColumns.stacked]: 'inline' } },
  chevron: {
    width: 16,
    height: 16,
    gridColumnStart: { default: 'auto', [recordColumns.stacked]: 2 },
    gridRowStart: { default: 'auto', [recordColumns.stacked]: 1 },
    gridRowEnd: { default: 'auto', [recordColumns.stacked]: 'span 3' },
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
  const { format } = useI18n()
  const failures = useLoadFailure()
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
      error={history.isError ? failures.of(history.error) : null}
      framed
      loadingLabel={format(commonMessages.loading)}
      retryLabel={format(commonMessages.retry)}
      onRetry={() => void history.refetch()}
      skeleton={<ListSkeleton kind="acts" />}
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
