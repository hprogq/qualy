import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router'
import * as stylex from '@stylexjs/stylex'
import { motion, useReducedMotion } from 'motion/react'
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  XIcon,
} from 'lucide-react'
import { useClaimScreenFoot } from '@qualy/web-runtime'

import { Button } from '@qualy/ui/button'
import { liveStateOf, type LiveLine } from '@qualy/ui/live-mark'
import { Drill } from '@qualy/ui/reveal'
import { Sheet, SheetContent, SheetTitle } from '@qualy/ui/sheet'
import { tokens } from '@qualy/ui/theme/tokens.stylex'

import type { EntryDto, FilingGateDto, ItemDto } from '../model.ts'
import type { Standing, StructureRow } from '../standing.ts'
import { scrollerAbove, useRoomBelow, useWorkspaceMode, type WorkspaceMode } from './layout.ts'
import { useStatsShown } from './preferences.ts'
import { GroupPane } from './GroupPane.tsx'
import { FileKey, ItemPane } from './ItemPane.tsx'
import { Requirements } from './Requirements.tsx'
import { StructureRail } from './StructureRail.tsx'
import {
  filingOf,
  headStatsOf,
  moveBetween,
  movingOn,
  outlineOf,
  totalsOf,
  type FilingRound,
  type Viewer,
} from './model.ts'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

// The entries workspace: a round's structure, one question or section of it
// opened beside it, and - at a desk - what that question asks in a column of
// its own. The owner files into it; somebody checking an account reads the
// same thing with their own keys in place of the owner's.
//
// Four shapes of one screen. At a desk, three columns. On a tablet, two, and
// the requirements come up in a sheet. On a phone, two screens: the
// structure first, then one question with a way back and a way to its
// neighbours - the claim drawer rising from the foot over it.

/** where a desk is wide enough for the broader structure and requirements columns */
const WIDE = '@media (min-width: 1600px)'

/** the height of a phone's section head pinned over the rows under it, and a little room */
const PINNED_HEAD = 48

/** the filing gate's reason where a question's review route never reaches the reader */
const ROUTE_NOWHERE_TO_STAND = 'review-level-missing'

