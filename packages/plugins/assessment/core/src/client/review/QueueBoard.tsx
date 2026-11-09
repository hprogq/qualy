import { useState, type ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { ChevronRightIcon, SearchIcon } from 'lucide-react'
import { Button } from '@qualy/ui/button'
import { Pager } from '@qualy/ui/pager'
import { SearchSelect } from '@qualy/ui/search-select'
import { Skeleton } from '@qualy/ui/skeleton'
import { Card, CardFoot } from '@qualy/ui/screen'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { scrollMotion, useBeside } from './pointer.ts'
import { Count } from '@qualy/ui/count'
import { dayKeyOf, useBatchZone } from '../batch/zone.ts'
import { SUMMARY_FIELDS_MOST } from '../../entry/summary.ts'
import { useDayHeading, useQueueClock, writeRunScope, type InboxItemDto } from './model.ts'
import type { QueuePage } from './queue.ts'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

// The review queue, grouped: by project, by person, or by the day it came in.
//
// Every grouping draws a filing the same way - who or what it is, up to three
// of its answers, where its round stands and when it arrived - so
// switching the grouping moves the rows rather than redrawing them. With
// nothing picked each group shows its oldest few and a way to all of them;
// a group picked is shown whole and paged.
//
// Which group is picked is chosen from an index beside the list where the
// queue has the room for a column, and from a searchable select above it
// where it does not. Both are drawn; the queue's own width shows one, so the
// server's html and the page agree without measuring anything.

export type Grouping = 'item' | 'person' | 'time'

const indexLabel = (grouping: Grouping) =>
  grouping === 'person'
    ? m.review_masterPeople()
    : grouping === 'time'
      ? m.review_masterDays()
      : m.review_masterItems()

/** the room the index needs beside a list of rows worth reading */
const BOARD_WIDE = '@container review-board (min-width: 880px)'
/** the room a row needs to lay its answers out as columns */
const ROWS_WIDE = '@container review-rows (min-width: 680px)'

/** the columns a row's parts stand in, shared by the head over the rows */
const tracksOf = (count: number) =>
  [
    'minmax(9rem, 1.1fr)',
    ...['minmax(0, 1.3fr)', 'minmax(0, 1fr)', 'minmax(0, 1fr)'].slice(0, count),
    'min-content 7rem 14px',
  ].join(' ')

/** filings to a page with one group open, and by day */
export const GROUP_PAGE = 20
/** groups to a page of the index */
const INDEX_PAGE = 20

/** a select cannot carry an empty value, so the whole queue needs a name of its own */
const ALL = 'all'
const ANSWER_AREAS = '"lead when" "answers answers"'

const styles = stylex.create({
  board: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    containerType: 'inline-size',
    containerName: 'review-board',
  },
  scope: { display: { default: 'block', [BOARD_WIDE]: 'none' }, flex: '0 1 14rem', minWidth: 0 },
  body: {
    display: { default: 'block', [BOARD_WIDE]: 'grid' },
    gridTemplateColumns: 'minmax(0, 13rem) minmax(0, 1fr)',
    columnGap: 28,
    alignItems: 'start',
  },
  // ---- the index ----
  index: {
    display: { default: 'none', [BOARD_WIDE]: 'flex' },
    position: 'sticky',
    top: 16,
    minWidth: 0,
    flexDirection: 'column',
    gap: 2,
  },
  indexHead: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 6,
    paddingInline: 10,
    paddingTop: 4,
    paddingBottom: 8,
    fontSize: 12,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  indexList: { margin: 0, padding: 0, listStyleType: 'none' },
  indexFind: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    height: 32,
    marginBottom: 6,
    paddingInline: 10,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    borderRadius: 8,
    backgroundColor: tokens.surface,
  },
  indexFindIcon: { width: 13, height: 13, flexShrink: 0, color: tokens.mutedForeground },
  indexFindInput: {
    width: '100%',
    minWidth: 0,
    borderWidth: 0,
    outline: 'none',
    backgroundColor: 'transparent',
    color: 'inherit',
    fontFamily: 'inherit',
    fontSize: 13,
  },
  indexRow: {
    display: 'flex',
    width: '100%',
    alignItems: 'center',
    gap: 10,
    borderWidth: 0,
    borderRadius: 8,
    paddingInline: 10,
    paddingBlock: 8,
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 70%, transparent)`,
    },
    color: 'inherit',
    fontFamily: 'inherit',
    fontSize: 13.5,
    textAlign: 'start',
    cursor: 'pointer',
  },
  indexRowOn: {
    backgroundColor: { default: tokens.surfaceMuted, ':hover': tokens.surfaceMuted },
  },
  indexWords: { display: 'flex', minWidth: 0, flexGrow: 1, flexDirection: 'column' },
  indexName: {
    display: '-webkit-box',
    overflow: 'hidden',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 2,
    overflowWrap: 'anywhere',
    lineHeight: 1.4,
  },
  indexNameOn: { fontWeight: 600 },
  indexNote: { fontSize: 11.5, color: tokens.mutedForeground, fontVariantNumeric: 'tabular-nums' },
  indexCount: {
    flexShrink: 0,
    fontSize: 12.5,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  indexCountOn: { color: tokens.foreground },
  listPager: { display: { default: 'block', [BOARD_WIDE]: 'none' } },
  // ---- the list ----
  list: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 12,
    containerType: 'inline-size',
    containerName: 'review-rows',
  },
  groupHead: {
    display: 'flex',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 16,
    rowGap: 8,
    paddingInline: 20,
    paddingBlock: 8,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  groupTitle: {
    display: 'flex',
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: 10,
    rowGap: 2,
    margin: 0,
    overflowWrap: 'anywhere',
    fontSize: 14,
    lineHeight: 1.4,
    fontWeight: 600,
  },
  groupNote: {
    fontSize: 12.5,
    fontWeight: 400,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  // One set of tracks per card. The status track needs only its widest badge,
  // not a fixed reservation in every row. Subgrids keep the list semantic.
  table: (tracks: string) => ({
    display: { default: 'block', [ROWS_WIDE]: 'grid' },
    gridTemplateColumns: tracks,
    columnGap: 16,
  }),
  subgrid: {
    display: { default: 'block', [ROWS_WIDE]: 'grid' },
    gridColumn: { default: 'auto', [ROWS_WIDE]: '1 / -1' },
    gridTemplateColumns: { default: 'none', [ROWS_WIDE]: 'subgrid' },
  },
  columnHead: {
    display: { default: 'none', [ROWS_WIDE]: 'grid' },
    columnGap: 16,
    alignItems: 'center',
    paddingInline: 20,
    paddingBlock: 8,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 45%, transparent)`,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  columnLabel: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  statusLabel: { whiteSpace: 'nowrap' },
  spanAnswers: (count: number) => ({ gridColumn: `span ${String(count)}` }),
  end: { textAlign: 'end' },
  rows: { margin: 0, padding: 0, listStyleType: 'none' },
  rowItem: {
    borderTopWidth: { default: 1, ':first-child': 0 },
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
  },
  // narrow, the status rides beside the time, above the answers;
  // wide, every part is a column of the tracks
  row: {
    display: 'grid',
    width: '100%',
    gridTemplateColumns: { default: 'minmax(0, 1fr) fit-content(58%)', [ROWS_WIDE]: 'subgrid' },
    columnGap: { default: 10, [ROWS_WIDE]: 16 },
    rowGap: { default: 8, [ROWS_WIDE]: 0 },
    // wide, every part of a row stands on its middle line, whether its
    // answers are one line under a head or two with their own labels
    alignItems: { default: 'start', [ROWS_WIDE]: 'center' },
    borderWidth: 0,
    paddingInline: { default: 16, [ROWS_WIDE]: 20 },
    paddingBlock: { default: 14, [ROWS_WIDE]: 12 },
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 55%, transparent)`,
    },
    color: 'inherit',
    fontFamily: 'inherit',
    textAlign: 'start',
    cursor: 'pointer',
    transitionProperty: 'background-color',
    transitionDuration: '120ms',
  },
  rowAreas: (areas: string) => ({
    gridTemplateAreas: { default: areas, [ROWS_WIDE]: 'none' },
  }),
  lead: {
    display: 'flex',
    minWidth: 0,
    gridArea: { default: 'lead', [ROWS_WIDE]: 'auto' },
    flexDirection: 'column',
    gap: 1,
  },
  leadLine: {
    display: 'flex',
    minWidth: 0,
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: 8,
  },
  leadName: {
    minWidth: 0,
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 14,
    fontWeight: 500,
  },
  leadNote: { fontSize: 12, color: tokens.mutedForeground, fontVariantNumeric: 'tabular-nums' },
  leadSub: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  answers: {
    display: { default: 'grid', [ROWS_WIDE]: 'contents' },
    gridArea: 'answers',
    gridAutoFlow: 'column',
    gridAutoColumns: 'minmax(0, 1fr)',
    columnGap: 12,
    rowGap: 8,
  },
  answersEmpty: { display: { default: 'none', [ROWS_WIDE]: 'contents' } },
  answer: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 1 },
  answerSeat: { display: { default: 'none', [ROWS_WIDE]: 'block' } },
  answerLabel: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 11.5,
    color: tokens.mutedForeground,
  },
  // a label a head over the rows already says
  answerLabelHeaded: { display: { default: 'block', [ROWS_WIDE]: 'none' } },
  answerValue: {
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 2,
    overflow: 'hidden',
    overflowWrap: 'anywhere',
    fontSize: 13.5,
    lineHeight: 1.4,
  },
  // where a round stands, as a small tinted label
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    height: 20,
    paddingInline: 7,
    borderRadius: 6,
    backgroundColor: tokens.surfaceMuted,
    color: tokens.surfaceMutedForeground,
    fontSize: 11.5,
    fontWeight: 500,
    whiteSpace: 'nowrap',
  },
  badgeWarn: {
    backgroundColor: `color-mix(in oklab, ${tokens.warning} 16%, ${tokens.surface})`,
    color: tokens.warningForeground,
  },
  badgeOk: {
    backgroundColor: `color-mix(in oklab, ${tokens.success} 14%, ${tokens.surface})`,
    color: tokens.successForeground,
  },
  mark: {
    display: 'flex',
    minWidth: 0,
    flexWrap: 'wrap',
    alignSelf: 'center',
    gap: 4,
  },
  metadata: {
    display: { default: 'flex', [ROWS_WIDE]: 'contents' },
    gridArea: { default: 'when', [ROWS_WIDE]: 'auto' },
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 4,
  },
  when: {
    alignSelf: { default: 'baseline', [ROWS_WIDE]: 'center' },
    whiteSpace: 'nowrap',
    fontSize: 12.5,
    color: tokens.mutedForeground,
    textAlign: 'end',
    fontVariantNumeric: 'tabular-nums',
  },
  chevron: {
    display: { default: 'none', [ROWS_WIDE]: 'block' },
    alignSelf: 'center',
    justifySelf: 'end',
    width: 14,
    height: 14,
    color: tokens.mutedForeground,
  },
  more: {
    display: 'flex',
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 40,
    borderWidth: 0,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 55%, transparent)`,
    },
    color: 'inherit',
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
  },
  moreIcon: { width: 12, height: 12 },
  runKey: { flexShrink: 0 },
  // a count on the small key, at the key's own size
  runCount: {
    minWidth: 'calc(1ch + 6px)',
    paddingInline: 3,
    fontSize: 11,
    lineHeight: 1.45,
  },
  // ---- bones ----
  boneText: {
    display: 'flex',
    minHeight: '1lh',
    minWidth: 0,
    maxWidth: '100%',
    alignItems: 'center',
  },
  boneTitle: { alignItems: 'center' },
  boneWhen: { justifyContent: 'flex-end' },
  boneRow: { cursor: 'default', backgroundColor: 'transparent' },
  boneScope: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    height: 36,
    paddingInline: 12,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    borderRadius: tokens.radiusMd,
    backgroundColor: tokens.surface,
  },
})

