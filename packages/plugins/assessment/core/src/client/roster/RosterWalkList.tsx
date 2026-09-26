import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { SearchIcon } from 'lucide-react'
import { useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { useTerm } from '@qualy/plugin-settings/client/terms'
import { authTerms } from '@qualy/auth-contract/terms'
import { Button } from '@qualy/ui/button'
import { Count } from '@qualy/ui/count'
import { Input } from '@qualy/ui/input'
import { Skeleton } from '@qualy/ui/skeleton'
import { Spinner } from '@qualy/ui/spinner'
import { VisuallyHidden } from '@qualy/ui/visually-hidden'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { ORDER, WORDS, waitsOnAnything } from './filings.ts'
import {
  ROSTER_UNFILTERED,
  rosterFiltered,
  useRosterSearch,
  type RosterView,
} from './roster-view.ts'
import type { RosterWalk, WalkRow } from './roster-walk.ts'

// The roster beside an open account: the people either side of whoever is
// open, with them in the middle, and a search that narrows the same list
// the list page shows - one question, asked from either side of the page.
//
// It follows the open person: stepping to the next one scrolls them to the
// middle, as near as the ends of the list allow. A reader who scrolls it
// themselves is left where they scrolled, pages arriving above them and all,
// until they open somebody.

const styles = stylex.create({
  root: { display: 'flex', minHeight: 0, flexDirection: 'column', gap: 8 },
  // In the column it takes whatever the facts above leave, and never less
  // than a handful of rows: a short window scrolls the whole column instead.
  column: {
    flexGrow: 1,
    flexShrink: 0,
    flexBasis: 0,
    minHeight: 240,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
  },
  sheet: { flexGrow: 1, flexShrink: 1, flexBasis: '0%' },
  head: { display: 'flex', alignItems: 'center', gap: 6, paddingInline: 2 },
  heading: {
    margin: 0,
    fontSize: 12,
    lineHeight: '1rem',
    fontWeight: 500,
    color: tokens.mutedForeground,
  },
  count: { color: tokens.mutedForeground },
  glass: { width: 14, height: 14 },
  note: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingInline: 2,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  scroller: {
    position: 'relative',
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    overflowY: 'auto',
    // pages arriving above are held in place here, not by the browser: two
    // hands on one scroll position fight
    overflowAnchor: 'none',
    overscrollBehavior: 'contain',
    // room for a row's focus ring inside the edges it scrolls between
    marginInline: -4,
    paddingInline: 4,
    paddingBlock: 2,
    // a row cut by either edge fades there, rather than stopping against
    // the search box in a hard line
    maskImage:
      'linear-gradient(to bottom, transparent 0, #000 8px, #000 calc(100% - 8px), transparent 100%)',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
    margin: 0,
    padding: 0,
    listStyleType: 'none',
  },
  row: {
    position: 'relative',
    display: 'flex',
    width: '100%',
    height: 34,
    alignItems: 'center',
    gap: 8,
    borderWidth: 0,
    borderRadius: tokens.radiusMd,
    paddingInline: 8,
    backgroundColor: 'transparent',
    fontFamily: 'inherit',
    fontSize: 14,
    textAlign: 'start',
    color: tokens.foreground,
    cursor: 'pointer',
    outline: 'none',
    boxShadow: { default: 'none', ':focus-visible': `inset 0 0 0 2px ${tokens.focusRing}` },
    transitionProperty: 'background-color',
    transitionDuration: '150ms',
  },
  // a row somebody could open answers the pointer, lighter than the open one
  rowOther: {
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 45%, transparent)`,
    },
  },
  // The open person, told apart by more than a shade: the ground a hovered
  // row only borrows, their name in weight, and a bar at the row's edge,
  // which holds in either scheme and in a sheet as well as the column.
  rowOn: {
    fontWeight: 600,
    backgroundColor: tokens.surfaceMuted,
    cursor: 'default',
    '::before': {
      content: '""',
      position: 'absolute',
      insetInlineStart: 0,
      top: 7,
      bottom: 7,
      width: 2,
      borderRadius: 2,
      backgroundColor: tokens.foreground,
    },
  },
  // a mark before the name where something of theirs waits on somebody,
  // in the warning colour where nobody can take it; its place is kept on
  // every row so the names stand in one line
  dot: { width: 6, height: 6, flexShrink: 0, borderRadius: 9999 },
  dotSome: { backgroundColor: `color-mix(in oklab, ${tokens.mutedForeground} 70%, transparent)` },
  dotBlocked: { backgroundColor: tokens.warning },
  name: {
    minWidth: 0,
    flexShrink: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  nameOff: { color: tokens.mutedForeground },
  tag: {
    flexShrink: 0,
    borderRadius: 4,
    paddingInline: 5,
    fontSize: 11,
    lineHeight: '1.125rem',
    fontWeight: 500,
    backgroundColor: tokens.surfaceMuted,
    color: tokens.surfaceMutedForeground,
  },
  number: {
    flexShrink: 0,
    marginInlineStart: 'auto',
    paddingInlineStart: 6,
    fontSize: 12,
    fontWeight: 400,
    fontVariantNumeric: 'tabular-nums',
    color: tokens.mutedForeground,
  },
  // the open person, when the list does not hold them: said over it, so the
  // reader does not lose whom they are reading
  off: {
    display: 'flex',
    minWidth: 0,
    height: 34,
    flexShrink: 0,
    alignItems: 'center',
    gap: 8,
    borderRadius: tokens.radiusMd,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: tokens.border,
    paddingInline: 8,
    fontSize: 14,
    fontWeight: 600,
  },
  offNote: {
    flexShrink: 0,
    marginInlineStart: 'auto',
    fontSize: 12,
    fontWeight: 400,
    color: tokens.mutedForeground,
  },
  // a row still to come, its name where a row's name stands: past the mark's place
  bone: {
    display: 'flex',
    height: 34,
    alignItems: 'center',
    gap: 8,
    paddingInlineStart: 22,
    paddingInlineEnd: 8,
  },
  boneName: { height: 12, borderRadius: 4 },
  boneNumber: { height: 10, width: 64, marginInlineStart: 'auto', borderRadius: 4 },
  blank: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 10,
    paddingBlock: 24,
    paddingInline: 8,
    fontSize: 13,
    textAlign: 'center',
    color: tokens.mutedForeground,
  },
  blankWords: { margin: 0 },
  blankKeys: { display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  dim: { opacity: 0.55, transitionProperty: 'opacity', transitionDuration: '150ms' },
})

/** how wide each stand-in name is, so the outline reads as names rather than a grid */
const BONES = ['62%', '48%', '70%', '55%', '66%', '44%']

export function RosterWalkList({
  batchId,
  participantId,
  walk,
  view,
  onView,
  onOpen,
  seat,
}: {
  batchId: string
  participantId: string
  walk: RosterWalk
  view: RosterView
  onView: (changes: Partial<RosterView>) => void
  /** open this person, and put the list on the page they stand on */
  onOpen: (participantId: string, page: number) => void
  /** in the column beside the account, or in a sheet over it */
  seat: 'column' | 'sheet'
}) {
  const { format, formatError } = useI18n()
  const query = useApiQuery(assessmentApi)
  const businessNo = useTerm(authTerms.businessNumber)
  const headingId = useId()
  const search = useRosterSearch(view.q, onView)
  const filtered = rosterFiltered(view)
  const scroller = useRef<HTMLElement | null>(null)
  const field = useRef<HTMLInputElement>(null)
  const [box, setBox] = useState<HTMLElement | null>(null)
  const seatList = useCallback((node: HTMLElement | null) => {
    scroller.current = node
    setBox(node)
  }, [])

  // who is open, for the line that says they are not on this list; the
  // account beside it has read them already
  const who = useQuery({
    ...query.assessment.getParticipant.queryOptions({ params: { batchId, participantId } }),
    enabled: walk.off,
  })

  // ---- following the open person ----
  const following = useRef(true)
  const centred = useRef<string | null>(null)
  const held = useRef<{ id: string; offset: number } | null>(null)
  const place = `${walk.question}|${participantId}`
  const shape = `${walk.rows[0]?.id ?? ''}|${String(walk.rows.length)}`
  /** the row at the top of what shows, and how far down it stands */
  const remember = () => {
    const list = scroller.current
    if (list === null) return
    const top = list.getBoundingClientRect().top
    for (const row of list.querySelectorAll<HTMLElement>('[data-participant]')) {
      const at = row.getBoundingClientRect()
      if (at.bottom <= top) continue
      held.current = { id: row.dataset['participant']!, offset: at.top - top }
      return
    }
  }
  // the reader took the list in hand: it stays where they put it
  const letGo = () => {
    following.current = false
  }
  /**
   * The open person to the middle, where the list follows them; otherwise
   * the row the reader left at the top stays there. A step to somebody new
   * travels, where motion is welcome and the way is short; anything else -
   * the first time, a page arriving, the list growing or shrinking as the
   * facts over it settle - is put right at once.
   */
  const settle = useCallback(
    (travel: boolean) => {
      const list = scroller.current
      if (list === null || list.clientHeight === 0) return
      const row = list.querySelector<HTMLElement>(`[data-participant="${participantId}"]`)
      if (row !== null && (centred.current !== place || following.current)) {
        const moved = centred.current !== null && centred.current !== place
        centred.current = place
        following.current = true
        const room = list.scrollHeight - list.clientHeight
        const target = Math.max(
          0,
          Math.min(room, row.offsetTop - (list.clientHeight - row.offsetHeight) / 2),
        )
        if (Math.abs(target - list.scrollTop) <= 1) return
        const smooth =
          travel &&
          moved &&
          Math.abs(target - list.scrollTop) <= list.clientHeight * 2 &&
          !window.matchMedia('(prefers-reduced-motion: reduce)').matches
        list.scrollTo({ top: target, behavior: smooth ? 'smooth' : 'instant' })
        return
      }
      const kept = held.current
      if (kept === null) return
      const again = list.querySelector<HTMLElement>(`[data-participant="${kept.id}"]`)
      if (again === null) return
      const drift =
        again.getBoundingClientRect().top - list.getBoundingClientRect().top - kept.offset
      if (Math.abs(drift) > 0.5) list.scrollTop += drift
    },
    [participantId, place],
  )
  useLayoutEffect(() => settle(true), [settle, shape])
  useEffect(() => {
    if (box === null) return
    const watch = new ResizeObserver(() => settle(false))
    watch.observe(box)
    return () => watch.disconnect()
  }, [box, settle])

  // ---- keys ----
  const [focused, setFocused] = useState<string | null>(null)
  const ids = walk.rows.map((row) => row.id)
  // one stop on the tab order for the whole list: the row last stood on,
  // or the open person, or the first
  const stop =
    focused !== null && ids.includes(focused)
      ? focused
      : ids.includes(participantId)
        ? participantId
        : (ids[0] ?? null)
  const rowButtons = () => [
    ...(scroller.current?.querySelectorAll<HTMLButtonElement>('[data-testid="roster-walk-row"]') ??
      []),
  ]
  const reveal = (row: HTMLElement) => {
    const list = scroller.current
    if (list === null) return
    row.focus({ preventScroll: true })
    if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop
    else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight
    }
  }
  const onRowKey = (event: ReactKeyboardEvent<HTMLElement>) => {
    const rows = rowButtons()
    const at = rows.indexOf(document.activeElement as HTMLButtonElement)
    if (at < 0) return
    letGo()
    const to =
      event.key === 'ArrowDown'
        ? at + 1
        : event.key === 'ArrowUp'
          ? at - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? rows.length - 1
              : null
    if (to === null) return
    event.preventDefault()
    if (to < 0) field.current?.focus()
    else if (to < rows.length) reveal(rows[to]!)
  }

  // Enter in the search opens the first person it finds, once the list
  // answers the words typed; somebody already open who is found stays open.
  // It answers the one press, for the words it was pressed on: words typed
  // after it, the box left, or a list that cannot answer, and it is dropped
  // rather than left waiting to open somebody nobody asked for.
  const [opening, setOpening] = useState<string | null>(null)
  const asking = useRef(walk.question)
  asking.current = walk.question
  useEffect(() => {
    if (opening === null) return
    if (search.draft.trim() !== opening) {
      setOpening(null)
      return
    }
    if (view.q.trim() !== opening || walk.stale) return
    if (walk.state === 'failed') {
      setOpening(null)
      return
    }
    if (walk.state !== 'ready' || !walk.placed) return
    setOpening(null)
    // found, nobody to open, or nobody could say whether they were found
    if (walk.here !== null || !walk.off || walk.total === 0) return
    const question = walk.question
    void walk.first().then(
      (first) => {
        if (first !== null && asking.current === question) onOpen(first.id, first.page)
      },
      () => {},
    )
  }, [opening, walk, search.draft, view.q, onOpen])

  const onFieldKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      search.flush()
      setOpening(search.draft.trim())
    } else if (event.key === 'ArrowDown') {
      const rows = rowButtons()
      const target = rows.find((row) => row.dataset['participant'] === stop) ?? rows[0]
      if (target === undefined) return
      event.preventDefault()
      letGo()
      reveal(target)
    } else if (event.key === 'Escape' && search.draft !== '') {
      // the words go before the sheet does
      event.preventDefault()
      event.stopPropagation()
      search.flush('')
    }
  }

  const heading = format(m.rosterWalkHeading)
  const empty = walk.state === 'ready' && !walk.stale && walk.total === 0
  const firstRow = walk.rows[0]
  const lastRow = walk.rows.at(-1)

  return (
    <div
      data-testid="roster-walk"
      data-seat={seat}
      data-state={walk.state === 'ready' ? (empty ? 'empty' : 'ready') : walk.state}
      data-total={walk.total ?? ''}
      {...stylex.props(styles.root, seat === 'column' ? styles.column : styles.sheet)}
    >
      {seat === 'column' && (
        <div {...stylex.props(styles.head)}>
          <h2 id={headingId} {...stylex.props(styles.heading)}>
            {heading}
          </h2>
          {/* the last count stays up, faded, while new words are answered,
              rather than blinking out under every keystroke */}
          {walk.lastTotal !== null && (
            <Count xstyle={[styles.count, walk.stale && styles.dim]}>
              {String(walk.lastTotal)}
            </Count>
          )}
        </div>
      )}
      <Input
        ref={field}
        type="search"
        name="roster-walk-search"
        value={search.draft}
        // the column is narrow: what to type, with the full words for a reader
        placeholder={format(m.rosterWalkSearch, { businessNo })}
        aria-label={format(m.rosterSearch, { businessNo })}
        // it looks for somebody else, so nothing of the reader's own belongs in it
        autoComplete="off"
        data-1p-ignore=""
        data-lpignore="true"
        data-form-type="other"
        onChange={(event) => search.setDraft(event.target.value)}
        onKeyDown={onFieldKey}
        onBlur={() => setOpening(null)}
        lead={<SearchIcon aria-hidden {...stylex.props(styles.glass)} />}
        tail={walk.stale ? <Spinner aria-label={format(commonMessages.loading)} /> : undefined}
      />
      {filtered && (
        <p data-testid="roster-walk-filtered" {...stylex.props(styles.note)}>
          <span>{format(m.rosterWalkFiltered)}</span>
          <Button variant="link" size="xs" onClick={() => onView(ROSTER_UNFILTERED)}>
            {format(m.rosterWalkClearFilters)}
          </Button>
        </p>
      )}
      {/* nobody to name when the person cannot be read at all: the account
          says why, and a blank line here would only echo it */}
      {walk.off && who.data !== undefined && (
        <div data-testid="roster-walk-off" {...stylex.props(styles.off)}>
          <span {...stylex.props(styles.name)}>{who.data?.participant.displayName ?? ''}</span>
          <span {...stylex.props(styles.offNote)}>{format(m.rosterWalkOff)}</span>
        </div>
      )}
      <nav
        ref={seatList}
        data-testid="roster-walk-scroller"
        aria-busy={walk.state === 'loading' || walk.stale}
        {...(seat === 'column' ? { 'aria-labelledby': headingId } : { 'aria-label': heading })}
        onScroll={remember}
        onWheel={letGo}
        onTouchStart={letGo}
        onPointerDown={letGo}
        onKeyDown={onRowKey}
        {...stylex.props(styles.scroller)}
      >
        {walk.state === 'loading' ? (
          <div aria-hidden>
            {BONES.map((width, index) => (
              <div key={index} {...stylex.props(styles.bone)}>
                <Skeleton className={stylex.props(styles.boneName).className} width={width} />
                <Skeleton className={stylex.props(styles.boneNumber).className} />
              </div>
            ))}
          </div>
        ) : walk.state === 'failed' ? (
          <div role="alert" {...stylex.props(styles.blank)}>
            <p {...stylex.props(styles.blankWords)}>{formatError(walk.error)}</p>
            <Button variant="outline" size="xs" onClick={walk.retry}>
              {format(commonMessages.retry)}
            </Button>
          </div>
        ) : empty ? (
          <div data-testid="roster-walk-empty" {...stylex.props(styles.blank)}>
            <p {...stylex.props(styles.blankWords)}>
              {format(walk.narrowed ? m.rosterNoMatch : m.rosterEmpty)}
            </p>
            {walk.narrowed && (
              <span {...stylex.props(styles.blankKeys)}>
                {view.q.trim() !== '' && (
                  <Button variant="outline" size="xs" onClick={() => search.flush('')}>
                    {format(m.rosterWalkClearSearch)}
                  </Button>
                )}
                {filtered && (
                  <Button variant="outline" size="xs" onClick={() => onView(ROSTER_UNFILTERED)}>
                    {format(m.rosterWalkClearFilters)}
                  </Button>
                )}
              </span>
            )}
          </div>
        ) : (
          <ul {...stylex.props(styles.list, walk.stale && styles.dim)}>
            {walk.earlier && firstRow !== undefined && (
              <Edge key={`from-${String(firstRow.page)}`} root={box} onSeen={walk.loadEarlier} />
            )}
            {walk.rows.map((row) => (
              <li key={row.id}>
                <WalkEntry
                  row={row}
                  current={row.id === participantId}
                  stop={row.id === stop}
                  onFocus={() => setFocused(row.id)}
                  onOpen={() => {
                    if (row.id !== participantId) onOpen(row.id, row.page)
                  }}
                />
              </li>
            ))}
            {walk.later && lastRow !== undefined && (
              <Edge key={`to-${String(lastRow.page)}`} root={box} onSeen={walk.loadLater} />
            )}
          </ul>
        )}
      </nav>
    </div>
  )
}

/** one person on the list, and the way to open them */
function WalkEntry({
  row,
  current,
  stop,
  onFocus,
  onOpen,
}: {
  row: WalkRow
  current: boolean
  /** the list's one stop on the tab order */
  stop: boolean
  onFocus: () => void
  onOpen: () => void
}) {
  const { format } = useI18n()
  const waiting = ORDER.filter((kind) => row.filings[kind] > 0)
  const said = waiting.map((kind) => format(WORDS[kind], { count: row.filings[kind] }))
  const excluded = row.status === 'excluded'
  return (
    <button
      type="button"
      data-testid="roster-walk-row"
      data-participant={row.id}
      data-position={row.position}
      data-current={current || undefined}
      data-status={row.status}
      data-waiting={
        !waitsOnAnything(row.filings) ? 'none' : row.filings.blocked > 0 ? 'blocked' : 'some'
      }
      aria-current={current ? 'true' : undefined}
      tabIndex={stop ? 0 : -1}
      title={said.length > 0 ? said.join(' ') : undefined}
      onFocus={onFocus}
      onClick={onOpen}
      {...stylex.props(styles.row, current ? styles.rowOn : styles.rowOther)}
    >
      <span
        aria-hidden
        {...stylex.props(
          styles.dot,
          waiting.length > 0 && (row.filings.blocked > 0 ? styles.dotBlocked : styles.dotSome),
        )}
      />
      <span {...stylex.props(styles.name, excluded && styles.nameOff)}>{row.displayName}</span>
      {excluded && <span {...stylex.props(styles.tag)}>{format(m.excludedBadge)}</span>}
      {row.businessNo !== null && <span {...stylex.props(styles.number)}>{row.businessNo}</span>}
      {said.length > 0 && <VisuallyHidden>{said.join(' ')}</VisuallyHidden>}
    </button>
  )
}

/**
 * The edge of what has been read, drawn as a row still to come: scrolled
 * near, it reads the page beyond. Keyed by that page, so once it arrives a
 * new edge watches afresh rather than one that already fired.
 */
function Edge({ root, onSeen }: { root: HTMLElement | null; onSeen: () => void }) {
  const edge = useRef<HTMLLIElement>(null)
  const seen = useRef(onSeen)
  seen.current = onSeen
  useEffect(() => {
    const node = edge.current
    if (node === null || root === null) return
    const watch = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) seen.current()
      },
      { root, rootMargin: '160px 0px' },
    )
    watch.observe(node)
    return () => watch.disconnect()
  }, [root])
  return (
    <li ref={edge} aria-hidden data-testid="roster-walk-edge" {...stylex.props(styles.bone)}>
      <Skeleton className={stylex.props(styles.boneName).className} width="52%" />
      <Skeleton className={stylex.props(styles.boneNumber).className} />
    </li>
  )
}
