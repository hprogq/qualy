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
  Status,
  Table,
  TableHead,
  TableRow,
  TableSkeleton,
} from '@qualy/ui/screen'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { assessmentMessages as m } from '../i18n.ts'
import { scrollMotion, useBeside, useMedia, useWidthOf } from './pointer.ts'
import {
  BESIDE_MIN,
  SPREAD_MOST,
  WHEN_WIDTH,
  WHO_MIN,
  answerFloorOf,
  answerWidthOf,
  answersFitIn,
  masterWidthOf,
  paneWidthOf,
} from './queue-layout.ts'
import {
  groupByItem,
  groupByPerson,
  pageOf,
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
// the right, ten to a page. Where the queue's own room is too narrow for
// both, the two are one screen after the other - the list first, the picked
// one's filings a step in - the way "my entries" goes from its structure
// into a question. By time the queue is one table, oldest first.
//
// A list of one is no list: a queue with one question (or one person) in it
// is that question's filings, full width, with nothing to pick. And a queue
// of a few filings is laid out whole, every answer under its own label.
//
// Pages are cut from the whole queue, which is read in full (queue.ts): the
// counts, the search and the run a reviewer walks are all about the whole
// of it, and a run started from a page still walks the whole question.

/** filings to a page where one question or one person is open */
const PANE_PAGE = 10
/** filings to a page of the whole queue by time */
const TIME_PAGE = 20
/** narrower than this the pager says where it stands in figures alone */
const PAGER_ROOM = 640
/** the page's own margin under the list, which the list stops short of */
const PAGE_FOOT = 24

const styles = stylex.create({
  room: { display: 'flex', minWidth: 0, flexDirection: 'column' },
  // the gap is SPLIT_GAP, which the width of the filings is reckoned with
  split: (template: string) => ({
    display: 'grid',
    alignItems: 'start',
    gap: 16,
    gridTemplateColumns: template,
  }),
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
  // a person's name and number share the line while both fit, and the
  // number takes the next line before the name loses a character
  masterNameLine: {
    display: 'flex',
    minWidth: 0,
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: 8,
  },
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
  // ---- who filed it, in a row ----
  who: {
    display: 'flex',
    minWidth: 0,
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: 8,
    rowGap: 1,
  },
  // the row's name: whole wherever the cell has room for it, the number
  // beside it moving to the next line first; the whole of it on hover when
  // even the cell alone is too narrow
  whoName: {
    minWidth: 0,
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 13.5,
    fontWeight: 500,
    color: tokens.foreground,
  },
  businessNo: {
    flexShrink: 0,
    fontSize: 12,
    fontWeight: 400,
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
  quietFiled: { color: tokens.mutedForeground },
  when: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    alignItems: { default: 'flex-start', [breakpoints.phone]: 'flex-end' },
    gap: 2,
  },
  unbroken: { whiteSpace: 'nowrap' },
  // a question's answers as one or two lines, where they share a column
  summaryLines: {
    display: '-webkit-box',
    overflow: 'hidden',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 2,
    whiteSpace: 'normal',
    overflowWrap: 'anywhere',
    lineHeight: 1.45,
  },
  // ---- a few filings, laid out whole ----
  spread: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 16 },
  spreadList: { margin: 0, padding: 0, listStyleType: 'none' },
  spreadItem: {
    borderBottomWidth: { default: 1, ':last-child': 0 },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  spreadRow: {
    display: 'flex',
    width: '100%',
    minWidth: 0,
    flexDirection: 'column',
    gap: 12,
    borderWidth: 0,
    paddingInline: 16,
    paddingTop: 14,
    paddingBottom: 16,
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
  spreadTop: {
    display: 'flex',
    width: '100%',
    minWidth: 0,
    alignItems: 'flex-start',
    gap: 12,
  },
  spreadLead: {
    display: 'flex',
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
    gap: 3,
  },
  spreadTitle: {
    overflowWrap: 'anywhere',
    fontSize: 14,
    lineHeight: 1.45,
    fontWeight: 600,
    color: tokens.foreground,
  },
  spreadNote: {
    minWidth: 0,
    overflowWrap: 'anywhere',
    fontSize: 12,
    lineHeight: 1.45,
    color: tokens.mutedForeground,
  },
  spreadSide: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 10,
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
  spreadChevron: { width: 14, height: 14, flexShrink: 0 },
  // every answer under its own label, as many to a line as the card has
  // room for; the filings of one question line their answers up. A phone
  // has room for one answer a line, so there the label stands beside it
  // rather than over it, and a filing is as many lines as it has answers
  answers: {
    display: 'grid',
    width: '100%',
    gridTemplateColumns: {
      default: 'repeat(auto-fill, minmax(min(100%, 12rem), 1fr))',
      [breakpoints.phone]: 'fit-content(7.5em) minmax(0, 1fr)',
    },
    alignItems: { default: null, [breakpoints.phone]: 'baseline' },
    columnGap: { default: 24, [breakpoints.phone]: 12 },
    rowGap: { default: 10, [breakpoints.phone]: 6 },
  },
  answer: {
    display: { default: 'flex', [breakpoints.phone]: 'contents' },
    minWidth: 0,
    flexDirection: 'column',
    gap: 2,
  },
  answerLabel: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 11.5,
    lineHeight: 1.4,
    color: tokens.mutedForeground,
  },
  answerValue: {
    display: '-webkit-box',
    minWidth: 0,
    overflow: 'hidden',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 3,
    overflowWrap: 'anywhere',
    fontSize: { default: 13.5, [breakpoints.phone]: 13 },
    lineHeight: 1.5,
    color: tokens.foreground,
  },
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

/**
 * What picking a question or a person does. `drills` says whether picking
 * it was a step into a screen of its own, which the back key should step
 * back out of.
 */
type Choose = (key: string, drills: boolean) => void

/** how the queue was laid out, for the hooks a test reads it by */
type Layout = 'split' | 'drill' | 'single' | 'spread' | 'table'

/**
 * The room the queue has, measured, around whatever it is laid out as. Its
 * children are drawn once the room is known, which is before the first
 * paint.
 */
function QueueRoom({
  layout,
  seat,
  width,
  children,
}: {
  layout: Layout | null
  seat: (node: HTMLDivElement | null) => void
  width: number | null
  children: ReactNode
}) {
  return (
    <div
      ref={seat}
      data-testid="queue-layout"
      data-layout={layout ?? ''}
      {...stylex.props(styles.room)}
    >
      {width === null ? null : children}
    </div>
  )
}

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
  room,
  beside,
  chosen,
  master,
  pane,
}: {
  room: number
  beside: boolean
  /** the key of the one picked in the address, where it names one in the list */
  chosen: string | null
  master: ReactNode
  pane: ReactNode
}) {
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
      <div {...stylex.props(styles.split(`${String(masterWidthOf(room))}px minmax(0, 1fr)`))}>
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
            <span
              title={name}
              {...stylex.props(styles.masterName, selected && styles.masterNameOn)}
            >
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
        {action !== null && <span {...stylex.props(styles.paneAction)}>{action}</span>}
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
  compact,
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
  /** figures alone, for a strip with little room; the window decides where the caller does not */
  compact?: boolean
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
        compact={compact ?? !beside}
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

/**
 * When it arrived, and under it where its round stands where that is more
 * than waiting. A column of its own for the standing was a column empty on
 * nearly every row, and its width came out of the answers beside it.
 */
function When({ row }: { row: InboxItemDto }) {
  const clock = useQueueClock()
  return (
    <span {...stylex.props(styles.when)}>
      <span>{clock(row.submittedAt)}</span>
      <RoundMark row={row} />
    </span>
  )
}

/**
 * Who filed it, by name and number. The name is how the row is found, so
 * it is the part kept whole: where the cell cannot hold both on one line
 * the number goes under it, and a name longer than the cell itself gives
 * its whole self on hover.
 */
function Who({ row }: { row: InboxItemDto }) {
  return (
    <span {...stylex.props(styles.who)}>
      <span
        data-testid="inbox-row-name"
        title={row.participantName}
        {...stylex.props(styles.whoName)}
      >
        {row.participantName}
      </span>
      {row.businessNo !== null && (
        <span {...stylex.props(styles.businessNo)}>{row.businessNo}</span>
      )}
    </span>
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
 * columns; never less than the floor the room was checked against.
 */
const answerColumns = (count: number, rows: readonly InboxItemDto[]): string[] =>
  Array.from({ length: count }, (_, index) => {
    // what is left over is shared out by how long each field's answers run,
    // so the room goes to the competition's name before the date's column
    const weight = Math.min(400, Math.max(40, answerWidthOf(index, rows)))
    return `minmax(${String(answerFloorOf(index, rows))}px, ${String(weight)}fr)`
  })

/**
 * A row's answers as one run of words, a field of files said as how many
 * where `files` asks for it. Separated by an ideographic space rather than
 * a glyph, and a short answer - a date, a grade - is never broken across
 * the end of a line: "2025-" over "11-12" reads as two answers.
 */
function AnswerRun({ row, files }: { row: InboxItemDto; files: boolean }) {
  const { format } = useI18n()
  const said = row.values.flatMap((pair) =>
    pair.files === null
      ? pair.value === ''
        ? []
        : [pair.value]
      : files && pair.files > 0
        ? [format(m.reviewFilesCount, { count: pair.files })]
        : [],
  )
  return (
    <span data-testid="inbox-row-summary" {...stylex.props(styles.summaryLines)}>
      {said.map((value, index) => (
        <span key={index}>
          {index > 0 && '\u3000'}
          <span {...stylex.props([...value].length <= 12 && styles.unbroken)}>{value}</span>
        </span>
      ))}
    </span>
  )
}

/** a phone, where a table's row stacks its facts under its name */
const usePhone = () => useMedia('(max-width: 767.98px)', false)

/** the key the address names, where the list still has it */
const pickedOf = <Group,>(
  groups: readonly Group[],
  keyOf: (group: Group) => string,
  key: string,
) => (key === '' ? undefined : groups.find((group) => keyOf(group) === key))

/** the queue's room, and what it allows: the list beside the filings, and how wide they are */
function useQueueRoom() {
  const [seat, width] = useWidthOf<HTMLDivElement>()
  const room = width ?? 0
  const beside = width !== null && width >= BESIDE_MIN
  return { seat, width, room, beside }
}

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
  onChoose: Choose
  onBack: () => void
  onPage: (page: number) => void
  onOpen: OpenRow
}) {
  const { format } = useI18n()
  const { seat, width, room, beside } = useQueueRoom()
  const phone = usePhone()
  const since = useDayClock()
  const groups = groupByItem(rows)
  const spread = rows.length <= SPREAD_MOST
  const single = !spread && groups.length === 1
  const named = pickedOf(groups, (group) => group.itemId, chosen)
  // at a desk something is always open: the question that has waited
  // longest; and a question alone in the queue is open at any width
  const open = named ?? (beside || single ? groups[0] : undefined)
  const layout: Layout = spread ? 'spread' : single ? 'single' : beside ? 'split' : 'drill'
  const paneWidth = paneWidthOf(room, layout === 'split')

  if (spread) {
    return (
      <QueueRoom layout={layout} seat={seat} width={width}>
        <div {...stylex.props(styles.spread)}>
          {groups.map((group) => {
            const run = writeRunScope({ kind: 'item', itemId: group.itemId })
            return (
              <Card
                key={group.itemId}
                data-testid="queue-spread"
                data-key={group.itemId}
                data-count={group.rows.length}
              >
                <PaneHead
                  back={null}
                  title={group.itemTitle}
                  facts={
                    <Facts
                      items={[
                        format(m.reviewGroupCount, { count: group.rows.length }),
                        format(m.reviewOldest, { when: since(group.rows[0]!.submittedAt) }),
                      ]}
                    />
                  }
                  action={
                    // one filing is its own way in; the run over the
                    // question is worth a key only where it has several
                    group.rows.length > 1 ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className={stylex.props(styles.paneAction).className}
                        onClick={() => onOpen(group.rows[0]!, run)}
                      >
                        {format(m.reviewStartItem)}
                      </Button>
                    ) : null
                  }
                />
                <SpreadRows rows={group.rows} lead="who" onOpen={(row) => onOpen(row, run)} />
              </Card>
            )
          })}
        </div>
      </QueueRoom>
    )
  }

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
          onChoose={() => onChoose(group.itemId, !beside)}
        />
      ))}
    </MasterCard>
  )

  let pane: ReactNode = null
  if (open !== undefined) {
    const list = pageOf(open.rows, page, PANE_PAGE)
    const run = writeRunScope({ kind: 'item', itemId: open.itemId })
    // each answer its own column where the room allows it, and one column
    // of what was filed where it does not; a phone stacks the row anyway
    const summarize = phone || !answersFitIn(paneWidth, open.columns.length, open.rows)
    const columns = [
      `minmax(${String(WHO_MIN)}px, 11rem)`,
      ...(summarize ? ['minmax(0, 1fr)'] : answerColumns(open.columns.length, open.rows)),
      `${String(WHEN_WIDTH)}px`,
    ].join(' ')
    pane = (
      <Card
        data-testid="queue-pane"
        data-key={open.itemId}
        data-count={open.rows.length}
        data-answers={summarize ? 'summary' : 'columns'}
      >
        <PaneHead
          back={layout === 'drill' ? { label: format(m.reviewFilterAllItems), onBack } : null}
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
            {summarize ? (
              <span>{format(m.reviewColumnSummary)}</span>
            ) : (
              open.columns.map((label, index) => <span key={index}>{label}</span>)
            )}
            <span>{format(m.reviewColumnWhen)}</span>
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
              {/* stacked under a name, or sharing one column, the answers
                  are one run of what was filed: a column's word before each
                  of them, and a rule between, made three short lines of
                  labels out of two answers */}
              {summarize ? (
                <Cell tone="plain" unlabelled>
                  <AnswerRun row={row} files />
                </Cell>
              ) : (
                open.columns.map((_, index) => {
                  const pair = row.values[index]
                  return (
                    <Cell key={index} tone="plain">
                      {pair === undefined ? null : (
                        <span data-testid="inbox-row-answer">
                          <FiledValue pair={pair} />
                        </span>
                      )}
                    </Cell>
                  )
                })
              )}
              <Cell narrow="end" numeric unlabelled>
                <When row={row} />
              </Cell>
            </TableRow>
          ))}
        </Table>
        <PagerFoot
          list={list}
          size={PANE_PAGE}
          onPage={onPage}
          compact={phone || paneWidth < PAGER_ROOM}
        />
      </Card>
    )
  }

  return (
    <QueueRoom layout={layout} seat={seat} width={width}>
      {single ? (
        pane
      ) : (
        <Split
          room={room}
          beside={beside}
          chosen={named?.itemId ?? null}
          master={master}
          pane={pane}
        />
      )}
    </QueueRoom>
  )
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
  onChoose: Choose
  onBack: () => void
  onPage: (page: number) => void
  onOpen: OpenRow
}) {
  const { format } = useI18n()
  const { seat, width, room, beside } = useQueueRoom()
  const phone = usePhone()
  const people = groupByPerson(rows)
  const spread = rows.length <= SPREAD_MOST
  const single = !spread && people.length === 1
  const named = pickedOf(people, (person) => person.key, chosen)
  const open = named ?? (beside || single ? people[0] : undefined)
  const layout: Layout = spread ? 'spread' : single ? 'single' : beside ? 'split' : 'drill'
  const paneWidth = paneWidthOf(room, layout === 'split')

  if (spread) {
    return (
      <QueueRoom layout={layout} seat={seat} width={width}>
        <div {...stylex.props(styles.spread)}>
          {people.map((person) => {
            const run = writeRunScope({ kind: 'person', businessNo: person.key })
            return (
              <Card
                key={person.key}
                data-testid="queue-spread"
                data-key={person.key}
                data-count={person.rows.length}
              >
                <PaneHead
                  back={null}
                  face={<Face name={person.name} />}
                  title={person.name}
                  facts={
                    <Facts
                      items={[
                        person.businessNo,
                        person.unitName,
                        format(m.reviewGroupCount, { count: person.rows.length }),
                      ]}
                    />
                  }
                  action={
                    person.rows.length > 1 ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className={stylex.props(styles.paneAction).className}
                        onClick={() => onOpen(person.rows[0]!, run)}
                      >
                        {format(m.reviewStartPerson)}
                      </Button>
                    ) : null
                  }
                />
                <SpreadRows rows={person.rows} lead="item" onOpen={(row) => onOpen(row, run)} />
              </Card>
            )
          })}
        </div>
      </QueueRoom>
    )
  }

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
          onChoose={() => onChoose(person.key, !beside)}
        />
      ))}
    </MasterCard>
  )

  let pane: ReactNode = null
  if (open !== undefined) {
    const list = pageOf(open.rows, page, PANE_PAGE)
    const run = writeRunScope({ kind: 'person', businessNo: open.key })
    const columns = [
      'minmax(7rem, 12rem)',
      'minmax(0, 1fr)',
      '4.5rem',
      `${String(WHEN_WIDTH)}px`,
    ].join(' ')
    pane = (
      <Card data-testid="queue-pane" data-key={open.key} data-count={open.rows.length}>
        <PaneHead
          back={layout === 'drill' ? { label: format(m.reviewAllPeople), onBack } : null}
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
          </TableHead>
          {list.rows.map((row) => (
            <TableRow
              key={row.instanceId}
              onOpen={() => onOpen(row, run)}
              data-testid="inbox-row"
              data-instance={row.instanceId}
            >
              <Cell lead title={row.itemTitle}>
                <span {...stylex.props(styles.whoName)}>{row.itemTitle}</span>
              </Cell>
              <Cell tone="plain" unlabelled>
                <AnswerRun row={row} files={false} />
              </Cell>
              {/* how many files is a desk's column; stacked it was a
                  labelled fact dangling under the answers */}
              <Cell narrow="drop">
                {format(m.reviewFilesCount, { count: row.attachmentCount })}
              </Cell>
              <Cell narrow="end" numeric unlabelled>
                <When row={row} />
              </Cell>
            </TableRow>
          ))}
        </Table>
        <PagerFoot
          list={list}
          size={PANE_PAGE}
          onPage={onPage}
          compact={phone || paneWidth < PAGER_ROOM}
        />
      </Card>
    )
  }

  return (
    <QueueRoom layout={layout} seat={seat} width={width}>
      {single ? (
        pane
      ) : (
        <Split
          room={room}
          beside={beside}
          chosen={named?.key ?? null}
          master={master}
          pane={pane}
        />
      )}
    </QueueRoom>
  )
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
  const { seat, width, room } = useQueueRoom()
  const phone = usePhone()
  const spread = rows.length <= SPREAD_MOST
  const list = pageOf(rows, page, TIME_PAGE)
  const columns = [
    `minmax(${String(WHO_MIN)}px, 11rem)`,
    'minmax(7rem, 14rem)',
    'minmax(0, 1fr)',
    `${String(WHEN_WIDTH)}px`,
  ].join(' ')
  return (
    <QueueRoom layout={spread ? 'spread' : 'table'} seat={seat} width={width}>
      {spread ? (
        <Card data-testid="queue-spread" data-key="" data-count={rows.length}>
          {/* the whole queue is the run: pressing any of them walks on from it */}
          <SpreadRows rows={rows} lead="both" onOpen={(row) => onOpen(row, '')} />
        </Card>
      ) : (
        <Card data-testid="queue-pane" data-key="" data-count={rows.length}>
          <Table columns={columns} openable>
            <TableHead>
              <span>{format(m.reviewColumnParticipant)}</span>
              <span>{format(m.reviewColumnItem)}</span>
              <span>{format(m.reviewColumnSummary)}</span>
              <span>{format(m.reviewColumnWhen)}</span>
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
                <Cell tone="plain" unlabelled title={row.itemTitle}>
                  {row.itemTitle}
                </Cell>
                {/* stacked, the question is what the row is scanned by; its
                    answers are the workbench's to show */}
                <Cell narrow="drop" unlabelled>
                  <AnswerRun row={row} files={false} />
                </Cell>
                <Cell narrow="end" numeric unlabelled>
                  <When row={row} />
                </Cell>
              </TableRow>
            ))}
          </Table>
          <PagerFoot
            list={list}
            size={TIME_PAGE}
            onPage={onPage}
            compact={phone || room < PAGER_ROOM}
          />
        </Card>
      )}
    </QueueRoom>
  )
}