// ---- one filing ----

/** what a round is besides waiting, said only where it is more than that */
const marksOf = (row: InboxItemDto) =>
  [
    row.route === 'escalation' && ('escalated' as const),
    row.roundNo > 1 && ('round' as const),
    row.supplemented && ('supplemented' as const),
  ].filter((mark) => mark !== false)

function RoundMarks({ row }: { row: InboxItemDto }) {
  return marksOf(row).map((mark) => (
    <span
      key={mark}
      data-testid="inbox-row-mark"
      data-mark={mark}
      {...stylex.props(
        styles.badge,
        mark === 'escalated' && styles.badgeWarn,
        mark === 'supplemented' && styles.badgeOk,
      )}
    >
      {mark === 'escalated'
        ? m.review_stateEscalated()
        : mark === 'round'
          ? m.review_stateRound({ round: row.roundNo })
          : m.review_markSupplemented()}
    </span>
  ))
}

/** The server supplies the item's summary, in configured order, with blanks. */
const answersOf = (row: InboxItemDto) =>
  row.values.filter((pair) => pair.files === null).slice(0, SUMMARY_FIELDS_MOST)

function QueueRow({
  row,
  grouping,
  headed,
  summaryCount,
  onOpen,
}: {
  row: InboxItemDto
  grouping: Grouping
  /** a head over the rows names the answers, so the row need not, where it is wide */
  headed: boolean
  summaryCount: number
  onOpen: () => void
}) {
  const clock = useQueueClock()
  const byPerson = grouping === 'person'
  const answers = answersOf(row)
  const marked = marksOf(row).length > 0
  const areas = answers.length > 0 ? ANSWER_AREAS : '"lead when"'
  return (
    <li {...stylex.props(styles.subgrid, styles.rowItem)}>
      <button
        type="button"
        data-testid="inbox-row"
        data-instance={row.instanceId}
        data-answers={answers.filter((pair) => pair.value !== '').length}
        onClick={onOpen}
        {...stylex.props(styles.subgrid, styles.row, styles.rowAreas(areas))}
      >
        <span {...stylex.props(styles.lead)}>
          <span {...stylex.props(styles.leadLine)}>
            <span
              data-testid={byPerson ? undefined : 'inbox-row-name'}
              title={byPerson ? row.itemTitle : row.participantName}
              {...stylex.props(styles.leadName)}
            >
              {byPerson ? row.itemTitle : row.participantName}
            </span>
            {!byPerson && row.businessNo !== null && (
              <span {...stylex.props(styles.leadNote)}>{row.businessNo}</span>
            )}
          </span>
          {grouping === 'time' ? (
            <span {...stylex.props(styles.leadSub)}>{row.itemTitle}</span>
          ) : (
            grouping === 'item' &&
            row.unitName !== null && <span {...stylex.props(styles.leadSub)}>{row.unitName}</span>
          )}
        </span>
        {summaryCount > 0 && (
          <span {...stylex.props(styles.answers, answers.length === 0 && styles.answersEmpty)}>
            {Array.from({ length: summaryCount }, (_, index) => {
              const pair = answers[index]
              return pair === undefined ? (
                <span key={index} aria-hidden {...stylex.props(styles.answerSeat)} />
              ) : (
                <span key={index} {...stylex.props(styles.answer)}>
                  <span {...stylex.props(styles.answerLabel, headed && styles.answerLabelHeaded)}>
                    {pair.label}
                  </span>
                  <span
                    data-testid="inbox-row-value"
                    title={pair.value}
                    {...stylex.props(styles.answerValue)}
                  >
                    {pair.value}
                  </span>
                </span>
              )
            })}
          </span>
        )}
        <span {...stylex.props(styles.metadata)}>
          <span {...stylex.props(styles.mark, !marked && styles.answerSeat)}>
            <RoundMarks row={row} />
          </span>
          <span {...stylex.props(styles.when)}>{clock(row.submittedAt)}</span>
        </span>
        <ChevronRightIcon aria-hidden className={stylex.props(styles.chevron).className} />
      </button>
    </li>
  )
}

