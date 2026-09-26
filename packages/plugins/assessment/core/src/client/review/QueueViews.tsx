import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { Avatar, AvatarFallback } from '@qualy/ui/avatar'
import { Button } from '@qualy/ui/button'
import { Pager } from '@qualy/ui/pager'
import { Drill, type DrillMove } from '@qualy/ui/reveal'
import { Skeleton } from '@qualy/ui/skeleton'
import {
  Card,
  CardFoot,
  Cell,
  LeadWord,
  Status,
  Table,
  TableHead,
  TableRow,
  TableSkeleton,
} from '@qualy/ui/screen'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { assessmentMessages as m } from '../i18n.ts'
import { scrollMotion, useBeside, useMedia } from './pointer.ts'
import {
  groupByItem,
  groupByPerson,
  pageOf,
  rowSummary,
  useDayClock,
  useQueueClock,
  writeRunScope,
  type InboxItemDto,
} from './model.ts'

// The queue laid out for working through it.
//
// By question and by person, the queue is a list of what has work in it
// beside the work of the one picked: the questions (or the people) on the
// left with how much is waiting and since when, the picked one's filings on
// the right, ten to a page. Narrower than a desk the two are one screen
// after the other - the list first, the picked one's filings a step in -
// the way "my entries" goes from its structure into a question. By time
// the queue is one table, oldest first.
//
// Pages are cut from the whole queue, which is read in full (queue.ts): the
// counts, the search and the run a reviewer walks are all about the whole
// of it, and a run started from a page still walks the whole question.

/** filings to a page where one question or one person is open */
const PANE_PAGE = 10
/** filings to a page of the whole queue by time */
const TIME_PAGE = 20
/**
 * The column a round's standing takes where any row on the page has one: a
 * fixed width, because every row is a grid of its own, and a track sized by
 * its own content put one row's time a word to the left of the next.
 */
const MARK_COLUMN = '7rem'

