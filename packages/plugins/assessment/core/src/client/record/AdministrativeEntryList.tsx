import { useMemo } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { ChevronRightIcon, PlusIcon } from 'lucide-react'
import { cursorPages, useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { useTerm } from '@qualy/plugin-settings/client/terms'
import { authTerms } from '@qualy/auth-contract/terms'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { ListEmpty } from './ListEmpty.tsx'
import { ListSkeleton } from './ListSkeleton.tsx'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { RecordStanding } from './RecordStanding.tsx'
import { useWhen } from './when.ts'

// What the institution has recorded in this round, newest first.
//
// The page opens on this rather than on an empty form, because the first
// question somebody arriving here has is "what has already been decided",
// and a blank form answers a different one. The same sheet the rest of the
// product uses: white is the record, days are not grouped because a record
// book is read by person and question rather than by when.
//
// One line answers four things at once - who, on what, where it stands, and
// who settled it when - so on a wide screen each gets a column and the last
// one hangs off the right edge, where a reader scanning for this morning's
// work looks. Narrow, the same four stack into three lines with the standing
// beside the name, because a column that has been squeezed to nothing is not
// a column any more.
//
// A withdrawn record stays on the page and goes grey. It is still part of
// what this round did, and greying the whole line says it no longer counts
// without making anybody read the standing to find that out.

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
  head: {
    display: { default: 'none', [wide]: 'grid' },
    gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1.2fr) 6.5rem 9rem 1rem',
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
  headEnd: { textAlign: 'end' },
  row: {
    display: 'grid',
    width: '100%',
    gridTemplateColumns: {
      default: 'minmax(0, 1fr) auto 1rem',
      [wide]: 'minmax(0, 1.3fr) minmax(0, 1.2fr) 6.5rem 9rem 1rem',
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
    paddingBlock: 12,
    textAlign: 'start',
    cursor: 'pointer',
    transitionProperty: 'background-color',
  },
  // withdrawn: still on the page, no longer counting
  spent: { color: tokens.mutedForeground },
  name: {
    gridColumnStart: 1,
    gridRowStart: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: { default: 15, [wide]: 14 },
    fontWeight: 500,
  },
  // number and how it arrived, joined by the time of it on a narrow screen
  // where there is no column to put the time in
  meta: {
    gridColumn: { default: '1 / span 2', [wide]: '1' },
    gridRowStart: { default: 3, [wide]: 2 },
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  tick: {
    width: 1,
    height: 10,
    backgroundColor: tokens.divider,
  },
  phoneOnly: { display: { default: 'inline', [wide]: 'none' } },
  itemCell: {
    gridColumn: { default: '1 / span 2', [wide]: '2' },
    gridRow: { default: '2', [wide]: '1 / span 2' },
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: { default: 13, [wide]: 14 },
  },
  standingSeat: {
    display: 'flex',
    gridColumnStart: { default: 2, [wide]: 3 },
    gridRow: { default: '1', [wide]: '1 / span 2' },
  },
  // who settled it and when, hung off the right edge
  whenCell: {
    display: { default: 'none', [wide]: 'flex' },
    gridColumnStart: 4,
    gridRow: '1 / span 2',
    minWidth: 0,
    flexDirection: 'column',
    gap: 2,
    textAlign: 'end',
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
  chevron: {
    width: 16,
    height: 16,
    gridColumnStart: { default: 3, [wide]: 5 },
    gridRow: { default: '1 / span 3', [wide]: '1 / span 2' },
    color: `color-mix(in oklab, ${tokens.mutedForeground} 60%, transparent)`,
  },
  empty: {
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surface,
    boxShadow: tokens.elevation1,
    paddingBlock: 48,
  },
  actionIcon: { width: 15, height: 15 },
  moreRow: { display: 'flex', justifyContent: 'center', paddingBlock: 8 },
})

export function AdministrativeEntryList({
  batchId,
  search,
  onOpen,
  onRecord,
}: {
  batchId: string
  /** what to narrow to; the band above the list owns the box */
  search: string
  onOpen: (entryId: string) => void
  /** the way out of an empty page, when this reader may take one */
  onRecord?: () => void
}) {
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const query = useApiQuery(assessmentApi)
  const { format, formatError } = useI18n()
  const businessNo = useTerm(authTerms.businessNumber)
  const whenOf = useWhen()
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

  return (
    <div {...stylex.props(styles.column)}>
      <AsyncSection
        pending={book.isPending}
        error={book.isError ? formatError(book.error) : null}
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => void book.refetch()}
        skeleton={<ListSkeleton />}
      >
        {rows.length === 0 ? (
          // a search that found nobody is not an empty book, and offering to
          // record one there would answer a question nobody asked
          needle !== '' ? (
            <ListEmpty title={format(m.recordNobodyFound)} testId="administrative-entries-empty" />
          ) : (
            <ListEmpty
              title={format(m.recordListEmpty)}
              said={format(m.recordListEmptyHint)}
              testId="administrative-entries-empty"
            >
              {onRecord !== undefined && (
                <Button variant="outline" onClick={onRecord}>
                  <PlusIcon aria-hidden {...stylex.props(styles.actionIcon)} />
                  {format(m.recordNewAction)}
                </Button>
              )}
            </ListEmpty>
          )
        ) : (
          <>
            <div {...stylex.props(styles.card)} data-testid="administrative-entries">
              {/* named columns, because five facts in a row need saying
                  once at the top rather than guessing at per line */}
              <div {...stylex.props(styles.head)} aria-hidden>
                <span>{format(m.recordColumnWho)}</span>
                <span>{format(m.recordColumnItem)}</span>
                <span>{format(m.importColumnStatus)}</span>
                <span {...stylex.props(styles.headEnd)}>{format(m.recordColumnActor)}</span>
                <span />
              </div>
              {rows.map((row) => {
                const spent = row.status === 'voided'
                const when = whenOf(row.revision.createdAt)
                return (
                  <button
                    key={row.entryId}
                    type="button"
                    data-testid="administrative-entry"
                    data-entry={row.entryId}
                    data-source={row.source}
                    data-entry-status={row.status}
                    onClick={() => onOpen(row.entryId)}
                    {...stylex.props(styles.row, spent && styles.spent)}
                  >
                    <span {...stylex.props(styles.name)}>{row.participant.displayName}</span>
                    <span {...stylex.props(styles.meta)}>
                      <span>{row.participant.businessNo ?? format(m.noBusinessNoShort, { businessNo })}</span>
                      <span aria-hidden {...stylex.props(styles.tick)} />
                      <span>
                        {format(
                          row.source === 'import' ? m.recordSourceImport : m.recordSourceManual,
                        )}
                      </span>
                      <span aria-hidden {...stylex.props(styles.tick, styles.phoneOnly)} />
                      <span {...stylex.props(styles.phoneOnly)}>{when}</span>
                    </span>
                    <span {...stylex.props(styles.itemCell)}>{row.item.title}</span>
                    <span {...stylex.props(styles.standingSeat)}>
                      <RecordStanding status={row.status} />
                    </span>
                    <span {...stylex.props(styles.whenCell)}>
                      <span {...stylex.props(styles.actorLine)}>
                        {row.revision.actorName ?? format(m.recordActorUnknown)}
                      </span>
                      <span {...stylex.props(styles.whenLine)}>{when}</span>
                    </span>
                    <ChevronRightIcon aria-hidden {...stylex.props(styles.chevron)} />
                  </button>
                )
              })}
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