// ---- one group ----

interface GroupView {
  readonly key: string
  readonly title: string
  /** said quietly on the title's line: a person's number and class */
  readonly note: string | null
  readonly count: number
  readonly rows: readonly InboxItemDto[]
  /** the run a group's own key walks; null where a group is no run */
  readonly run: string | null
  readonly runLabel: string
  readonly firstInstanceId: string | null
}

function GroupColumns({
  grouping,
  summaryCount,
  labels,
  pending = false,
}: {
  grouping: Grouping
  summaryCount: number
  labels?: readonly string[]
  pending?: boolean
}) {
  return (
    <div aria-hidden {...stylex.props(styles.subgrid, styles.columnHead)}>
      <span>{grouping === 'person' ? m.review_columnItem() : m.review_columnWho()}</span>
      {labels !== undefined ? (
        labels.map((label, index) => (
          <span key={index} {...stylex.props(styles.columnLabel)}>
            {label}
          </span>
        ))
      ) : pending && grouping === 'item' ? (
        Array.from({ length: summaryCount }, (_, index) => (
          <div key={index} {...stylex.props(styles.boneText)}>
            <Skeleton width="55%" height={8} />
          </div>
        ))
      ) : summaryCount > 0 ? (
        <span {...stylex.props(styles.columnLabel, styles.spanAnswers(summaryCount))}>
          {m.review_columnFiled()}
        </span>
      ) : null}
      <span {...stylex.props(styles.statusLabel)}>{m.review_columnState()}</span>
      <span {...stylex.props(styles.end)}>{m.review_columnWhen()}</span>
      <span />
    </div>
  )
}

