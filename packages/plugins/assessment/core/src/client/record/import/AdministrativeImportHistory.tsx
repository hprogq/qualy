import { useMemo } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { ChevronRightIcon, DownloadIcon, FileSpreadsheetIcon } from 'lucide-react'
import { cursorPages, useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@qualy/ui/empty'
import { Skeleton } from '@qualy/ui/skeleton'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentApi } from '../../api.ts'
import { assessmentMessages as m } from '../../i18n.ts'
import { useWhen } from '../when.ts'

// The imports this reader made in this round and may still look back on,
// newest first.
//
// Each line says what the file was, which question it filled, who and when,
// and what it comes to now - which is counted from its records every time,
// so a withdrawal made yesterday is already in the number.
//
// The same sheet, columns and footer as the records list, because the two
// are one book read two ways; moving between the tabs should change what is
// in the columns, not what a line looks like. What is NOT here is a standing
// badge: an import is not in a state, it is a pile of records whose states
// are summed in the last column.
//
// A file whose every record has been withdrawn goes grey whole, the way a
// withdrawn record does.

const PAGE = 30
const wide = '@media (min-width: 900px)'

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
  row: {
    display: 'grid',
    width: '100%',
    gridTemplateColumns: {
      default: 'minmax(0, 1fr) 1rem',
      [wide]: 'minmax(0, 1.4fr) minmax(0, 1fr) 9rem 9rem 1rem',
    },
    alignItems: 'center',
    columnGap: 12,
    rowGap: 4,
    borderTopWidth: { default: 1, ':first-child': 0 },
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 60%, transparent)`,
    },
    paddingInline: 16,
    paddingBlock: 12,
    textAlign: 'start',
    cursor: 'pointer',
    transitionProperty: 'background-color',
  },
  // withdrawn whole: still on the page, no longer counting
  spent: { color: tokens.mutedForeground },
  file: {
    gridColumnStart: 1,
    gridRowStart: 1,
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 10,
  },
  fileIcon: { flexShrink: 0, width: 16, height: 16, color: tokens.mutedForeground },
  fileName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: { default: 15, [wide]: 14 },
    fontWeight: 500,
  },
  itemCell: {
    gridColumnStart: { default: 1, [wide]: 2 },
    gridRowStart: { default: 2, [wide]: 1 },
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: { default: 13, [wide]: 14 },
  },
  // who brought it in and when, two lines on a wide screen
  whenCell: {
    display: { default: 'none', [wide]: 'flex' },
    gridColumnStart: 3,
    minWidth: 0,
    flexDirection: 'column',
    gap: 2,
  },
  actorLine: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 13,
    color: tokens.mutedForeground,
  },
  whenLine: {
    fontSize: 12,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)`,
    fontVariantNumeric: 'tabular-nums',
  },
  // what the file comes to now; narrow, the time joins it for want of a
  // column of its own
  standing: {
    gridColumnStart: { default: 1, [wide]: 4 },
    gridRowStart: { default: 3, [wide]: 1 },
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  tick: { width: 1, height: 10, backgroundColor: tokens.divider },
  phoneOnly: { display: { default: 'inline', [wide]: 'none' } },
  chevron: {
    width: 16,
    height: 16,
    gridColumnStart: { default: 2, [wide]: 5 },
    gridRowStart: 1,
    gridRowEnd: { default: 'span 3', [wide]: 'auto' },
    color: `color-mix(in oklab, ${tokens.mutedForeground} 60%, transparent)`,
  },
  empty: {
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surface,
    boxShadow: tokens.elevation1,
    paddingBlock: 48,
  },
  actionIcon: { width: 15, height: 15 },
  waiting: { height: 220, width: '100%' },
  moreRow: { display: 'flex', justifyContent: 'center', paddingBlock: 8 },
})

export function AdministrativeImportHistory({
  batchId,
  onOpen,
  onImport,
}: {
  batchId: string
  onOpen: (importId: string) => void
  /** the way out of an empty page, when this reader may take one */
  onImport?: () => void
}) {
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const query = useApiQuery(assessmentApi)
  const { format, formatError } = useI18n()
  const whenOf = useWhen()

  const history = useInfiniteQuery({
    queryKey: [
      ...query.assessment.listAdministrativeImports.key({ params: { batchId }, query: {} }),
      'infinite',
    ],
    queryFn: ({ pageParam }) =>
      run(
        api.assessment.listAdministrativeImports({
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
      skeleton={<Skeleton className={stylex.props(styles.waiting).className} />}
    >
      {rows.length === 0 ? (
        <Empty xstyle={styles.empty} data-testid="administrative-imports-empty">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileSpreadsheetIcon />
            </EmptyMedia>
            <EmptyTitle>{format(m.importHistoryEmpty)}</EmptyTitle>
            <EmptyDescription>{format(m.importHistoryEmptyHint)}</EmptyDescription>
          </EmptyHeader>
          {onImport !== undefined && (
            <EmptyContent>
              <Button variant="outline" onClick={onImport}>
                <DownloadIcon aria-hidden {...stylex.props(styles.actionIcon)} />
                {format(m.importAction)}
              </Button>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <>
          <div {...stylex.props(styles.card)} data-testid="administrative-imports">
            {rows.map((row) => {
              // nothing of this file is left standing
              const spent = row.importedCount > 0 && row.standing.voided >= row.importedCount
              const when = whenOf(row.createdAt)
              return (
                <button
                  key={row.id}
                  type="button"
                  data-testid="administrative-import"
                  data-import={row.id}
                  data-count={row.importedCount}
                  data-voided={row.standing.voided}
                  onClick={() => onOpen(row.id)}
                  {...stylex.props(styles.row, spent && styles.spent)}
                >
                  <span {...stylex.props(styles.file)}>
                    <FileSpreadsheetIcon aria-hidden {...stylex.props(styles.fileIcon)} />
                    <span {...stylex.props(styles.fileName)}>
                      {row.source.available ? row.source.filename : format(m.importDetailTitle)}
                    </span>
                  </span>
                  <span {...stylex.props(styles.itemCell)}>{row.item.title}</span>
                  <span {...stylex.props(styles.whenCell)}>
                    <span {...stylex.props(styles.actorLine)}>
                      {row.actor?.name ?? format(m.recordActorUnknown)}
                    </span>
                    <span {...stylex.props(styles.whenLine)}>{when}</span>
                  </span>
                  <span {...stylex.props(styles.standing)}>
                    <span>{format(m.importStandingCount, { count: row.importedCount })}</span>
                    {row.standing.voided > 0 && (
                      <>
                        <span aria-hidden {...stylex.props(styles.tick)} />
                        <span>
                          {format(m.importStandingVoided, { count: row.standing.voided })}
                        </span>
                      </>
                    )}
                    <span aria-hidden {...stylex.props(styles.tick, styles.phoneOnly)} />
                    <span {...stylex.props(styles.phoneOnly)}>{when}</span>
                  </span>
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
