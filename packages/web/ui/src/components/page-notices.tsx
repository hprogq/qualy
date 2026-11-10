import { useEffect, useId, useLayoutEffect, useRef, useState, type ComponentProps } from 'react'
import { ChevronRightIcon, ChevronUpIcon, InfoIcon, TriangleAlertIcon } from 'lucide-react'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '../theme/tokens.stylex.ts'
import { useHydrating } from '../hooks/use-hydrating.ts'

export interface PageNotice {
  readonly id: string
  readonly tone: 'warning' | 'info'
  readonly label: string
  readonly actionLabel: string
  readonly onSelect: () => void
  readonly testId?: string
  readonly attributes?: Readonly<Record<`data-${string}`, string | number>>
}

// Persistent notices stacked as the product's toasts are: one card in front,
// the rest peeking behind it, fanned out while the pointer is over the stack.

/** how far each card behind peeks out above the one in front of it */
const PEEK = 10
/** how much smaller each card behind is drawn */
const SHRINK = 0.05
/** the room between two fanned-out cards */
const GAP = 8
/** cards drawn behind the front one at most */
const BEHIND = 2

const enter = stylex.keyframes({
  from: { opacity: 0, transform: 'translateY(16px)' },
  to: { opacity: 1, transform: 'none' },
})
const REDUCE = '@media (prefers-reduced-motion: reduce)'
const EASE = 'cubic-bezier(0.2, 0, 0, 1)'

const styles = stylex.create({
  space: {
    position: 'sticky',
    bottom: 0,
    zIndex: 40,
    flexShrink: 0,
    marginTop: 'auto',
    paddingTop: 16,
    paddingBottom: 'calc(clamp(24px, 8cqh, 48px) + 16px)',
    paddingInline: 12,
    pointerEvents: 'none',
  },
  dock: {
    display: 'flex',
    justifyContent: 'center',
  },
  stand: {
    position: 'relative',
    width: 400,
    maxWidth: '100%',
  },
  port: {
    pointerEvents: 'auto',
    transitionProperty: 'height',
    transitionDuration: { default: '300ms', [REDUCE]: '0s' },
    transitionTimingFunction: EASE,
  },
  portExpanded: { position: 'absolute', insetInline: 0, bottom: 0 },
  // more fanned-out cards than the page has room for scroll, front last
  portScrolls: {
    overflowY: 'auto',
    overscrollBehavior: 'none',
    scrollbarWidth: 'thin',
    // room for the cards' rings, which a scroll box would otherwise cut
    paddingInline: 3,
    marginInline: -3,
  },
  stack: { position: 'relative' },
  stackExpanded: { height: '100%' },
  slot: {
    position: 'absolute',
    insetInline: 0,
    bottom: 0,
    transformOrigin: 'center top',
    transitionProperty: 'transform, opacity, height',
    transitionDuration: { default: '300ms', [REDUCE]: '0s' },
    transitionTimingFunction: EASE,
  },
  front: { position: 'relative' },
  card: {
    display: 'flex',
    alignItems: 'stretch',
    height: '100%',
    minWidth: 0,
    overflow: 'hidden',
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surfaceElevated,
    boxShadow: tokens.elevation2,
    color: tokens.foreground,
  },
  cardEnter: {
    animationName: { default: enter, [REDUCE]: 'none' },
    animationDuration: '300ms',
    animationTimingFunction: EASE,
  },
  action: {
    display: 'flex',
    minWidth: 0,
    flexGrow: 1,
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    paddingBlock: 12,
    paddingInlineStart: 14,
    paddingInlineEnd: 12,
    borderWidth: 0,
    backgroundColor: { default: 'transparent', ':hover': tokens.hoverSurface },
    color: 'inherit',
    cursor: 'pointer',
    textAlign: 'start',
    fontFamily: 'inherit',
    fontSize: 13,
    lineHeight: '1.25rem',
    fontWeight: 500,
    outlineOffset: -3,
    outlineColor: tokens.focusRing,
    transitionProperty: 'background-color',
    transitionDuration: '120ms',
  },
  words: { minWidth: 0, flexGrow: 1, overflowWrap: 'anywhere' },
  icon: { width: 16, height: 16, flexShrink: 0, color: tokens.mutedForeground },
  warningIcon: { color: tokens.warning },
  go: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 2,
    marginInlineStart: 4,
    fontSize: 12,
    fontWeight: 400,
    color: tokens.mutedForeground,
    whiteSpace: 'nowrap',
  },
  arrow: { width: 14, height: 14, flexShrink: 0 },
  more: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 4,
    paddingInline: 12,
    borderWidth: 0,
    borderInlineStartWidth: 1,
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: tokens.divider,
    backgroundColor: { default: 'transparent', ':hover': tokens.hoverSurface },
    color: tokens.mutedForeground,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 12,
    fontWeight: 500,
    fontVariantNumeric: 'tabular-nums',
    outlineOffset: -3,
    outlineColor: tokens.focusRing,
  },
  turn: {
    width: 14,
    height: 14,
    flexShrink: 0,
    transitionProperty: 'transform',
    transitionDuration: { default: '200ms', [REDUCE]: '0s' },
  },
  turned: { transform: 'rotate(180deg)' },
})

