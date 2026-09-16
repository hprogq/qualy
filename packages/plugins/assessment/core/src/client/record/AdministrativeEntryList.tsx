import { useMemo, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { ChevronRightIcon, SearchIcon } from 'lucide-react'
import { cursorPages, useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { Skeleton } from '@qualy/ui/skeleton'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { EntryStanding } from '../entry/EntryStanding.tsx'

// What the institution has recorded in this round, newest first.
//
// The page opens on this rather than on an empty form, because the first
// question somebody arriving here has is "what has already been decided",
// and a blank form answers a different one. The same sheet the rest of the
// product uses: white is the record, days are not grouped because a record
// book is read by person and question rather than by when.

const PAGE = 30
const wide = '@media (min-width: 900px)'

const styles = stylex.create({
  column: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 12 },
  tools: { display: 'flex', alignItems: 'center', gap: 8 },
  searchSeat: { position: 'relative', flexGrow: 1, maxWidth: '22rem' },
  searchGlass: {
    pointerEvents: 'none',
    position: 'absolute',
    top: '50%',
    left: 12,
    width: 14,
    height: 14,
    transform: 'translateY(-50%)',
    color: tokens.mutedForeground,
  },
  indented: { paddingLeft: 36 },
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
      [wide]: 'minmax(0, 1.4fr) minmax(0, 1fr) 7rem 6rem 1rem',
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
  who: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 2 },
  name: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 14,
    fontWeight: 500,
  },
  under: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  // on a narrow screen the question and the standing ride under the name
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
  standingSeat: { display: { default: 'none', [wide]: 'flex' } },
  chevron: {
    width: 16,
    height: 16,
    gridColumnStart: { default: 2, [wide]: 5 },
    gridRowStart: 1,
    gridRowEnd: { default: 'span 2', [wide]: 'auto' },
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

export function AdministrativeEntryList({
  batchId,
  onOpen,
}: {
  batchId: string
  onOpen: (entryId: string) => void
}) {
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const query = useApiQuery(assessmentApi)
  const { format, formatError, locale } = useI18n()
  const [search, setSearch] = useState('')
  const needle = search.trim()

  const book = useInfiniteQuery({
    queryKey: [
      ...query.assessment.listAdministrativeEntries.key({ params: { batchId }, query: {} }),
      { q: needle },
      'infinite',
    ],
    queryFn: ({ pageParam }) =>
      run(
        api.assessment.listAdministrativeEntries({
          params: { batchId },
          query: {
            limit: String(PAGE),
            ...(needle === '' ? {} : { q: needle }),
            ...(pageParam !== undefined ? { cursor: pageParam } : {}),
          },
        }),
      ),
    ...cursorPages,
  })

  const rows = useMemo(() => book.data?.pages.flatMap((page) => page.entries) ?? [], [book.data])
  const day = (iso: string) =>
    new Intl.DateTimeFormat(locale, { month: 'numeric', day: 'numeric' }).format(new Date(iso))

  return (
    <div {...stylex.props(styles.column)}>
      <div {...stylex.props(styles.tools)}>
        <div {...stylex.props(styles.searchSeat)}>
          <SearchIcon aria-hidden {...stylex.props(styles.searchGlass)} />
          <Input
            name="administrative-search"
            value={search}
            placeholder={format(m.recordSearchList)}
            aria-label={format(m.recordSearchList)}
            onChange={(event) => setSearch(event.target.value)}
            className={stylex.props(styles.indented).className}
          />
        </div>
      </div>

      <AsyncSection
        pending={book.isPending}
        error={book.isError ? formatError(book.error) : null}
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => void book.refetch()}
        skeleton={<Skeleton className={stylex.props(styles.waiting).className} />}
      >
        {rows.length === 0 ? (
          <p {...stylex.props(styles.empty)}>{format(m.recordListEmpty)}</p>
        ) : (
          <>
            <div {...stylex.props(styles.card)} data-testid="administrative-entries">
              {rows.map((row) => (
                <button
                  key={row.entryId}
                  type="button"
                  data-testid="administrative-entry"
                  data-entry={row.entryId}
                  data-source={row.source}
                  data-entry-status={row.status}
                  onClick={() => onOpen(row.entryId)}
                  {...stylex.props(styles.row)}
                >
                  <span {...stylex.props(styles.who)}>
                    <span {...stylex.props(styles.name)}>{row.participant.displayName}</span>
                    <span {...stylex.props(styles.under)}>
                      {row.participant.businessNo ?? format(m.noBusinessNoShort)}
                      <span aria-hidden>·</span>
                      {format(
                        row.source === 'import' ? m.recordSourceImport : m.recordSourceManual,
                      )}
                    </span>
                  </span>
                  <span {...stylex.props(styles.itemCell)}>{row.item.title}</span>
                  <span {...stylex.props(styles.standingSeat)}>
                    <EntryStanding status={row.status} />
                  </span>
                  <span {...stylex.props(styles.asideCell)}>
                    {row.revision.actorName ?? '—'}
                    {' · '}
                    {day(row.revision.createdAt)}
                  </span>
                  <ChevronRightIcon aria-hidden {...stylex.props(styles.chevron)} />
                </button>
              ))}
            </div>
            {book.hasNextPage && (
              <div {...stylex.props(styles.moreRow)}>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={book.isFetchingNextPage}
                  onClick={() => void book.fetchNextPage()}
                >
                  {format(m.recordMoreWho)}
                </Button>
              </div>
            )}
          </>
        )}
      </AsyncSection>
    </div>
  )
}