const styles = stylex.create({
  root: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    backgroundColor: tokens.background,
  },
  // fills a parent that bounds its height
  fillParent: {
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  // on a phone the workspace is part of the page: as tall as its content,
  // so the bars pinned inside it stay pinned the whole way down
  flow: { flexShrink: 0 },
  // one question on a phone: at least the screen tall, so the bar at its
  // foot sits at the foot however little the question holds
  phoneScreen: { minHeight: '100%' },
  // The pane arrives from a little way off - below it when the reader steps
  // on, beside it when they go in - and for that moment it reaches past the
  // room it arrives in. Clipped, that reach never becomes room to scroll
  // into, which flashed a scroll bar up for the length of every step down.
  // `clip` and not `hidden`: hidden would make this the scroller its sticky
  // filters pin to, and they would stop pinning.
  phoneBody: { display: 'flex', flexGrow: 1, flexDirection: 'column', overflow: 'clip' },
  arrival: { display: 'flex', minHeight: '100%', flexDirection: 'column', overflow: 'clip' },
  // the pane as it arrives: as tall as the room it arrives in, like the pane
  arrived: { display: 'flex', minHeight: '100%', flexGrow: 1, flexDirection: 'column' },
  columns: {
    display: 'grid',
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    gridTemplateRows: 'minmax(0, 1fr)',
  },
  // a laptop's structure and requirements, and a wide screen's
  columnsDesk: {
    gridTemplateColumns: {
      default: '340px minmax(0, 1fr) 300px',
      [WIDE]: '380px minmax(0, 1fr) 360px',
    },
  },
  columnsDeskGroup: {
    gridTemplateColumns: { default: '340px minmax(0, 1fr)', [WIDE]: '380px minmax(0, 1fr)' },
  },
  columnsTablet: { gridTemplateColumns: '300px minmax(0, 1fr)' },
  rail: {
    minWidth: 0,
    minHeight: 0,
    borderRightWidth: 1,
    borderRightStyle: 'solid',
    borderRightColor: tokens.border,
  },
  main: {
    display: 'flex',
    minWidth: 0,
    minHeight: 0,
    flexDirection: 'column',
  },
  mainScroll: {
    position: 'relative',
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    overflowX: 'hidden',
    overflowY: 'auto',
  },
  stepper: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 12,
    height: 48,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
    backgroundColor: tokens.background,
    paddingInline: 16,
  },
  step: {
    display: 'inline-flex',
    minWidth: 0,
    flexGrow: 1,
    flexBasis: '0%',
    alignItems: 'center',
    gap: 6,
    height: 34,
    borderWidth: 0,
    borderRadius: 8,
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 70%, transparent)`,
    },
    paddingInline: 8,
    fontSize: 13,
    cursor: 'pointer',
  },
  stepNext: { justifyContent: 'flex-end', textAlign: 'right' },
  stepHidden: { visibility: 'hidden' },
  stepWord: { flexShrink: 0, color: tokens.mutedForeground },
  stepTitle: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  stepIcon: { width: 15, height: 15, flexShrink: 0, color: tokens.mutedForeground },
  aside: {
    display: 'flex',
    minWidth: 0,
    minHeight: 0,
    flexDirection: 'column',
    borderLeftWidth: 1,
    borderLeftStyle: 'solid',
    borderLeftColor: tokens.divider,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 35%, ${tokens.background})`,
  },
  asideHead: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 8,
    paddingInline: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  asideTitle: { margin: 0, flexGrow: 1, fontSize: 14, fontWeight: 600 },
  asideScroll: {
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    overflowY: 'auto',
    paddingBottom: 20,
  },
  sheetPanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
    padding: 0,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 35%, ${tokens.background})`,
  },
  sheetBelow: {
    maxHeight: '86dvh',
    overflow: 'hidden',
    borderStartStartRadius: 20,
    borderStartEndRadius: 20,
  },
  sheetBeside: { width: '380px', maxWidth: '92vw' },
  grab: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    flexShrink: 0,
    marginTop: 10,
    borderRadius: 9999,
    backgroundColor: `color-mix(in oklab, ${tokens.foreground} 15%, transparent)`,
  },
  gone: { display: 'none' },
  // the phone's own bar over one question: the way back, and to the neighbours
  phoneBar: {
    position: 'sticky',
    top: 0,
    zIndex: 10,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    height: 44,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    backgroundColor: tokens.background,
    paddingInline: 8,
  },
  back: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 2,
    height: 34,
    borderWidth: 0,
    borderRadius: 8,
    backgroundColor: 'transparent',
    paddingLeft: 4,
    paddingRight: 10,
    fontSize: 14,
    fontWeight: 500,
    color: tokens.foreground,
    cursor: 'pointer',
  },
  backIcon: { width: 18, height: 18 },
  // the neighbours' keys: quiet, and faded rather than boxed when there is
  // no neighbour that way
  arrow: {
    display: 'inline-flex',
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0,
    borderRadius: 8,
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 70%, transparent)`,
    },
    color: tokens.surfaceMutedForeground,
    opacity: { default: 1, ':disabled': 0.3 },
    cursor: { default: 'pointer', ':disabled': 'default' },
  },
  arrowIcon: { width: 17, height: 17 },
  backCount: {
    display: 'inline-flex',
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
    borderRadius: 9999,
    backgroundColor: `color-mix(in oklab, ${tokens.warning} 18%, transparent)`,
    paddingInline: 4,
    fontSize: 10.5,
    fontWeight: 600,
    color: tokens.warningForeground,
  },
  spacer: { flexGrow: 1 },
  phoneFoot: {
    position: 'sticky',
    bottom: 0,
    zIndex: 10,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
    backgroundColor: tokens.background,
    paddingInline: 16,
    paddingTop: 10,
    paddingBottom: 'max(10px, env(safe-area-inset-bottom))',
  },
  footWords: { display: 'flex', minWidth: 0, flexGrow: 1, flexDirection: 'column', gap: 2 },
  footLabel: { fontSize: 12, color: tokens.mutedForeground },
  footValue: { fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums' },
})

