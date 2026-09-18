import { useMemo } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { ChevronRightIcon } from 'lucide-react'
import { cursorPages, useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Skeleton } from '@qualy/ui/skeleton'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentApi } from '../../api.ts'
import { assessmentMessages as m } from '../../i18n.ts'

// The imports this reader made in this round and may still look back on,
// newest first.
//
// Each line says what the file was, which question it filled, who and when,
// and what it comes to now - which is counted from its records every time,
// so a withdrawal made yesterday is already in the number.

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
  file: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 14,
    fontWeight: 500,
  },
  itemCell: {
    gridColumnStart: { default: 1, [wide]: 2 },
    gridRowStart: { default: 2, [wide]: 1 },
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: { default: 12, [wide]: 14 },
    color: { default: tokens.mutedForeground, [wide]: tokens.foreground },
  },
  asideCell: {
    display: { default: 'none', [wide]: 'block' },
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  standing: {
    gridColumnStart: { default: 1, [wide]: 4 },
    gridRowStart: { default: 3, [wide]: 1 },
    fontSize: 12,
    color: tokens.mutedForeground,
  },
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
    textAlign: 'center',
    fontSize: 13,
    color: tokens.mutedForeground,
  },
  waiting: { height: 220, width: '100%' },
  moreRow: { display: 'flex', justifyContent: 'center', paddingBlock: 8 },
})

export function AdministrativeImportHistory({
  batchId,
  onOpen,
}: {
  batchId: string
  onOpen: (importId: string) => void
}) {
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const query = useApiQuery(assessmentApi)
  const { format, formatError, locale } = useI18n()

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
  const day = (iso: string) =>
    new Intl.DateTimeFormat(locale, { month: 'numeric', day: 'numeric' }).format(new Date(iso))

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
        <p {...stylex.props(styles.empty)}>{format(m.importHistoryEmpty)}</p>
      ) : (
        <>
          <div {...stylex.props(styles.card)} data-testid="administrative-imports">
            {rows.map((row) => (
              <button
                key={row.id}
                type="button"
                data-testid="administrative-import"
                data-import={row.id}
                data-count={row.importedCount}
                data-voided={row.standing.voided}
                onClick={() => onOpen(row.id)}
                {...stylex.props(styles.row)}
              >
                <span {...stylex.props(styles.file)}>
                  {row.source.available ? row.source.filename : format(m.importDetailTitle)}
                </span>
                <span {...stylex.props(styles.itemCell)}>{row.item.title}</span>
                <span {...stylex.props(styles.asideCell)}>
                  {row.actor?.name ?? '—'}
                  {' · '}
                  {day(row.createdAt)}
                </span>
                <span {...stylex.props(styles.standing)}>
                  {format(m.importStandingCount, { count: row.importedCount })}
                  {row.standing.voided > 0 &&
                    ` · ${format(m.importStandingVoided, { count: row.standing.voided })}`}
                </span>
                <ChevronRightIcon aria-hidden {...stylex.props(styles.chevron)} />
              </button>
            ))}
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