/**
 * A few filings, each laid out whole: who (or which question), when, where
 * the round stands, and every answer under its own label. The whole block
 * opens the filing, as a row of the table would.
 */
function SpreadRows({
  rows,
  lead,
  onOpen,
}: {
  rows: readonly InboxItemDto[]
  /** what names each filing: who filed it, the question it is on, or both */
  lead: 'who' | 'item' | 'both'
  onOpen: (row: InboxItemDto) => void
}) {
  const { format } = useI18n()
  const clock = useQueueClock()
  return (
    <ul {...stylex.props(styles.spreadList)}>
      {rows.map((row) => {
        const answers = row.values.filter((pair) => pair.files !== null || pair.value !== '')
        return (
          <li key={row.instanceId} {...stylex.props(styles.spreadItem)}>
            <button
              type="button"
              data-testid="inbox-row"
              data-instance={row.instanceId}
              data-answers={answers.length}
              onClick={() => onOpen(row)}
              {...stylex.props(styles.spreadRow)}
            >
              <span {...stylex.props(styles.spreadTop)}>
                <span {...stylex.props(styles.spreadLead)}>
                  {lead === 'item' ? (
                    <span {...stylex.props(styles.spreadTitle)}>{row.itemTitle}</span>
                  ) : (
                    <>
                      <Who row={row} />
                      {lead === 'both' ? (
                        <span {...stylex.props(styles.spreadNote)}>{row.itemTitle}</span>
                      ) : (
                        row.unitName !== null && (
                          <span {...stylex.props(styles.spreadNote)}>{row.unitName}</span>
                        )
                      )}
                    </>
                  )}
                </span>
                <span {...stylex.props(styles.spreadSide)}>
                  <RoundMark row={row} />
                  <span>{clock(row.submittedAt)}</span>
                  <ChevronRightIcon
                    aria-hidden
                    className={stylex.props(styles.spreadChevron).className}
                  />
                </span>
              </span>
              {answers.length > 0 && (
                <span data-testid="inbox-row-answers" {...stylex.props(styles.answers)}>
                  {answers.map((pair, index) => (
                    <span key={index} {...stylex.props(styles.answer)}>
                      <span {...stylex.props(styles.answerLabel)}>{pair.label}</span>
                      <span
                        {...stylex.props(styles.answerValue, pair.files === 0 && styles.quietFiled)}
                      >
                        {pair.files === null
                          ? pair.value
                          : format(m.reviewFilesCount, { count: pair.files })}
                      </span>
                    </span>
                  ))}
                </span>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * The queue's own shape while it is read: where the room allows it the list
 * beside the open question's filings, narrower the list alone - the screens
 * that land a moment later, greyed.
 */
export function QueueSkeleton() {
  const { seat, width, room, beside } = useQueueRoom()
  const masterBones = (
    <Card xstyle={styles.master}>
      <div {...stylex.props(styles.skHead)}>
        <Skeleton className={stylex.props(styles.skFacts).className} />
      </div>
      {['72%', '54%', '64%', '48%'].map((wide, index) => (
        <div key={index} {...stylex.props(styles.skMasterRow)}>
          <Skeleton className={stylex.props(styles.skName).className} style={{ width: wide }} />
          <Skeleton className={stylex.props(styles.skMeta).className} />
        </div>
      ))}
    </Card>
  )
  return (
    <div aria-hidden>
      <QueueRoom layout={null} seat={seat} width={width}>
        {beside ? (
          <div {...stylex.props(styles.split(`${String(masterWidthOf(room))}px minmax(0, 1fr)`))}>
            <div {...stylex.props(styles.masterSeat)}>{masterBones}</div>
            <Card>
              <div {...stylex.props(styles.skHead)}>
                <Skeleton className={stylex.props(styles.skTitle).className} />
                <Skeleton className={stylex.props(styles.skFacts).className} />
              </div>
              <TableSkeleton rows={6} />
            </Card>
          </div>
        ) : (
          masterBones
        )}
      </QueueRoom>
    </div>
  )
}