// A card in the document's initial HTML is already visible. A new notice
// mounted after takeover keeps the same entrance as an interactive visit.
function NoticeCard(props: ComponentProps<'div'>) {
  const hydrating = useHydrating()
  const [animate] = useState(() => !hydrating)
  return <div {...props} {...stylex.props(styles.card, animate && styles.cardEnter)} />
}

/** Persistent page warnings. Mount once, after the page's working content. */
export function PageNotices({
  notices,
  label,
  expandLabel,
  collapseLabel,
}: {
  notices: readonly PageNotice[]
  label: string
  expandLabel: string
  collapseLabel: string
}) {
  const dock = useRef<HTMLDivElement>(null)
  const stack = useRef<HTMLDivElement>(null)
  const more = useRef<HTMLButtonElement>(null)
  const cards = useRef(new Map<string, HTMLElement>())
  const [heights, setHeights] = useState<Readonly<Record<string, number>>>({})
  const [pinned, setPinned] = useState(false)
  const [hovered, setHovered] = useState(false)
  const stacked = notices.length > 1
  const expanded = (pinned || hovered) && stacked
  const [available, setAvailable] = useState<number | null>(null)
  const detailsId = useId()
  const visible = notices.length > 0
  const ids = notices.map((notice) => notice.id).join('\n')

  // Each card's own height, as its content draws it: a card behind the
  // front one is drawn at the front one's height until the stack fans out.
  useLayoutEffect(() => {
    if (!visible) return
    const measure = () => {
      const next: Record<string, number> = {}
      for (const [id, node] of cards.current) next[id] = node.offsetHeight
      setHeights((old) =>
        Object.keys(next).length === Object.keys(old).length &&
        Object.entries(next).every(([id, height]) => old[id] === height)
          ? old
          : next,
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    for (const node of cards.current.values()) observer.observe(node)
    return () => observer.disconnect()
  }, [visible, ids, expanded])

  // a fanned stack too tall for the page opens scrolled to its front card
  useLayoutEffect(() => {
    const node = stack.current
    if (expanded && node !== null && node.scrollHeight > node.clientHeight)
      node.scrollTop = node.scrollHeight
  }, [expanded, heights])

  useEffect(() => {
    setPinned(false)
    setHovered(false)
  }, [visible, stacked])
  // Only the expanded stack needs the amount of room above the dock.
  // The collapsed card is positioned by CSS even before the browser hydrates.
  useLayoutEffect(() => {
    const node = dock.current
    if (!expanded || node === null) return
    const scrollport = node.closest('main')
    const measure = () => {
      const top = Math.max(0, scrollport?.getBoundingClientRect().top ?? 0)
      setAvailable(Math.max(0, node.getBoundingClientRect().bottom - top - 12))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    if (scrollport !== null) observer.observe(scrollport)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [expanded])

  if (!visible) return null
  const front = heights[notices[0]!.id] ?? 48
  const peeking = Math.min(notices.length - 1, BEHIND)
  const heightOf = (notice: PageNotice) => heights[notice.id] ?? front
  const fanned =
    notices.reduce((sum, notice) => sum + heightOf(notice), 0) + GAP * (notices.length - 1)
  const room = Math.max(front, available ?? fanned)
  const scrolls = expanded && fanned > room

  const keep = (id: string) => (node: HTMLElement | null) => {
    if (node === null) cards.current.delete(id)
    else cards.current.set(id, node)
  }
  const action = (notice: PageNotice) => {
    const Icon = notice.tone === 'warning' ? TriangleAlertIcon : InfoIcon
    return (
      <button
        type="button"
        data-testid={notice.testId}
        data-tone={notice.tone}
        {...notice.attributes}
        aria-label={`${notice.label}, ${notice.actionLabel}`}
        onClick={notice.onSelect}
        {...stylex.props(styles.action)}
      >
        <Icon
          aria-hidden
          {...stylex.props(styles.icon, notice.tone === 'warning' && styles.warningIcon)}
        />
        <span {...stylex.props(styles.words)}>{notice.label}</span>
        <span aria-hidden {...stylex.props(styles.go)}>
          {notice.actionLabel}
          <ChevronRightIcon {...stylex.props(styles.arrow)} />
        </span>
      </button>
    )
  }

  let offset = 0
  const slots = notices.map((notice, index) => {
    const lift = offset
    offset += heightOf(notice) + GAP
    const shown = index <= BEHIND
    const transform = expanded
      ? `translateY(${String(-lift)}px)`
      : `translateY(${String(-PEEK * index)}px) scale(${String(1 - SHRINK * index)})`
    return (
      <div
        key={notice.id}
        data-slot="page-notice"
        data-index={index}
        aria-hidden={index > 0 && !expanded ? true : undefined}
        {...stylex.props(styles.slot, index === 0 && !expanded && styles.front)}
        style={{
          zIndex: notices.length - index,
          transform,
          opacity: expanded || shown ? 1 : 0,
          // a card behind the front one is the front one's shape until fanned
          height: index > 0 && !expanded ? '100%' : undefined,
        }}
      >
        <NoticeCard ref={index === 0 || expanded ? keep(notice.id) : undefined}>
          {(index === 0 || expanded) && action(notice)}
          {index === 0 && notices.length > 1 && (
            <button
              ref={more}
              type="button"
              aria-label={expanded ? collapseLabel : expandLabel}
              aria-expanded={expanded}
              aria-controls={expanded ? detailsId : undefined}
              onClick={() => {
                setPinned(!expanded)
                setHovered(false)
              }}
              {...stylex.props(styles.more)}
            >
              <span>{notices.length}</span>
              <ChevronUpIcon
                aria-hidden
                {...stylex.props(styles.turn, expanded && styles.turned)}
              />
            </button>
          )}
        </NoticeCard>
      </div>
    )
  })

  return (
    <div data-slot="page-notice-space" {...stylex.props(styles.space)}>
      <div
        ref={dock}
        data-testid="page-notices"
        role="region"
        aria-label={label}
        {...stylex.props(styles.dock)}
        style={{ paddingBlockStart: PEEK * peeking }}
      >
        <div {...stylex.props(styles.stand)} style={{ minHeight: expanded ? front : undefined }}>
          <div
            ref={stack}
            id={detailsId}
            data-slot="page-notices-port"
            data-expanded={expanded}
            {...stylex.props(
              styles.port,
              expanded && styles.portExpanded,
              scrolls && styles.portScrolls,
            )}
            style={{ height: expanded ? Math.min(fanned, room) : undefined }}
            onPointerEnter={(event) => {
              if (event.pointerType === 'mouse') setHovered(true)
            }}
            onMouseLeave={() => {
              if (!stack.current?.contains(document.activeElement)) setHovered(false)
            }}
            onBlur={(event) => {
              if (
                !event.currentTarget.contains(event.relatedTarget) &&
                !event.currentTarget.matches(':hover')
              )
                setHovered(false)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && expanded) {
                event.stopPropagation()
                more.current?.focus()
                setPinned(false)
                setHovered(false)
              }
            }}
          >
            <div
              {...stylex.props(styles.stack, expanded && styles.stackExpanded)}
              style={scrolls ? { height: fanned } : undefined}
            >
              {slots}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
