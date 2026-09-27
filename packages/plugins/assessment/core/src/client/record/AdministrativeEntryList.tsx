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
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { ListEmpty } from './ListEmpty.tsx'
import { ListSkeleton } from './ListSkeleton.tsx'
import { recordColumns } from './columns.stylex.ts'
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
// One line answers who, on what, how it came in, where it stands, and who
// settled it when - so on a wide screen every fact gets a column of its own
// and a record is one line, the time at the right edge where a reader
// scanning for this morning's work looks. Two lines per record spent a
// line's height on facts this short. Where the width runs out, how it came
// in is the first to go; narrow, the facts stack into three lines with the
// standing beside the name, because a column that has been squeezed to
// nothing is not a column any more.
//
// A withdrawn record stays on the page and goes grey. It is still part of
// what this round did, and greying the whole line says it no longer counts
// without making anybody read the standing to find that out.

const PAGE = 30

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
    containerType: 'inline-size',
  },
  head: {
    display: { default: 'grid', [recordColumns.stacked]: 'none' },
    gridTemplateColumns: {
      default: recordColumns.entries,
      [recordColumns.desk]: recordColumns.entriesDesk,
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
  headEnd: { textAlign: 'end' },
  headWider: { display: { default: 'none', [recordColumns.desk]: 'block' } },
  row: {
    display: 'grid',
    width: '100%',
    gridTemplateColumns: {
      default: recordColumns.entries,
      [recordColumns.stacked]: recordColumns.entriesStacked,
      [recordColumns.desk]: recordColumns.entriesDesk,
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
  // withdrawn: still on the page, no longer counting
  spent: { color: tokens.mutedForeground },
  // Across, every cell takes the next column in the order it is written;
  // narrow, each is put where the stacked card wants it.
  name: {
    gridColumnStart: { default: 'auto', [recordColumns.stacked]: 1 },
    gridRowStart: { default: 'auto', [recordColumns.stacked]: 1 },
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: { default: 14, [recordColumns.stacked]: 15 },
    fontWeight: 500,
  },
  // number and how it arrived, joined by the time of it on a narrow screen
  // where there is no column to put any of them in
  meta: {
    gridColumn: '1 / span 2',
    gridRowStart: 3,
    display: { default: 'none', [recordColumns.stacked]: 'flex' },
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
  itemCell: {
    gridColumn: { default: 'auto', [recordColumns.stacked]: '1 / span 2' },
    gridRow: { default: 'auto', [recordColumns.stacked]: '2' },
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: { default: 14, [recordColumns.stacked]: 13 },
  },
  standingSeat: {
    display: 'flex',
    gridColumnStart: { default: 'auto', [recordColumns.stacked]: 2 },
    gridRow: { default: 'auto', [recordColumns.stacked]: '1' },
  },
  // a fact in a column of its own across; narrow it is on the meta line
  fact: {
    display: { default: 'block', [recordColumns.stacked]: 'none' },
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 13,
    color: tokens.mutedForeground,
  },
  factWider: { display: { default: 'none', [recordColumns.desk]: 'block' } },
  number: { fontSize: 12.5, fontVariantNumeric: 'tabular-nums' },
  // when, at the right edge
  when: {
    textAlign: 'end',
    fontSize: 12.5,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)`,
    fontVariantNumeric: 'tabular-nums',
  },
  chevron: {
    width: 16,
    height: 16,
    gridColumnStart: { default: 'auto', [recordColumns.stacked]: 3 },
    gridRow: { default: 'auto', [recordColumns.stacked]: '1 / span 3' },
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
              <div
                {...stylex.props(styles.head)}
                aria-hidden
                data-testid="administrative-entries-head"
              >
                <span>{format(m.recordColumnWho)}</span>
                <span>{businessNo}</span>
                <span>{format(m.recordColumnItem)}</span>
                <span {...stylex.props(styles.headWider)}>{format(m.recordColumnSource)}</span>
                <span>{format(m.importColumnStatus)}</span>
                <span>{format(m.recordColumnActor)}</span>
                <span {...stylex.props(styles.headEnd)}>{format(m.recordColumnWhen)}</span>
                <span />
              </div>
              {rows.map((row) => {
                const spent = row.status === 'voided'
                const when = whenOf(row.revision.createdAt)
                const number =
                  row.participant.businessNo ?? format(m.noBusinessNoShort, { businessNo })
                const source = format(
                  row.source === 'import' ? m.recordSourceImport : m.recordSourceManual,
                )
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
                    <span {...stylex.props(styles.name)} title={row.participant.displayName}>
                      {row.participant.displayName}
                    </span>
                    <span {...stylex.props(styles.fact, styles.number)}>{number}</span>
                    <span {...stylex.props(styles.itemCell)} title={row.item.title}>
                      {row.item.title}
                    </span>
                    <span {...stylex.props(styles.fact, styles.factWider)}>{source}</span>
                    <span {...stylex.props(styles.standingSeat)}>
                      <RecordStanding status={row.status} />
                    </span>
                    <span {...stylex.props(styles.fact)}>
                      {row.revision.actorName ?? format(m.recordActorUnknown)}
                    </span>
                    <span {...stylex.props(styles.fact, styles.when)}>{when}</span>
                    <ChevronRightIcon aria-hidden {...stylex.props(styles.chevron)} />
                    {/* narrow, the number, how it came in and when share one
                        line under the item */}
                    <span {...stylex.props(styles.meta)}>
                      <span>{number}</span>
                      <span aria-hidden {...stylex.props(styles.tick)} />
                      <span>{source}</span>
                      <span aria-hidden {...stylex.props(styles.tick)} />
                      <span>{when}</span>
                    </span>
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