const styles = stylex.create({
  split: {
    display: 'grid',
    alignItems: 'start',
    gap: 16,
    gridTemplateColumns: {
      default: '15rem minmax(0, 1fr)',
      '@media (min-width: 1440px)': '18rem minmax(0, 1fr)',
    },
  },
  // the list stands while its picked one's filings are read and paged; how
  // tall it may grow is measured, so its foot is never below the window's
  masterSeat: {
    position: 'sticky',
    top: 16,
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
  },
  paneSeat: { minWidth: 0 },
  master: { minHeight: 0, flexShrink: 1 },
  masterHead: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'baseline',
    gap: 8,
    minHeight: 42,
    paddingInline: 16,
    paddingBlock: 12,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  masterTitle: { margin: 0, fontSize: 13, lineHeight: 1.4, fontWeight: 600 },
  masterTally: {
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    color: tokens.mutedForeground,
  },
  masterList: {
    minHeight: 0,
    margin: 0,
    padding: 0,
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    listStyleType: 'none',
  },
  masterItem: {
    borderBottomWidth: { default: 1, ':last-child': 0 },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  masterRow: {
    display: 'flex',
    width: '100%',
    minHeight: { default: 52, [breakpoints.phone]: 56 },
    alignItems: 'center',
    gap: 10,
    borderWidth: 0,
    paddingInline: 16,
    paddingBlock: 10,
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 55%, transparent)`,
    },
    fontFamily: 'inherit',
    textAlign: 'start',
    color: 'inherit',
    cursor: 'pointer',
    transitionProperty: 'background-color',
    transitionDuration: '120ms',
  },
  masterRowOn: {
    backgroundColor: { default: tokens.surfaceMuted, ':hover': tokens.surfaceMuted },
    boxShadow: `inset 2px 0 0 ${tokens.foreground}`,
  },
  masterWords: {
    display: 'flex',
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
    gap: 2,
  },
  // two lines of a long question's name, then an ellipsis: one line cut
  // most names to their first few words, and three made the list a column
  // of paragraphs
  masterName: {
    display: '-webkit-box',
    overflow: 'hidden',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 2,
    overflowWrap: 'anywhere',
    fontSize: 13.5,
    lineHeight: 1.45,
    fontWeight: 500,
  },
  masterNameOn: { fontWeight: 600 },
  masterNameLine: { display: 'flex', minWidth: 0, alignItems: 'baseline', gap: 8 },
  masterMeta: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    color: tokens.mutedForeground,
  },
  masterCount: {
    flexShrink: 0,
    minWidth: 24,
    fontSize: 13,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
    textAlign: 'end',
  },
  masterChevron: { width: 14, height: 14, flexShrink: 0, color: tokens.mutedForeground },
  face: { width: 28, height: 28, flexShrink: 0 },
  faceText: { fontSize: 12, fontWeight: 500 },
  // ---- the picked one's head ----
  paneHead: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    paddingInline: 16,
    paddingTop: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  paneBack: {
    alignSelf: 'flex-start',
    marginInlineStart: -8,
    color: tokens.mutedForeground,
  },
  paneHeadRow: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 12,
    flexWrap: { default: null, [breakpoints.phone]: 'wrap' },
  },
  paneWords: {
    display: 'flex',
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
    gap: 3,
  },
  paneTitle: {
    margin: 0,
    overflowWrap: 'anywhere',
    fontSize: 15,
    lineHeight: 1.4,
    fontWeight: 600,
    textWrap: 'pretty',
  },
  paneAction: {
    flexShrink: 0,
    width: { default: null, [breakpoints.phone]: '100%' },
  },
  facts: {
    display: 'flex',
    minWidth: 0,
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 8,
    rowGap: 2,
    margin: 0,
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    color: tokens.mutedForeground,
  },
  factRule: {
    width: 1,
    height: 10,
    flexShrink: 0,
    backgroundColor: `color-mix(in oklab, ${tokens.foreground} 12%, transparent)`,
  },
  businessNo: {
    flexShrink: 0,
    fontSize: 12,
    fontWeight: 400,
    fontVariantNumeric: 'tabular-nums',
    color: tokens.mutedForeground,
  },
  quietFiled: { color: tokens.mutedForeground },
  // ---- the queue's shape while it is read ----
  skHead: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    paddingInline: 16,
    paddingBlock: 14,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  skTitle: { height: 16, width: '42%' },
  skFacts: { height: 12, width: '28%' },
  skMasterRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    paddingInline: 16,
    paddingBlock: 12,
    borderBottomWidth: { default: 1, ':last-child': 0 },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  skName: { height: 14 },
  skMeta: { height: 11, width: '45%' },
})

/** what a row opens: the filing, walked as part of the named run */
type OpenRow = (row: InboxItemDto, run: string) => void

/** the page's own margin under the list, which the list stops short of */
const PAGE_FOOT = 24

/**
 * The tallest the list beside the filings may be: to the window's foot from
 * wherever it stands now, so it scrolls inside itself rather than growing
 * the page. Measured again as the page scrolls it up to where it sticks.
 */
function useFitsTheWindow(node: HTMLElement | null) {
  useLayoutEffect(() => {
    if (node === null) return
    let scroller: HTMLElement | null = node.parentElement
    while (scroller !== null && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement
    }
    let frame = 0
    const fit = () => {
      frame = 0
      const floor =
        scroller === null
          ? window.innerHeight
          : Math.min(window.innerHeight, scroller.getBoundingClientRect().bottom)
      const room = Math.floor(floor - node.getBoundingClientRect().top - PAGE_FOOT)
      node.style.maxHeight = `${String(Math.max(240, room))}px`
    }
    const later = () => {
      if (frame === 0) frame = requestAnimationFrame(fit)
    }
    fit()
    const target: HTMLElement | Window = scroller ?? window
    target.addEventListener('scroll', later, { passive: true })
    window.addEventListener('resize', later)
    return () => {
      cancelAnimationFrame(frame)
      target.removeEventListener('scroll', later)
      window.removeEventListener('resize', later)
      node.style.maxHeight = ''
    }
  }, [node])
}

/**
 * The list and the picked one's filings, beside each other or one after
 * the other.
 *
 * Narrow, which one is on screen follows the address: nothing picked is the
 * list, something picked is its filings with the way back above them. The
 * step in and the step back arrive from the side they came from.
 */
function Split({
  chosen,
  master,
  pane,
}: {
  /** the key of the one picked in the address, where it names one in the list */
  chosen: string | null
  master: ReactNode
  pane: ReactNode
}) {
  const beside = useBeside()
  const [seen, setSeen] = useState<{ chosen: string | null; move: DrillMove }>({
    chosen,
    move: 'none',
  })
  if (seen.chosen !== chosen) {
    setSeen({ chosen, move: seen.chosen === null ? 'in' : chosen === null ? 'out' : 'none' })
  }
  const [seat, setSeat] = useState<HTMLDivElement | null>(null)
  useFitsTheWindow(beside ? seat : null)
  if (beside) {
    return (
      <div {...stylex.props(styles.split)}>
        <div ref={setSeat} data-testid="queue-master-seat" {...stylex.props(styles.masterSeat)}>
          {master}
        </div>
        <div {...stylex.props(styles.paneSeat)}>{pane}</div>
      </div>
    )
  }
  return (
    <Drill move={seen.move} drillKey={chosen ?? ''}>
      {chosen === null ? master : pane}
    </Drill>
  )
}

/** the list a queue is picked from: a head that says how many, and the rows */
function MasterCard({
  title,
  count,
  selected,
  children,
}: {
  title: string
  count: number
  /** the key of the row picked, kept in sight when the list is longer than the column */
  selected: string | null
  children: ReactNode
}) {
  const list = useRef<HTMLUListElement>(null)
  useEffect(() => {
    if (selected === null) return
    list.current
      ?.querySelector(`[data-key="${CSS.escape(selected)}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [selected])
  return (
    <Card xstyle={styles.master} data-testid="queue-master">
      <div {...stylex.props(styles.masterHead)}>
        <h2 {...stylex.props(styles.masterTitle)}>{title}</h2>
        <span {...stylex.props(styles.masterTally)}>{count}</span>
      </div>
      <ul ref={list} {...stylex.props(styles.masterList)}>
        {children}
      </ul>
    </Card>
  )
}

function MasterRow({
  id,
  name,
  note = null,
  meta,
  count,
  face,
  selected,
  drills,
  onChoose,
}: {
  id: string
  name: string
  /** said quietly after the name: a number the name is told apart by */
  note?: string | null
  meta: string | null
  count: number
  face?: ReactNode
  selected: boolean
  /** narrow, a row is a step into its own screen, and says so */
  drills: boolean
  onChoose: () => void
}) {
  return (
    <li {...stylex.props(styles.masterItem)}>
      <button
        type="button"
        data-testid="queue-master-row"
        data-key={id}
        data-count={count}
        data-selected={selected}
        aria-current={selected || undefined}
        onClick={onChoose}
        {...stylex.props(styles.masterRow, selected && styles.masterRowOn)}
      >
        {face}
        <span {...stylex.props(styles.masterWords)}>
          <span {...stylex.props(styles.masterNameLine)}>
            <span {...stylex.props(styles.masterName, selected && styles.masterNameOn)}>
              {name}
            </span>
            {note !== null && <span {...stylex.props(styles.businessNo)}>{note}</span>}
          </span>
          {meta !== null && <span {...stylex.props(styles.masterMeta)}>{meta}</span>}
        </span>
        <span {...stylex.props(styles.masterCount)}>{count}</span>
        {drills && (
          <ChevronRightIcon aria-hidden className={stylex.props(styles.masterChevron).className} />
        )}
      </button>
    </li>
  )
}

/** a few facts about the picked one, with a hairline between them */
function Facts({ items }: { items: readonly (string | null)[] }) {
  const said = items.filter((item): item is string => item !== null && item !== '')
  return (
    <p {...stylex.props(styles.facts)}>
      {said.map((item, index) => (
        <span key={index} {...stylex.props(styles.facts)}>
          {index > 0 && <span aria-hidden {...stylex.props(styles.factRule)} />}
          <span>{item}</span>
        </span>
      ))}
    </p>
  )
}

/** the picked one's name, what is true of it, and the run that starts from it */
function PaneHead({
  title,
  face,
  facts,
  action,
  back,
}: {
  title: string
  face?: ReactNode
  facts: ReactNode
  action: ReactNode
  /** narrow, the way back to the list; the system back key goes there too */
  back: { label: string; onBack: () => void } | null
}) {
  return (
    <div {...stylex.props(styles.paneHead)}>
      {back !== null && (
        <Button
          variant="ghost"
          size="sm"
          data-testid="queue-pane-back"
          className={stylex.props(styles.paneBack).className}
          onClick={back.onBack}
        >
          <ChevronLeftIcon aria-hidden />
          {back.label}
        </Button>
      )}
      <div {...stylex.props(styles.paneHeadRow)}>
        {face}
        <div {...stylex.props(styles.paneWords)}>
          <h2 {...stylex.props(styles.paneTitle)}>{title}</h2>
          {facts}
        </div>
        <span {...stylex.props(styles.paneAction)}>{action}</span>
      </div>
    </div>
  )
}

/** the strip under a list longer than a page; nothing under one that fits */
export function PagerFoot({
  list,
  size,
  onPage,
  anchor = 'queue-pane',
}: {
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
}) {
  const { format } = useI18n()
  const beside = useBeside()
  if (list.total <= size) return null
  return (
    <CardFoot>
      <Pager
        testId="review-queue-pager"
        label={format(m.reviewPagerLabel)}
        page={list.page}
        pageSize={size}
        total={list.total}
        compact={!beside}
        summary={format(m.reviewPageSummary, {
          from: list.from,
          to: list.to,
          total: list.total,
        })}
        onPage={(next) => {
          onPage(next)
          // the strip is at the foot of the list; the next page is read
          // from its top
          document
            .querySelector(`[data-testid="${anchor}"]`)
            ?.scrollIntoView({ block: 'nearest', behavior: scrollMotion() })
        }}
      />
    </CardFoot>
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

/**
 * Where a round stands, said only where it is not simply waiting: every row
 * of the queue is waiting, and a word on every row saying so was a column
 * of noise the two that mattered hid in.
 */
const markOf = (row: InboxItemDto): 'escalated' | 'round' | null =>
  row.route === 'escalation' ? 'escalated' : row.roundNo > 1 ? 'round' : null

function RoundMark({ row }: { row: InboxItemDto }) {
  const { format } = useI18n()
  const mark = markOf(row)
  if (mark === null) return null
  return (
    <Status
      tone={mark === 'escalated' ? 'warn' : 'plain'}
      data-testid="inbox-row-mark"
      data-mark={mark}
    >
      {mark === 'escalated'
        ? format(m.reviewStateEscalated)
        : format(m.reviewStateRound, { round: row.roundNo })}
    </Status>
  )
}

/** who filed it, by name and number */
function Who({ row }: { row: InboxItemDto }) {
  return (
    <>
      <LeadWord>{row.participantName}</LeadWord>
      {row.businessNo !== null && (
        <span {...stylex.props(styles.businessNo)}>{row.businessNo}</span>
      )}
    </>
  )
}

/** a face for somebody in a list of people */
function Face({ name }: { name: string }) {
  return (
    <Avatar className={stylex.props(styles.face).className}>
      <AvatarFallback className={stylex.props(styles.faceText).className}>
        {name.slice(0, 1)}
      </AvatarFallback>
    </Avatar>
  )
}

/**
 * How much of the row each answer column takes, by the longest answer the
 * question holds: a competition's name and a grade given the same width
 * left the name cut short beside a grade with room to spare. Read over the
 * whole question rather than one page of it, so paging never moves the
 * columns.
 */
const answerColumns = (count: number, rows: readonly InboxItemDto[]): string[] =>
  Array.from({ length: count }, (_, index) => {
    const longest = Math.max(
      0,
      ...rows.map((row) => {
        const pair = row.values[index]
        return pair === undefined ? 0 : pair.files !== null ? 4 : [...pair.value].length
      }),
    )
    return `minmax(0, ${String(Math.min(3, Math.max(1, Math.round(longest / 8))))}fr)`
  })

/** a row's answers on one line, a field of files said as how many */
const answersOf = (row: InboxItemDto, files: (count: number) => string): string =>
  row.values
    .map((pair) => (pair.files === null ? pair.value : pair.files === 0 ? '' : files(pair.files)))
    .filter((value) => value !== '')
    .join('\u3000')

/** a phone, where a table's row stacks its facts under its name */
const usePhone = () => useMedia('(max-width: 767.98px)', false)

/** the key the address names, where the list still has it */
const pickedOf = <Group,>(
  groups: readonly Group[],
  keyOf: (group: Group) => string,
  key: string,
) => (key === '' ? undefined : groups.find((group) => keyOf(group) === key))

/** the queue by question: which questions have work, and one question's filings */
export function ItemQueue({
  rows,
  chosen,
  page,
  onChoose,
  onBack,
  onPage,
  onOpen,
}: {
  rows: readonly InboxItemDto[]
  /** the question named in the address; empty for none */
  chosen: string
  page: number
  onChoose: (itemId: string) => void
  onBack: () => void
  onPage: (page: number) => void
  onOpen: OpenRow
}) {
  const { format } = useI18n()
  const beside = useBeside()
  const phone = usePhone()
  const since = useDayClock()
  const clock = useQueueClock()
  const groups = groupByItem(rows)
  const named = pickedOf(groups, (group) => group.itemId, chosen)
  // at a desk something is always open: the question that has waited longest
  const open = named ?? (beside ? groups[0] : undefined)

  const master = (
    <MasterCard
      title={format(m.reviewMasterItems)}
      count={groups.length}
      selected={open?.itemId ?? null}
    >
      {groups.map((group) => (
        <MasterRow
          key={group.itemId}
          id={group.itemId}
          name={group.itemTitle}
          meta={format(m.reviewOldest, { when: since(group.rows[0]!.submittedAt) })}
          count={group.rows.length}
          selected={beside && open?.itemId === group.itemId}
          drills={!beside}
          onChoose={() => onChoose(group.itemId)}
        />
      ))}
    </MasterCard>
  )

  let pane: ReactNode = null
  if (open !== undefined) {
    const list = pageOf(open.rows, page, PANE_PAGE)
    const run = writeRunScope({ kind: 'item', itemId: open.itemId })
    const marked = list.rows.some((row) => markOf(row) !== null)
    const columns = [
      'minmax(8rem, 11rem)',
      ...answerColumns(open.columns.length, open.rows),
      '8rem',
      ...(marked ? [MARK_COLUMN] : []),
    ].join(' ')
    pane = (
      <Card data-testid="queue-pane" data-key={open.itemId} data-count={open.rows.length}>
        <PaneHead
          back={beside ? null : { label: format(m.reviewFilterAllItems), onBack }}
          title={open.itemTitle}
          facts={
            <Facts
              items={[
                format(m.reviewGroupCount, { count: open.rows.length }),
                format(m.reviewOldest, { when: since(open.rows[0]!.submittedAt) }),
              ]}
            />
          }
          action={
            <Button
              size="sm"
              variant="outline"
              className={stylex.props(styles.paneAction).className}
              onClick={() => onOpen(open.rows[0]!, run)}
            >
              {format(m.reviewStartItem)}
            </Button>
          }
        />
        <Table columns={columns} openable>
          <TableHead>
            <span>{format(m.reviewColumnParticipant)}</span>
            {open.columns.map((label, index) => (
              <span key={index}>{label}</span>
            ))}
            <span>{format(m.reviewColumnWhen)}</span>
            {marked && <span />}
          </TableHead>
          {list.rows.map((row) => (
            <TableRow
              key={row.instanceId}
              onOpen={() => onOpen(row, run)}
              data-testid="inbox-row"
              data-instance={row.instanceId}
            >
              <Cell lead>
                <Who row={row} />
              </Cell>
              {/* stacked under a name, the answers are one line of what
                  was filed: a column's word before each of them, and a rule
                  between, made three short lines of labels out of two
                  answers */}
              {phone ? (
                <Cell tone="plain" unlabelled>
                  {answersOf(row, (count) => format(m.reviewFilesCount, { count }))}
                </Cell>
              ) : (
                open.columns.map((_, index) => {
                  const pair = row.values[index]
                  return (
                    <Cell key={index} tone="plain">
                      {pair === undefined ? null : <FiledValue pair={pair} />}
                    </Cell>
                  )
                })
              )}
              <Cell narrow="end" numeric unlabelled>
                {clock(row.submittedAt)}
              </Cell>
              {marked && (
                <Cell unlabelled>{markOf(row) === null ? null : <RoundMark row={row} />}</Cell>
              )}
            </TableRow>
          ))}
        </Table>
        <PagerFoot list={list} size={PANE_PAGE} onPage={onPage} />
      </Card>
    )
  }

  return <Split chosen={named?.itemId ?? null} master={master} pane={pane} />
}

/** the queue by person: who has work waiting, and one person's filings */
export function PersonQueue({
  rows,
  chosen,
  page,
  onChoose,
  onBack,
  onPage,
  onOpen,
}: {
  rows: readonly InboxItemDto[]
  /** the person named in the address, by the key a run names them by */
  chosen: string
  page: number
  onChoose: (key: string) => void
  onBack: () => void
  onPage: (page: number) => void
  onOpen: OpenRow
}) {
  const { format } = useI18n()
  const beside = useBeside()
  const clock = useQueueClock()
  const people = groupByPerson(rows)
  const named = pickedOf(people, (person) => person.key, chosen)
  const open = named ?? (beside ? people[0] : undefined)

  const master = (
    <MasterCard
      title={format(m.reviewColumnParticipant)}
      count={people.length}
      selected={open?.key ?? null}
    >
      {people.map((person) => (
        <MasterRow
          key={person.key}
          id={person.key}
          name={person.name}
          note={person.businessNo}
          meta={person.unitName}
          count={person.rows.length}
          face={<Face name={person.name} />}
          selected={beside && open?.key === person.key}
          drills={!beside}
          onChoose={() => onChoose(person.key)}
        />
      ))}
    </MasterCard>
  )

  let pane: ReactNode = null
  if (open !== undefined) {
    const list = pageOf(open.rows, page, PANE_PAGE)
    const run = writeRunScope({ kind: 'person', businessNo: open.key })
    const marked = list.rows.some((row) => markOf(row) !== null)
    const columns = [
      'minmax(10rem, 16rem)',
      'minmax(0, 1fr)',
      '5rem',
      '8rem',
      ...(marked ? [MARK_COLUMN] : []),
    ].join(' ')
    pane = (
      <Card data-testid="queue-pane" data-key={open.key} data-count={open.rows.length}>
        <PaneHead
          back={beside ? null : { label: format(m.reviewAllPeople), onBack }}
          face={<Face name={open.name} />}
          title={open.name}
          facts={
            <Facts
              items={[
                open.businessNo,
                open.unitName,
                format(m.reviewGroupCount, { count: open.rows.length }),
              ]}
            />
          }
          action={
            <Button
              size="sm"
              variant="outline"
              className={stylex.props(styles.paneAction).className}
              onClick={() => onOpen(open.rows[0]!, run)}
            >
              {format(m.reviewStartPerson)}
            </Button>
          }
        />
        <Table columns={columns} openable>
          <TableHead>
            <span>{format(m.reviewColumnItem)}</span>
            <span>{format(m.reviewColumnSummary)}</span>
            <span>{format(m.reviewColumnFiles)}</span>
            <span>{format(m.reviewColumnWhen)}</span>
            {marked && <span />}
          </TableHead>
          {list.rows.map((row) => (
            <TableRow
              key={row.instanceId}
              onOpen={() => onOpen(row, run)}
              data-testid="inbox-row"
              data-instance={row.instanceId}
            >
              <Cell lead>
                <LeadWord>{row.itemTitle}</LeadWord>
              </Cell>
              <Cell tone="plain" unlabelled>
                {rowSummary(row)}
              </Cell>
              {/* how many files is a desk's column; stacked it was a
                  labelled fact dangling under the answers */}
              <Cell narrow="drop">
                {format(m.reviewFilesCount, { count: row.attachmentCount })}
              </Cell>
              <Cell narrow="end" numeric unlabelled>
                {clock(row.submittedAt)}
              </Cell>
              {marked && (
                <Cell unlabelled>{markOf(row) === null ? null : <RoundMark row={row} />}</Cell>
              )}
            </TableRow>
          ))}
        </Table>
        <PagerFoot list={list} size={PANE_PAGE} onPage={onPage} />
      </Card>
    )
  }

  return <Split chosen={named?.key ?? null} master={master} pane={pane} />
}

/** the whole queue in the order it arrived, oldest first, a page at a time */
export function TimeQueue({
  rows,
  page,
  onPage,
  onOpen,
}: {
  rows: readonly InboxItemDto[]
  page: number
  onPage: (page: number) => void
  onOpen: OpenRow
}) {
  const { format } = useI18n()
  const clock = useQueueClock()
  const list = pageOf(rows, page, TIME_PAGE)
  const marked = list.rows.some((row) => markOf(row) !== null)
  const columns = [
    'minmax(8rem, 11rem)',
    'minmax(8rem, 14rem)',
    'minmax(0, 1fr)',
    '8rem',
    ...(marked ? [MARK_COLUMN] : []),
  ].join(' ')
  return (
    <Card data-testid="queue-pane" data-key="" data-count={rows.length}>
      <Table columns={columns} openable>
        <TableHead>
          <span>{format(m.reviewColumnParticipant)}</span>
          <span>{format(m.reviewColumnItem)}</span>
          <span>{format(m.reviewColumnSummary)}</span>
          <span>{format(m.reviewColumnWhen)}</span>
          {marked && <span />}
        </TableHead>
        {list.rows.map((row) => (
          <TableRow
            key={row.instanceId}
            // the whole queue is the run: pressing any row walks on from it
            onOpen={() => onOpen(row, '')}
            data-testid="inbox-row"
            data-instance={row.instanceId}
          >
            <Cell lead>
              <Who row={row} />
            </Cell>
            <Cell tone="plain" unlabelled>
              {row.itemTitle}
            </Cell>
            {/* stacked, the question is what the row is scanned by; its
                answers are the workbench's to show */}
            <Cell narrow="drop" unlabelled>
              {rowSummary(row)}
            </Cell>
            <Cell narrow="end" numeric unlabelled>
              {clock(row.submittedAt)}
            </Cell>
            {marked && (
              <Cell unlabelled>{markOf(row) === null ? null : <RoundMark row={row} />}</Cell>
            )}
          </TableRow>
        ))}
      </Table>
      <PagerFoot list={list} size={TIME_PAGE} onPage={onPage} />
    </Card>
  )
}

/**
 * The queue's own shape while it is read: at a desk the list beside the open
 * question's filings, narrower the list alone - the screens that land a
 * moment later, greyed.
 */
export function QueueSkeleton() {
  const beside = useBeside()
  const masterBones = (
    <Card xstyle={styles.master}>
      <div {...stylex.props(styles.skHead)}>
        <Skeleton className={stylex.props(styles.skFacts).className} />
      </div>
      {['72%', '54%', '64%', '48%'].map((width, index) => (
        <div key={index} {...stylex.props(styles.skMasterRow)}>
          <Skeleton className={stylex.props(styles.skName).className} style={{ width }} />
          <Skeleton className={stylex.props(styles.skMeta).className} />
        </div>
      ))}
    </Card>
  )
  if (!beside) return <div aria-hidden>{masterBones}</div>
  return (
    <div aria-hidden {...stylex.props(styles.split)}>
      <div {...stylex.props(styles.masterSeat)}>{masterBones}</div>
      <Card>
        <div {...stylex.props(styles.skHead)}>
          <Skeleton className={stylex.props(styles.skTitle).className} />
          <Skeleton className={stylex.props(styles.skFacts).className} />
        </div>
        <TableSkeleton rows={6} />
      </Card>
    </div>
  )
}