export interface WorkspaceProps {
  viewer: Viewer
  /** what the rail is called */
  heading: string
  /** what the big figure at its head is */
  totalLabel: string
  /**
   * The round's wake-up line, for the mark that says the account is kept
   * current. Null, or left out, where the page does not keep it current or
   * it no longer moves - an archived round, a participant taken off the
   * roster - and no mark is drawn.
   */
  live?: LiveLine | null
  rows: readonly StructureRow[]
  entriesByItem: ReadonlyMap<string, readonly EntryDto[]>
  /** every claim this reader may see, for the counts at the head */
  entries: readonly EntryDto[]
  standing: Standing | null
  /** false while the score could not be read: figures are unknown, not zero */
  scored: boolean
  /** said above everything: a score that could not be read, with the way to ask again */
  notice?: ReactNode
  /** the row the address names; '' where it names none */
  open: string
  /**
   * Open a row, or '' for the structure itself. `push` only where the reader
   * went somewhere the back key should bring them out of: from a phone's
   * structure into one question, or from a question up to a section it sits
   * in. Everything else - a neighbour, a row picked from the structure at a
   * desk - stands in place of where they were. The way back up from a
   * question the structure opened goes back through the history instead,
   * and does not come here.
   */
  onOpen: (id: string, history: 'push' | 'replace') => void
  /** the owner's filing gates, per question */
  gates?: ReadonlyMap<string, FilingGateDto>
  /** where the round stands, for saying which stage shut filing and what it opens */
  round?: FilingRound
  busy: boolean
  refreshing: boolean
  onRefresh: () => void
  /** the claim open in the drawer, highlighted in its list */
  openEntryId: string
  onEntry: (entry: EntryDto) => void
  /** the owner starting a claim on a question */
  onFile?: (item: ItemDto) => void
  /** somebody else's key for a question, in place of the owner's */
  itemAction?: (item: ItemDto) => ReactNode
  /** claims whose open round waits on this staff reader's own decision */
  awaitingMe?: ReadonlySet<string>
  /**
   * The owner's claims holding news they have not read (§32.72), each marked
   * on its row until it is opened. Only the owner's page passes it: whether
   * somebody has read their news is nobody else's to see.
   */
  unreadEntries?: ReadonlySet<string>
  /**
   * `parent`: fill a parent that bounds the height. `window`: take the room
   * from where it lands to the foot of the window, in a page that scrolls.
   */
  fit: 'parent' | 'window'
}

export function EntriesWorkspace(props: WorkspaceProps) {
  const mode = useWorkspaceMode()
  return <Workspace {...props} mode={mode} />
}