function GroupCard({
  group,
  grouping,
  more,
  foot,
  onOpen,
}: {
  group: GroupView
  grouping: Grouping
  /** the way to all of a group shown only in part */
  more: (() => void) | null
  foot?: ReactNode
  onOpen: (row: Pick<InboxItemDto, 'instanceId'>, run: string) => void
}) {
  // One project's filings share their questions, so the head names each
  // answer and the rows need not. A person's or a day's run across
  // projects, so their head says only that these are what was filed, and
  // each answer keeps its own label.
  const byItem = grouping === 'item'
  const summaries = group.rows.map(answersOf)
  const summaryCount = Math.max(0, ...summaries.map((answers) => answers.length))
  const labels = (summaries[0] ?? []).map((pair) => pair.label)
  // A project's rows can still have different schemas across form revisions.
  // Keep their own labels where a shared header would name the wrong field.
  const headed =
    byItem &&
    summaries.every(
      (answers) =>
        answers.length === labels.length &&
        answers.every((answer, index) => answer.label === labels[index]),
    )
  const tracks = tracksOf(summaryCount)
  const run = group.run ?? ''
  return (
    <Card data-testid="queue-group" data-key={group.key} data-count={group.count} tabIndex={-1}>
      <div {...stylex.props(styles.groupHead)}>
        <h2 {...stylex.props(styles.groupTitle)}>
          {group.title}
          {group.note !== null && <span {...stylex.props(styles.groupNote)}>{group.note}</span>}
        </h2>
        {group.run !== null && group.firstInstanceId !== null && (
          <Button
            size="xs"
            variant="outline"
            className={stylex.props(styles.runKey).className}
            data-testid="queue-run"
            onClick={() => onOpen({ instanceId: group.firstInstanceId! }, run)}
          >
            {group.runLabel}
            <Count xstyle={styles.runCount}>{group.count}</Count>
          </Button>
        )}
      </div>
      <div data-slot="review-group-table" {...stylex.props(styles.table(tracks))}>
        <GroupColumns
          grouping={grouping}
          summaryCount={summaryCount}
          {...(headed ? { labels } : {})}
        />
        <ul {...stylex.props(styles.subgrid, styles.rows)}>
          {group.rows.map((row) => (
            <QueueRow
              key={row.instanceId}
              row={row}
              grouping={grouping}
              headed={headed}
              summaryCount={summaryCount}
              onOpen={() => onOpen(row, run)}
            />
          ))}
        </ul>
      </div>
      {more !== null && (
        <button
          type="button"
          data-testid="queue-group-more"
          onClick={more}
          {...stylex.props(styles.more)}
        >
          {m.review_seeAll({ count: group.count })}
          <ChevronRightIcon aria-hidden className={stylex.props(styles.moreIcon).className} />
        </button>
      )}
      {foot}
    </Card>
  )
}

