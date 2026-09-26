import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router'
import * as stylex from '@stylexjs/stylex'
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  XIcon,
} from 'lucide-react'
import { useClaimScreenFoot } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Button } from '@qualy/ui/button'
import { Sheet, SheetContent, SheetTitle } from '@qualy/ui/sheet'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentMessages as m } from '../../i18n.ts'
import type { EntryDto, FilingGateDto, ItemDto } from '../model.ts'
import type { Standing, StructureRow } from '../standing.ts'
import { scrollerAbove, useRoomBelow, useWorkspaceMode, type WorkspaceMode } from './layout.ts'
import { GroupPane } from './GroupPane.tsx'
import { FileKey, ItemPane } from './ItemPane.tsx'
import { Requirements } from './Requirements.tsx'
import { StructureRail } from './StructureRail.tsx'
import {
  filingOf,
  headStatsOf,
  movingOn,
  outlineOf,
  totalsOf,
  type RoundState,
  type Viewer,
} from './model.ts'

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
  phoneBody: { display: 'flex', flexGrow: 1, flexDirection: 'column' },
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
   * structure into one question. Everything else - a neighbour, any move at
   * a desk - stands in place of where they were. The way back up from a
   * question the structure opened goes back through the history instead,
   * and does not come here.
   */
  onOpen: (id: string, history: 'push' | 'replace') => void
  /** the owner's filing gates, per question */
  gates?: ReadonlyMap<string, FilingGateDto>
  /** where the round stands, for saying which stage shut filing */
  round?: RoundState
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
  /** a question came on screen */
  onShow?: (row: StructureRow) => void
  /** claims whose open round waits on this staff reader's own decision */
  awaitingMe?: ReadonlySet<string>
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
  onShow,
  awaitingMe,
  fit,
  mode,
}: WorkspaceProps & { mode: WorkspaceMode }) {
  const { format } = useI18n()
  const outline = useMemo(() => outlineOf(rows), [rows])
  const [todoOnly, setTodoOnly] = useState(false)
  // which question's requirements are up in a sheet; leaving the question
  // takes its sheet with it
  const [asideFor, setAsideFor] = useState<string | null>(null)
  const isTodo = (row: StructureRow) =>
    viewer === 'owner' ? row.todo : movingOn(entriesByItem.get(row.id) ?? [])

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
  // refetch) must leave the reader where they were.
  const scroller = useRef<HTMLDivElement | null>(null)
  const rootNode = useRef<HTMLDivElement | null>(null)
  const [roomRef, room] = useRoomBelow(fit === 'window' && !phone)
  const selectedId = selected?.id ?? null
  const addressed = picked !== null
  // On a phone the structure and one question are two screens of one page.
  // Going into a question remembers where the structure was scrolled to, and
  // coming back out lands there - on the row of the question the reader
  // leaves, which is not the one they pressed once they have stepped to its
  // neighbours - rather than at the top of a long paper.
  const structureAt = useRef<number | null>(null)
  const cameFrom = useRef<string | null>(null)
  const wasAddressed = useRef(addressed)
  useLayoutEffect(() => {
    if (!phone) {
      wasAddressed.current = addressed
      if (scroller.current !== null) scroller.current.scrollTop = 0
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
    scrollTo(0)
    cameFrom.current = selectedId
    // a screen that changed under the reader says so: focus moves to what
    // the new screen is about, and a reader who cannot see it hears its name
    if (!before) {
      const title = node.querySelector('[data-pane-title]')
      if (title instanceof HTMLElement) title.focus({ preventScroll: true })
    }
  }, [selectedId, phone, addressed])

  // The history a phone has walked since it went from its structure into a
  // question, the structure's own entry first, and where in it the reader
  // is: an entry replaced as they step between neighbours, one added by
  // whatever the page opens over the question (a claim's drawer), a place
  // moved when back or forward is pressed. The way back up walks back over
  // it, so the structure is not left in the history a second time for the
  // back key to land on. Null where the question was reached some other
  // way - a link, a reload - and there is nothing behind it to walk back to.
  const location = useLocation()
  const navigation = useNavigationType()
  const navigate = useNavigate()
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

  // A question on screen is a question looked at: its news is read - and
  // news that lands while it is on screen is read too, so the dot never
  // waits for the reader to leave and come back.
  const shown = onPane && item !== null ? selected : null
  useEffect(() => {
    if (shown !== null) onShow?.(shown)
    // the row is re-derived every render; what matters is which one it is
    // and whether it holds news
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown?.id, shown?.unread])

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
      outline={outline}
      total={totalsOf(outline, standing)}
      scored={scored}
      stats={headStatsOf(viewer, entries)}
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
      todoLabel={viewer === 'owner' ? m.paperViewTodo : m.entriesViewMoving}
      todoEmpty={viewer === 'owner' ? m.myEntriesFilterNone : m.entriesNoneMoving}
      refreshing={refreshing}
      onRefresh={onRefresh}
      layout={layout}
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
        entries={
          viewer === 'owner'
            ? itemEntries.filter((entry) => entry.status !== 'voided')
            : itemEntries
        }
        standing={standing}
        scored={scored}
        filing={filing}
        busy={busy}
        selectedEntryId={openEntryId}
        {...(awaitingMe === undefined ? {} : { awaitingMe })}
        headerAction={itemAction?.(item)}
        onEntry={onEntry}
        onFile={() => onFile?.(item)}
        onGoto={go}
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
          go(id)
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
            {format(m.entriesRequirements)}
          </SheetTitle>
          <Button
            variant="secondary"
            size="icon-sm"
            aria-label={format(commonMessages.close)}
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
        <div {...stylex.props(onPane && styles.gone)}>{rail('screen')}</div>
        {onPane && (
          <>
            <div {...stylex.props(styles.phoneBar)}>
              <button type="button" onClick={upToStructure} {...stylex.props(styles.back)}>
                <ChevronLeftIcon aria-hidden {...stylex.props(styles.backIcon)} />
                {format(m.paperStructure)}
                {outline.items.filter(isTodo).length > 0 && viewer === 'owner' && (
                  <span {...stylex.props(styles.backCount)}>
                    {outline.items.filter(isTodo).length}
                  </span>
                )}
              </button>
              <span {...stylex.props(styles.spacer)} />
              <button
                type="button"
                aria-label={format(m.entriesPrevious)}
                disabled={previous === null}
                onClick={() => previous !== null && go(previous.id)}
                {...stylex.props(styles.arrow)}
              >
                <ChevronUpIcon aria-hidden {...stylex.props(styles.arrowIcon)} />
              </button>
              <button
                type="button"
                aria-label={format(m.entriesNext)}
                disabled={next === null}
                onClick={() => next !== null && go(next.id)}
                {...stylex.props(styles.arrow)}
              >
                <ChevronDownIcon aria-hidden {...stylex.props(styles.arrowIcon)} />
              </button>
            </div>
            <div {...stylex.props(styles.phoneBody)}>{pane}</div>
            {footed && filing !== null && item !== null && (
              <div {...stylex.props(styles.phoneFoot)} data-testid="phone-foot">
                <span {...stylex.props(styles.footWords)}>
                  <span {...stylex.props(styles.footLabel)}>{format(m.myEntriesQuota)}</span>
                  <span {...stylex.props(styles.footValue)}>
                    {item.maxEntries === null
                      ? format(m.entriesFiledShort, { count: used })
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
            {pane}
          </div>
          {item !== null && (previous !== null || next !== null) && (
            <nav aria-label={format(m.entriesStepLabel)} {...stylex.props(styles.stepper)}>
              <button
                type="button"
                disabled={previous === null}
                onClick={() => previous !== null && go(previous.id)}
                {...stylex.props(styles.step, previous === null && styles.stepHidden)}
              >
                <ChevronLeftIcon aria-hidden {...stylex.props(styles.stepIcon)} />
                <span {...stylex.props(styles.stepWord)}>{format(m.entriesPrevious)}</span>
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
                <span {...stylex.props(styles.stepWord)}>{format(m.entriesNext)}</span>
                <ChevronRightIcon aria-hidden {...stylex.props(styles.stepIcon)} />
              </button>
            </nav>
          )}
        </div>
        {desk && item !== null && (
          <aside aria-label={format(m.entriesRequirements)} {...stylex.props(styles.aside)}>
            <div {...stylex.props(styles.asideHead)}>
              <h2 {...stylex.props(styles.asideTitle)}>{format(m.entriesRequirements)}</h2>
            </div>
            <div {...stylex.props(styles.asideScroll)}>{requirements}</div>
          </aside>
        )}
      </div>
      {sheet}
    </div>
  )
}