function Workspace({
  viewer,
  heading,
  totalLabel,
  live = null,
  rows,
  entriesByItem,
  entries,
  standing,
  scored,
  notice,
  open,
  onOpen,
  gates,
  round,
  busy,
  refreshing,
  onRefresh,
  openEntryId,
  onEntry,
  onFile,
  itemAction,
  awaitingMe,
  unreadEntries,
  fit,
  mode,
}: WorkspaceProps & { mode: WorkspaceMode }) {
  const stream = liveStateOf(live)
  const outline = useMemo(() => outlineOf(rows), [rows])
  const [todoOnly, setTodoOnly] = useState(false)
  const [statsShown, setStatsShown] = useStatsShown(viewer)
  // which question's requirements are up in a sheet; leaving the question
  // takes its sheet with it
  const [asideFor, setAsideFor] = useState<string | null>(null)
  const isTodo = (row: StructureRow) =>
    viewer === 'owner' ? row.todo : movingOn(entriesByItem.get(row.id) ?? [])
  // the questions whose review route has nowhere to stand for the owner: no
  // claim of theirs could be handed on there, and the structure says so
  // before the question is opened (§32.93 ③)
  const unfileable = useMemo(
    () =>
      new Set(
        [...(gates?.values() ?? [])]
          .filter(
            (gate) =>
              gate.create.state === 'blocked' && gate.create.reason === ROUTE_NOWHERE_TO_STAND,
          )
          .map((gate) => gate.itemId),
      ),
    [gates],
  )

  // The address names a row; without one, a desk opens the first question
  // there is to answer - an empty pane is no place to land. A phone lands on
  // the structure itself, and the address is what takes it into a question.
  const picked = outline.byId.get(open) ?? null
  const phone = mode === 'phone'
  const selected = picked ?? (phone ? null : (outline.items[0] ?? outline.rows[0] ?? null))
  const onPane = !phone || picked !== null

  const at = selected === null ? -1 : outline.items.findIndex((row) => row.id === selected.id)
  const previous = at > 0 ? outline.items[at - 1]! : null
  const next = at >= 0 && at < outline.items.length - 1 ? outline.items[at + 1]! : null

  const item = selected?.kind === 'item' ? (selected.item ?? null) : null
  const itemEntries = item === null ? [] : (entriesByItem.get(item.id) ?? [])
  const filing =
    viewer === 'owner' && item !== null
      ? filingOf(item, itemEntries, gates?.get(item.id), round ?? null)
      : null

  // A new question starts at its top, wherever the last one was left - and
  // only a new one: data arriving for the same question (a wake-up, a
  // refetch) must leave the reader where they were. The one exception is the
  // back key onto a place the reader left by going up to a section: it lands
  // where they were reading, not at the top of the question.
  const scroller = useRef<HTMLDivElement | null>(null)
  const rootNode = useRef<HTMLDivElement | null>(null)
  const [roomRef, room] = useRoomBelow(fit === 'window' && !phone)
  const selectedId = selected?.id ?? null
  const addressed = picked !== null
  const location = useLocation()
  const navigation = useNavigationType()
  const navigate = useNavigate()
  /** where each history entry left its pane scrolled, for the back key to return to */
  const leftAt = useRef(new Map<string, number>())
  const returning = navigation === 'POP' ? leftAt.current.get(location.key) : undefined
  // On a phone the structure and one question are two screens of one page.
  // Going into a question remembers where the structure was scrolled to, and
  // coming back out lands there - on the row of the question the reader
  // leaves, which is not the one they pressed once they have stepped to its
  // neighbours - rather than at the top of a long paper.
  const structureAt = useRef<number | null>(null)
  const cameFrom = useRef<string | null>(null)
  const wasAddressed = useRef(addressed)

  // Which way the pane arrives, from the row shown last to the one shown
  // now: a phone's step from its structure goes in, a section above goes
  // out, a neighbour comes up or down. The row shown last is kept after each
  // commit, so a render that leaves the same row open draws no arrival.
  const still = useReducedMotion() === true
  const shownLast = useRef<string | null>(null)
  const arrival =
    phone && addressed && !wasAddressed.current
      ? 'in'
      : moveBetween(outline, shownLast.current, selectedId)
  useEffect(() => {
    shownLast.current = selectedId
  }, [selectedId])

  useLayoutEffect(() => {
    if (!phone) {
      wasAddressed.current = addressed
      if (scroller.current !== null) scroller.current.scrollTop = returning ?? 0
      return
    }
    const node = rootNode.current
    if (node === null) return
    const page = scrollerAbove(node)
    const scrollTo = (top: number) => {
      if (page === null) window.scrollTo({ top })
      else page.scrollTop = top
    }
    const before = wasAddressed.current
    wasAddressed.current = addressed
    if (!addressed) {
      if (!before) return
      scrollTo(structureAt.current ?? 0)
      const row =
        cameFrom.current === null
          ? null
          : node.querySelector(`[data-rail-row="${CSS.escape(cameFrom.current)}"]`)
      if (!(row instanceof HTMLElement)) return
      // Where the structure was left may no longer show the row focus lands
      // on: the reader stepped on from the one they pressed, or came in by a
      // link with nothing to return to. Focus is never out of sight, so the
      // structure moves just enough to show it, clear of the section head
      // pinned over it.
      const view =
        page === null ? { top: 0, bottom: window.innerHeight } : page.getBoundingClientRect()
      const at = row.getBoundingClientRect()
      // a section head is itself the thing pinned, with nothing over it
      const holder = row.closest('li')
      const clear =
        holder !== null && getComputedStyle(holder).position === 'sticky' ? 0 : PINNED_HEAD
      // whole pixels, away from the row: a scroll offset is whole, and rows
      // are laid out in fractions of one
      const by =
        at.top < view.top + clear
          ? Math.floor(at.top - view.top - clear)
          : at.bottom > view.bottom
            ? Math.ceil(at.bottom - view.bottom)
            : 0
      if (by !== 0) {
        if (page === null) window.scrollBy({ top: by })
        else page.scrollTop += by
      }
      row.focus({ preventScroll: true })
      return
    }
    scrollTo(returning ?? 0)
    cameFrom.current = selectedId
    // a screen that changed under the reader says so: focus moves to what
    // the new screen is about, and a reader who cannot see it hears its name
    if (!before) {
      const title = node.querySelector('[data-pane-title]')
      if (title instanceof HTMLElement) title.focus({ preventScroll: true })
    }
    // `returning` belongs to the move that changed the question; a back key
    // that shuts a drawer over the same question must not move the pane
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read with the question it came with, never on its own
  }, [selectedId, phone, addressed])

  // The history a phone has walked since it went from its structure into a
  // question, the structure's own entry first, and where in it the reader
  // is: an entry replaced as they step between neighbours, one added by
  // whatever the page opens over the question (a claim's drawer), a place
  // moved when back or forward is pressed. The way back up walks back over
  // it, so the structure is not left in the history a second time for the
  // back key to land on. Null where the question was reached some other
  // way - a link, a reload - and there is nothing behind it to walk back to.
  const trail = useRef<{ keys: string[]; at: number } | null>(null)
  useEffect(() => {
    const walked = trail.current
    if (walked === null || walked.keys[walked.at] === location.key) return
    if (navigation === 'PUSH') {
      walked.keys = [...walked.keys.slice(0, walked.at + 1), location.key]
      walked.at += 1
    } else if (navigation === 'REPLACE') {
      walked.keys[walked.at] = location.key
    } else {
      const at = walked.keys.indexOf(location.key)
      if (at < 0) trail.current = null
      else walked.at = at
    }
  }, [location.key, navigation])

  /** where the phone's structure screen is scrolled to right now */
  const structureScroll = (): number => {
    const node = rootNode.current
    const page = node === null ? null : scrollerAbove(node)
    return page === null ? window.scrollY : page.scrollTop
  }

  const asideOpen = asideFor !== null && asideFor === selected?.id
  const setAsideOpen = (now: boolean) => setAsideFor(now && selected !== null ? selected.id : null)

  // the bar at a phone's foot is the way in; while the stage has shut it the
  // question says why where the way in would be, and a key that could only
  // say "not now" is not put in the reader's thumb
  const footed =
    phone && picked !== null && item !== null && filing !== null && filing.mayAdd && !filing.shut
  useClaimScreenFoot(footed)

  // Moving within a layer stands in place of where the reader was: stepping
  // to a neighbour, a crumb. Ten questions looked at are not ten presses of
  // the back key.
  const go = (id: string) => onOpen(id, 'replace')

  /**
   * From a question up to a section it sits in - its crumbs, the sections
   * its requirements list. That is going somewhere, not looking beside:
   * the back key brings the reader back to the question, scrolled where
   * they left it.
   */
  const goUp = (id: string) => {
    leftAt.current.set(location.key, phone ? structureScroll() : (scroller.current?.scrollTop ?? 0))
    onOpen(id, 'push')
  }

  /** from a phone's question back up to the structure it was entered from */
  const upToStructure = () => {
    const walked = trail.current
    if (walked !== null && walked.at > 0 && walked.keys[walked.at] === location.key) {
      void navigate(-walked.at)
    } else {
      go('')
    }
  }

  const rail = (layout: 'column' | 'screen') => (
    <StructureRail
      heading={heading}
      // the page's own heading where somebody else's account sits under
      // one: the owner's page has no other
      headingLevel={viewer === 'owner' ? 1 : 2}
      totalLabel={totalLabel}
      stream={stream}
      outline={outline}
      total={totalsOf(outline, standing)}
      scored={scored}
      stats={headStatsOf(viewer, entries)}
      statsShown={statsShown}
      onStatsShown={setStatsShown}
      selectedId={phone ? null : (selected?.id ?? null)}
      onSelect={(id) => {
        // from a phone's structure into a question is a layer deeper: the
        // one move the back key should undo
        if (phone) {
          structureAt.current = structureScroll()
          trail.current = { keys: [location.key], at: 0 }
          onOpen(id, 'push')
        } else {
          go(id)
        }
      }}
      todoOnly={todoOnly}
      onTodoOnly={setTodoOnly}
      isTodo={isTodo}
      todoLabel={viewer === 'owner' ? m.paper_viewTodo : m.entries_viewMoving}
      todoEmpty={viewer === 'owner' ? m.entry_filterNone : m.entries_noneMoving}
      refreshing={refreshing}
      onRefresh={onRefresh}
      layout={layout}
      unfileable={unfileable}
    />
  )

  const pane =
    selected === null ? null : item !== null ? (
      <ItemPane
        key={selected.id}
        viewer={viewer}
        mode={mode}
        outline={outline}
        row={selected}
        item={item}
        entries={itemEntries}
        standing={standing}
        scored={scored}
        filing={filing}
        busy={busy}
        selectedEntryId={openEntryId}
        {...(awaitingMe === undefined ? {} : { awaitingMe })}
        {...(unreadEntries === undefined ? {} : { unreadEntries })}
        headerAction={itemAction?.(item)}
        onEntry={onEntry}
        onFile={() => onFile?.(item)}
        onGoto={goUp}
        onRequirements={() => setAsideOpen(true)}
      />
    ) : (
      <GroupPane
        key={selected.id}
        viewer={viewer}
        outline={outline}
        row={selected}
        entriesByItem={entriesByItem}
        scored={scored}
        totalCap={totalsOf(outline, standing).cap}
        isTodo={isTodo}
        onGoto={go}
      />
    )

  const requirements =
    selected !== null && item !== null ? (
      <Requirements
        row={selected}
        item={item}
        outline={outline}
        entries={itemEntries}
        scored={scored}
        onGoto={(id) => {
          setAsideOpen(false)
          goUp(id)
        }}
      />
    ) : null

  const sheet = mode !== 'desk' && (
    <Sheet
      open={asideOpen && requirements !== null}
      onOpenChange={(now) => !now && setAsideOpen(false)}
    >
      <SheetContent
        side={phone ? 'bottom' : 'right'}
        showCloseButton={false}
        xstyle={[styles.sheetPanel, phone ? styles.sheetBelow : styles.sheetBeside]}
      >
        {phone && <span aria-hidden data-sheet-grab="" {...stylex.props(styles.grab)} />}
        <div {...stylex.props(styles.asideHead)}>
          <SheetTitle className={stylex.props(styles.asideTitle).className}>
            {m.entries_requirements()}
          </SheetTitle>
          <Button
            variant="secondary"
            size="icon-sm"
            aria-label={commonMessages.action_close()}
            onClick={() => setAsideOpen(false)}
          >
            <XIcon aria-hidden />
          </Button>
        </div>
        <div {...stylex.props(styles.asideScroll)}>{requirements}</div>
      </SheetContent>
    </Sheet>
  )

  const numberOf = (row: StructureRow) => outline.numbers.get(row.id) ?? ''

  if (phone) {
    const used = itemEntries.filter((entry) => entry.status !== 'voided').length
    return (
      <div
        ref={rootNode}
        data-testid="entries-workspace"
        data-mode={mode}
        data-screen={onPane ? 'item' : 'structure'}
        {...stylex.props(styles.root, styles.flow, onPane && styles.phoneScreen)}
      >
        {notice}
        {/* the structure stays mounted under a question, folds and all, and
            slides back in from the side the question left towards */}
        <motion.div
          initial={false}
          animate={onPane ? { opacity: 0, x: -26 } : { opacity: 1, x: 0 }}
          transition={
            onPane || still ? { duration: 0 } : { duration: 0.2, ease: [0.22, 0.61, 0.36, 1] }
          }
          {...stylex.props(onPane && styles.gone)}
        >
          {rail('screen')}
        </motion.div>
        {onPane && (
          <>
            <div {...stylex.props(styles.phoneBar)}>
              <button type="button" onClick={upToStructure} {...stylex.props(styles.back)}>
                <ChevronLeftIcon aria-hidden {...stylex.props(styles.backIcon)} />
                {m.paper_structure()}
                {outline.items.filter(isTodo).length > 0 && viewer === 'owner' && (
                  <span {...stylex.props(styles.backCount)}>
                    {outline.items.filter(isTodo).length}
                  </span>
                )}
              </button>
              <span {...stylex.props(styles.spacer)} />
              <button
                type="button"
                aria-label={m.entries_previous()}
                disabled={previous === null}
                onClick={() => previous !== null && go(previous.id)}
                {...stylex.props(styles.arrow)}
              >
                <ChevronUpIcon aria-hidden {...stylex.props(styles.arrowIcon)} />
              </button>
              <button
                type="button"
                aria-label={m.entries_next()}
                disabled={next === null}
                onClick={() => next !== null && go(next.id)}
                {...stylex.props(styles.arrow)}
              >
                <ChevronDownIcon aria-hidden {...stylex.props(styles.arrowIcon)} />
              </button>
            </div>
            <div {...stylex.props(styles.phoneBody)}>
              <Drill
                move={arrival}
                drillKey={selected?.id ?? ''}
                className={stylex.props(styles.arrived).className}
              >
                {pane}
              </Drill>
            </div>
            {footed && filing !== null && item !== null && (
              <div {...stylex.props(styles.phoneFoot)} data-testid="phone-foot">
                <span {...stylex.props(styles.footWords)}>
                  <span {...stylex.props(styles.footLabel)}>{m.myEntries_quota()}</span>
                  <span {...stylex.props(styles.footValue)}>
                    {item.maxEntries === null
                      ? m.entries_filedShort({ count: used })
                      : `${String(used)} / ${String(item.maxEntries)}`}
                  </span>
                </span>
                <FileKey filing={filing} busy={busy} size="lg" onPress={() => onFile?.(item)} />
              </div>
            )}
          </>
        )}
        {sheet}
      </div>
    )
  }

  const desk = mode === 'desk'
  return (
    <div
      ref={(node) => {
        rootNode.current = node
        roomRef(node)
      }}
      data-testid="entries-workspace"
      data-mode={mode}
      data-screen={item !== null ? 'item' : 'group'}
      {...stylex.props(styles.root, fit === 'parent' && styles.fillParent)}
      style={fit === 'window' && room !== null ? { height: `${String(room)}px` } : undefined}
    >
      {notice}
      <div
        {...stylex.props(
          styles.columns,
          desk
            ? item !== null
              ? styles.columnsDesk
              : styles.columnsDeskGroup
            : styles.columnsTablet,
        )}
      >
        <div {...stylex.props(styles.rail)}>{rail('column')}</div>
        <div {...stylex.props(styles.main)}>
          <div ref={scroller} {...stylex.props(styles.mainScroll)}>
            <div {...stylex.props(styles.arrival)}>
              <Drill
                move={arrival}
                drillKey={selected?.id ?? ''}
                className={stylex.props(styles.arrived).className}
              >
                {pane}
              </Drill>
            </div>
          </div>
          {item !== null && (previous !== null || next !== null) && (
            <nav aria-label={m.entries_stepLabel()} {...stylex.props(styles.stepper)}>
              <button
                type="button"
                disabled={previous === null}
                onClick={() => previous !== null && go(previous.id)}
                {...stylex.props(styles.step, previous === null && styles.stepHidden)}
              >
                <ChevronLeftIcon aria-hidden {...stylex.props(styles.stepIcon)} />
                <span {...stylex.props(styles.stepWord)}>{m.entries_previous()}</span>
                {previous !== null && (
                  <span {...stylex.props(styles.stepTitle)}>
                    {numberOf(previous)}. {previous.name}
                  </span>
                )}
              </button>
              <button
                type="button"
                disabled={next === null}
                onClick={() => next !== null && go(next.id)}
                {...stylex.props(styles.step, styles.stepNext, next === null && styles.stepHidden)}
              >
                {next !== null && (
                  <span {...stylex.props(styles.stepTitle)}>
                    {numberOf(next)}. {next.name}
                  </span>
                )}
                <span {...stylex.props(styles.stepWord)}>{m.entries_next()}</span>
                <ChevronRightIcon aria-hidden {...stylex.props(styles.stepIcon)} />
              </button>
            </nav>
          )}
        </div>
        {desk && item !== null && (
          <aside aria-label={m.entries_requirements()} {...stylex.props(styles.aside)}>
            <div {...stylex.props(styles.asideHead)}>
              <h2 {...stylex.props(styles.asideTitle)}>{m.entries_requirements()}</h2>
            </div>
            <div {...stylex.props(styles.asideScroll)}>{requirements}</div>
          </aside>
        )}
      </div>
      {sheet}
    </div>
  )
}