// ---- the index, and the select that stands for it ----

interface IndexEntry {
  readonly key: string
  readonly name: string
  readonly note: string | null
  readonly count: number
}

/** an index longer than this is found in by name as well as read down */
const FINDABLE = 10

function QueueIndex({
  label,
  findLabel,
  total,
  all,
  entries,
  picked,
  groupPager,
  onPick,
}: {
  label: string
  findLabel: string
  /** how many groups the whole queue holds, beyond this page of them */
  total: number
  all: IndexEntry
  entries: readonly IndexEntry[]
  picked: string
  groupPager: ReactNode
  onPick: (key: string) => void
}) {
  const [find, setFind] = useState('')
  const needle = find.trim().toLowerCase()
  const shown =
    needle === ''
      ? entries
      : entries.filter((entry) =>
          [entry.name, entry.note ?? ''].some((part) => part.toLowerCase().includes(needle)),
        )
  const row = (entry: IndexEntry) => {
    const on = entry.key === picked
    return (
      <li key={entry.key === '' ? ALL : entry.key}>
        <button
          type="button"
          data-testid="queue-index-row"
          data-key={entry.key}
          data-count={entry.count}
          aria-current={on || undefined}
          onClick={() => onPick(entry.key)}
          {...stylex.props(styles.indexRow, on && styles.indexRowOn)}
        >
          <span {...stylex.props(styles.indexWords)}>
            <span title={entry.name} {...stylex.props(styles.indexName, on && styles.indexNameOn)}>
              {entry.name}
            </span>
            {entry.note !== null && <span {...stylex.props(styles.indexNote)}>{entry.note}</span>}
          </span>
          <span {...stylex.props(styles.indexCount, on && styles.indexCountOn)}>{entry.count}</span>
        </button>
      </li>
    )
  }
  return (
    <nav aria-label={label} data-testid="queue-index" {...stylex.props(styles.index)}>
      <span {...stylex.props(styles.indexHead)}>
        {label}
        <span>{total}</span>
      </span>
      {total > FINDABLE && (
        <label {...stylex.props(styles.indexFind)}>
          <SearchIcon aria-hidden className={stylex.props(styles.indexFindIcon).className} />
          <input
            type="search"
            aria-label={findLabel}
            placeholder={findLabel}
            value={find}
            onChange={(event) => setFind(event.target.value)}
            {...stylex.props(styles.indexFindInput)}
          />
        </label>
      )}
      <ul {...stylex.props(styles.indexList)}>
        {needle === '' && row(all)}
        {shown.map(row)}
      </ul>
      {groupPager}
    </nav>
  )
}

export function QueueScope({
  grouping,
  data,
  loadingSelection,
  onPick,
}: {
  grouping: Grouping
  data: QueuePage
  loadingSelection: string | null
  onPick: (key: string) => void
}) {
  const { all, entries } = useQueueIndex(grouping, data)
  const label =
    grouping === 'person'
      ? m.review_findPerson()
      : grouping === 'time'
        ? m.review_findDay()
        : m.review_findItem()
  return (
    <div data-testid="queue-scope" {...stylex.props(styles.scope)}>
      <SearchSelect
        id="review-queue-scope"
        aria-label={label}
        value={(loadingSelection ?? data.selected) || ALL}
        placeholder={label}
        noMatches={m.review_findNone()}
        options={[
          { value: ALL, label: all.name, count: all.count },
          ...entries.map((entry) => ({
            value: entry.key,
            label: entry.name,
            count: entry.count,
            keywords: entry.note === null ? [] : [entry.note],
          })),
        ]}
        onValueChange={(next) => onPick(next === ALL ? '' : next)}
      />
    </div>
  )
}

export function QueueScopeSkeleton() {
  return (
    <div aria-hidden {...stylex.props(styles.scope)}>
      <div {...stylex.props(styles.boneScope)}>
        <Skeleton width={54} height={10} />
        <Skeleton width={16} height={16} radius={4} />
      </div>
    </div>
  )
}

// ---- pagers ----

/** the strip under a list longer than a page; nothing under one that fits */
export function PagerFoot({
  list,
  size,
  onPage,
  anchor = 'queue-group',
  compact,
  disabled,
  testId = 'review-queue-pager',
}: {
  testId?: string
  disabled?: boolean
  list: {
    readonly page: number
    readonly from: number
    readonly to: number
    readonly total: number
  }
  size: number
  onPage: (page: number) => void
  /** the card whose top the next page is read from */
  anchor?: string
  /** figures alone, for a strip with little room; the window decides where the caller does not */
  compact?: boolean
}) {
  const beside = useBeside()
  if (list.total <= size) return null
  return (
    <CardFoot>
      <Pager
        testId={testId}
        disabled={disabled}
        label={m.review_pager()}
        page={list.page}
        pageSize={size}
        total={list.total}
        compact={compact ?? !beside}
        summary={m.review_pageSummary({
          from: list.from,
          to: list.to,
          total: list.total,
        })}
        onPage={(next) => {
          const anchorNode = document.querySelector<HTMLElement>(`[data-testid="${anchor}"]`)
          anchorNode?.focus({ preventScroll: true })
          anchorNode?.scrollIntoView({ block: 'nearest', behavior: scrollMotion() })
          onPage(next)
        }}
      />
    </CardFoot>
  )
}

const listOf = (page: number, size: number, total: number, shown: number) => ({
  page,
  from: total === 0 ? 0 : (page - 1) * size + 1,
  to: (page - 1) * size + shown,
  total,
})

// ---- the board ----

export function QueueBoard({
  grouping,
  data,
  loadingSelection,
  fetching,
  onPick,
  onPage,
  onGroupPage,
  onOpen,
  empty,
}: {
  grouping: Grouping
  data: QueuePage
  loadingSelection: string | null
  /** said in the list's place where the narrowed queue holds nothing */
  empty?: ReactNode
  fetching: boolean
  /** a group's key, or empty for the whole queue */
  onPick: (key: string) => void
  onPage: (page: number) => void
  onGroupPage: (page: number) => void
  onOpen: (row: Pick<InboxItemDto, 'instanceId'>, run: string) => void
}) {
  const zone = useBatchZone()
  const { all, entries, nameOf, noteOf } = useQueueIndex(grouping, data)
  const itemPage = listOf(data.page, data.pageSize, data.total, data.items.length)
  const person = grouping === 'person'
  const byDay = grouping === 'time'
  const picked = loadingSelection ?? data.selected ?? ''
  const keyOf = (row: InboxItemDto) =>
    byDay ? dayKeyOf(Date.parse(row.submittedAt), zone) : person ? row.participantId : row.itemId
  const viewOf = (
    group: QueuePage['groups'][number],
    rows: readonly InboxItemDto[],
  ): GroupView => ({
    key: group.key,
    title: nameOf(group),
    note: noteOf(group),
    count: group.count,
    rows,
    // a day is no run of its own: a day's filings are walked as the queue is
    run: byDay
      ? null
      : writeRunScope(
          person
            ? { kind: 'person', participantId: group.key }
            : { kind: 'item', itemId: group.key },
        ),
    runLabel: person ? m.review_startPerson() : m.review_startItem(),
    firstInstanceId: group.firstInstanceId,
  })
  const groupPagerAt = (testId: string) =>
    data.groupTotal > INDEX_PAGE ? (
      <Pager
        testId={testId}
        disabled={fetching}
        label={m.review_pager()}
        page={data.groupPage}
        pageSize={INDEX_PAGE}
        total={data.groupTotal}
        compact
        onPage={onGroupPage}
      />
    ) : null

  const open = data.groups.find((group) => group.key === picked)
  const list =
    open !== undefined ? (
      <GroupCard
        grouping={grouping}
        group={viewOf(
          open,
          data.items.filter((row) => keyOf(row) === open.key),
        )}
        more={null}
        foot={
          <PagerFoot list={itemPage} size={data.pageSize} disabled={fetching} onPage={onPage} />
        }
        onOpen={onOpen}
      />
    ) : (
      data.groups.map((group) => {
        const rows = data.items.filter((row) => keyOf(row) === group.key)
        return (
          <GroupCard
            key={group.key}
            grouping={grouping}
            group={viewOf(group, rows)}
            more={group.count > rows.length ? () => onPick(group.key) : null}
            onOpen={onOpen}
          />
        )
      })
    )

  return (
    <div
      data-testid="queue-layout"
      data-layout={open === undefined ? 'overview' : 'group'}
      data-grouping={grouping}
      {...stylex.props(styles.board)}
    >
      <div {...stylex.props(styles.body)}>
        <QueueIndex
          label={indexLabel(grouping)}
          findLabel={
            person ? m.review_findPerson() : byDay ? m.review_findDay() : m.review_findItem()
          }
          total={data.groupTotal}
          all={all}
          entries={entries}
          picked={picked}
          groupPager={groupPagerAt('review-groups-pager')}
          onPick={onPick}
        />
        <div
          role={loadingSelection !== null ? 'status' : undefined}
          aria-label={loadingSelection !== null ? commonMessages.state_loading() : undefined}
          {...stylex.props(styles.list)}
        >
          {loadingSelection !== null ? (
            <QueueSkeletonCards
              grouping={grouping}
              rowsPerCard={skeletonRowsOf(
                picked === '' ? data.filteredTotal : open?.count,
                picked !== '',
              )}
            />
          ) : data.groups.length === 0 && empty !== undefined ? (
            empty
          ) : (
            list
          )}
          {/* where the index is not drawn, its pages are turned under the list */}
          {loadingSelection === null && open === undefined && data.groupTotal > INDEX_PAGE && (
            <div {...stylex.props(styles.listPager)}>
              {groupPagerAt('review-groups-pager-list')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function useQueueIndex(grouping: Grouping, data: QueuePage) {
  const heading = useDayHeading()
  const person = grouping === 'person'
  const byDay = grouping === 'time'
  const nameOf = (group: QueuePage['groups'][number]) =>
    byDay ? heading(group.oldest) : group.name
  const noteOf = (group: QueuePage['groups'][number]) =>
    person
      ? [group.businessNo, group.unitName].filter((part) => part !== null).join('\u3000') || null
      : null
  const entries: IndexEntry[] = data.groups.map((group) => ({
    key: group.key,
    name: nameOf(group),
    note: noteOf(group),
    count: group.count,
  }))
  const all: IndexEntry = {
    key: '',
    name: byDay ? m.review_allDays() : person ? m.review_allPeople() : m.review_filterAllItems(),
    note: null,
    count: data.filteredTotal,
  }
  return { all, entries, nameOf, noteOf }
}

/** The skeleton uses the board's own card, tracks and compact row layout. */
export function QueueSkeleton({
  grouping,
  scoped,
  total,
}: {
  grouping: Grouping
  scoped: boolean
  total: number | undefined
}) {
  const byPerson = grouping === 'person'
  const cards = skeletonRowsOf(total, scoped)
  const preview = cards.reduce((sum, rows) => sum + rows, 0)
  return (
    <div aria-hidden {...stylex.props(styles.board)}>
      <div {...stylex.props(styles.body)}>
        <div {...stylex.props(styles.index)}>
          <div {...stylex.props(styles.indexHead, styles.boneTitle)}>
            {indexLabel(grouping)}
            <Skeleton width={12} height={8} />
          </div>
          <ul {...stylex.props(styles.indexList)}>
            {['42%', '60%', '48%']
              .slice(0, scoped ? preview + 1 : cards.length + 1)
              .map((width, index) => (
                <li key={width}>
                  <div
                    {...stylex.props(
                      styles.indexRow,
                      styles.boneRow,
                      (scoped ? index === 1 : index === 0) && styles.indexRowOn,
                    )}
                  >
                    <div {...stylex.props(styles.indexWords)}>
                      <div {...stylex.props(styles.indexName, styles.boneText)}>
                        <Skeleton width={width} height={10} />
                      </div>
                      {byPerson && index > 0 && (
                        <div {...stylex.props(styles.indexNote, styles.boneText)}>
                          <Skeleton width="72%" height={8} />
                        </div>
                      )}
                    </div>
                    <Skeleton width={10} height={9} />
                  </div>
                </li>
              ))}
          </ul>
        </div>
        <div {...stylex.props(styles.list)}>
          <QueueSkeletonCards grouping={grouping} rowsPerCard={cards} />
        </div>
      </div>
    </div>
  )
}

// Keep the preview small, and don't draw more rows than the known total.
function skeletonRowsOf(total: number | undefined, scoped: boolean): readonly number[] {
  const preview = Math.min(3, Math.max(1, total ?? 3))
  return scoped || preview === 1 ? [preview] : [1, preview - 1]
}

function QueueSkeletonCards({
  grouping,
  rowsPerCard,
}: {
  grouping: Grouping
  rowsPerCard: readonly number[]
}) {
  const byPerson = grouping === 'person'
  const byItem = grouping === 'item'
  const summaryCount = 2
  return (
    <>
      {rowsPerCard.map((rows, index) => (
        <Card key={index} aria-hidden data-slot="review-group-placeholder">
          <div {...stylex.props(styles.groupHead)}>
            <div {...stylex.props(styles.groupTitle, styles.boneTitle)}>
              <div {...stylex.props(styles.boneText)}>
                <Skeleton width={byItem ? 108 : 78} height={11} />
              </div>
              {byPerson && <Skeleton width={72} height={9} />}
            </div>
            {grouping !== 'time' && <Skeleton width={96} height={24} radius={6} />}
          </div>
          <div
            data-slot="review-group-table"
            {...stylex.props(styles.table(tracksOf(summaryCount)))}
          >
            <GroupColumns grouping={grouping} summaryCount={summaryCount} pending />
            <ul {...stylex.props(styles.subgrid, styles.rows)}>
              {Array.from({ length: rows }, (_, row) => (
                <li key={row} {...stylex.props(styles.subgrid, styles.rowItem)}>
                  <div
                    {...stylex.props(
                      styles.subgrid,
                      styles.row,
                      styles.rowAreas(ANSWER_AREAS),
                      styles.boneRow,
                    )}
                  >
                    <div {...stylex.props(styles.lead)}>
                      <div {...stylex.props(styles.leadLine)}>
                        <div {...stylex.props(styles.leadName, styles.boneText)}>
                          <Skeleton width={byPerson ? 78 : 46} height={11} />
                        </div>
                        {!byPerson && (
                          <div {...stylex.props(styles.leadNote, styles.boneText)}>
                            <Skeleton width={54} height={9} />
                          </div>
                        )}
                      </div>
                      {!byPerson && (
                        <div {...stylex.props(styles.leadSub, styles.boneText)}>
                          <Skeleton width={82} height={9} />
                        </div>
                      )}
                    </div>
                    <div {...stylex.props(styles.answers)}>
                      {['76%', '51%'].map((width) => (
                        <div key={width} {...stylex.props(styles.answer)}>
                          <div
                            {...stylex.props(
                              styles.answerLabel,
                              styles.boneText,
                              byItem && styles.answerLabelHeaded,
                            )}
                          >
                            <Skeleton width="47%" height={8} />
                          </div>
                          <div {...stylex.props(styles.answerValue, styles.boneText)}>
                            <Skeleton width={width} height={10} />
                          </div>
                        </div>
                      ))}
                    </div>
                    <div {...stylex.props(styles.metadata)}>
                      <div {...stylex.props(styles.mark)}>
                        <Skeleton width={36} height={20} radius={6} />
                      </div>
                      <div {...stylex.props(styles.when, styles.boneText, styles.boneWhen)}>
                        <Skeleton width={72} height={9} />
                      </div>
                    </div>
                    <div {...stylex.props(styles.chevron)} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      ))}
    </>
  )
}
