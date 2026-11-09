import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { useDocumentNow, useHydrating } from '@qualy/web-runtime'
import { ListTreeIcon, TimerIcon, LockIcon } from 'lucide-react'
import * as stylex from '@stylexjs/stylex'
import { Ticker } from '@qualy/ui/ticker'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import type { Message } from '@qualy/i18n-contract'
import { countdownTone, spanMessage, spanOf } from './progress.ts'
import { countdownColors } from './countdown.stylex.ts'
import { openBatchFlow } from './flow-request.ts'
import * as m from '#messages'

const CLEARANCE = 'calc(clamp(24px, 8cqh, 48px) + 16px)'
const REDUCE = '@media (prefers-reduced-motion: reduce)'
const COMPACT = '@container deadline-seat (max-width: 34rem)'
const SNAP = 24
const RELEASE = 38
const EDGE = 8
const enter = stylex.keyframes({
  from: { opacity: 0, transform: 'translateY(16px)' },
  to: { opacity: 1, transform: 'none' },
})

const styles = stylex.create({
  seat: {
    containerName: 'deadline-seat',
    containerType: 'inline-size',
    position: 'sticky',
    bottom: 0,
    zIndex: 40,
    display: 'flex',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 'auto',
    paddingBottom: CLEARANCE,
    pointerEvents: 'none',
  },
  workbench: {
    position: { default: 'absolute', [breakpoints.phone]: 'sticky' },
    insetInline: { default: 12, [breakpoints.phone]: 0 },
    paddingInline: { default: 0, [breakpoints.phone]: 12 },
  },
  origin: { position: 'relative', minWidth: 0, maxWidth: '100%' },
  target: { position: 'absolute', inset: 0, width: '100%', height: '100%' },
  targetStroke: {
    width: 'calc(100% - 2px)',
    height: 'calc(100% - 2px)',
    fill: 'none',
    stroke: tokens.mutedForeground,
    strokeWidth: 1.5,
    strokeDasharray: '8 5',
    strokeLinecap: 'round',
  },
  dock: {
    position: 'relative',
    display: { default: 'flex', [COMPACT]: 'grid' },
    gridTemplateColumns: { [COMPACT]: '16px minmax(0, 1fr) auto auto' },
    minWidth: 0,
    alignItems: 'center',
    columnGap: { default: 12, [COMPACT]: 8 },
    rowGap: { [COMPACT]: 6 },
    minHeight: 48,
    paddingInline: { default: 16, [COMPACT]: 12 },
    paddingBlock: 12,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surfaceElevated,
    // Elevation includes an outline; this card already has a real border.
    boxShadow: '0 2px 4px oklch(0 0 0 / 0.04), 0 12px 24px -8px oklch(0 0 0 / 0.1)',
    fontSize: 13,
    lineHeight: '1.25rem',
    fontVariantNumeric: 'tabular-nums',
    pointerEvents: 'auto',
    touchAction: 'none',
    userSelect: 'none',
    cursor: 'grab',
  },
  content: {
    display: { default: 'flex', [COMPACT]: 'contents' },
    alignItems: 'center',
    columnGap: 12,
    rowGap: 4,
    flexWrap: 'wrap',
    minWidth: 0,
  },
  timelineButton: {
    flexShrink: 0,
    display: 'grid',
    placeItems: 'center',
    gridColumn: { [COMPACT]: '4' },
    gridRow: { [COMPACT]: '1' },
    width: { default: 28, [COMPACT]: 32 },
    height: { default: 28, [COMPACT]: 32 },
    marginBlock: { default: -4, [COMPACT]: -6 },
    marginInlineEnd: { default: -6, [COMPACT]: -4 },
    padding: 0,
    borderWidth: 0,
    borderRadius: tokens.radiusSm,
    backgroundColor: { default: 'transparent', ':hover': tokens.surfaceMuted },
    color: { default: tokens.mutedForeground, ':hover': tokens.foreground },
    cursor: 'pointer',
  },
  held: { cursor: 'grabbing' },
  snap: {
    transitionProperty: 'translate',
    transitionDuration: { default: '160ms', [REDUCE]: '0s' },
    transitionTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
  },
  enter: {
    animationName: { default: enter, [REDUCE]: 'none' },
    animationDuration: '300ms',
    animationTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
  },
  handle: {
    display: 'inline-flex',
    gridColumn: { [COMPACT]: '1' },
    gridRow: { [COMPACT]: '1' },
    alignItems: 'center',
    color: tokens.mutedForeground,
    backgroundColor: 'transparent',
    padding: 0,
    borderWidth: 0,
    borderRadius: 3,
    outlineOffset: 3,
    cursor: 'inherit',
  },
  icon: { width: 16, height: 16 },
  title: {
    gridColumn: { [COMPACT]: '2 / 4' },
    gridRow: { [COMPACT]: '1' },
    fontWeight: 600,
    overflowWrap: 'anywhere',
  },
  timedTitle: {
    gridColumn: { [COMPACT]: '2' },
    overflow: { [COMPACT]: 'hidden' },
    textOverflow: { [COMPACT]: 'ellipsis' },
    whiteSpace: { [COMPACT]: 'nowrap' },
  },
  detail: {
    gridColumn: { [COMPACT]: '2 / -1' },
    color: tokens.mutedForeground,
    overflowWrap: 'anywhere',
  },
  figures: {
    display: 'inline-flex',
    gridColumn: { [COMPACT]: '3' },
    gridRow: { [COMPACT]: '1' },
    alignItems: 'center',
    gap: 12,
    whiteSpace: 'nowrap',
    fontWeight: 600,
  },
  track: {
    display: { default: 'block', [COMPACT]: 'none' },
    width: { default: 120, [breakpoints.phone]: 52 },
    height: 4,
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: tokens.surfaceMuted,
  },
  fill: { display: 'block', height: '100%', borderRadius: 999, backgroundColor: 'currentColor' },
})

type Point = { x: number; y: number }
const HOME: Point = { x: 0, y: 0 }
const clamp = (value: number, low: number, high: number) =>
  low <= high ? Math.min(high, Math.max(low, value)) : 0

/** A live document clock; server HTML and the takeover use the document instant. */
export function useDeadlineNow(at: number | null): number {
  const now = useDocumentNow()
  const [, redraw] = useState(0)
  useEffect(() => {
    if (at === null) return
    let timer: ReturnType<typeof setTimeout>
    const arm = () => {
      const left = at - Date.now()
      if (left <= 0) return
      const precision = left < 3_600_000 ? 1000 : 60_000
      const next = left % precision || 1
      timer = setTimeout(
        () => {
          redraw((n) => n + 1)
          arm()
        },
        Math.min(left, next + 1),
      )
    }
    arm()
    return () => clearTimeout(timer)
  }, [at])
  return now
}

export function deadlineWords(at: number, now: number): string {
  const remaining = at - now
  const span = spanMessage(
    { kind: 'until', at, remaining, span: spanOf(Math.max(1_000, remaining)), fraction: null },
    'single',
  )
  return (span.message as Message)(span.values)
}

export function DeadlineDock({
  id,
  batchId,
  title,
  detail,
  aside,
  closed = false,
  workbench = false,
  countdown,
  facts,
}: {
  id: string
  batchId: string
  title: string
  detail?: string | undefined
  aside?: ReactNode
  closed?: boolean
  workbench?: boolean
  countdown?: { text: string; remaining: number; progress?: number | null } | undefined
  facts?: Readonly<Record<`data-${string}`, string | number | boolean | undefined>>
}) {
  const hydrating = useHydrating()
  const [enterOnMount] = useState(() => !hydrating)
  const origin = useRef<HTMLDivElement>(null)
  const offset = useRef(HOME)
  const [point, setPoint] = useState(HOME)
  const [dragging, setDragging] = useState(false)
  const [snapping, setSnapping] = useState(false)
  const gesture = useRef<{ id: number; start: Point; before: Point; snapped: boolean } | null>(null)
  const moved = point.x !== 0 || point.y !== 0

  const move = useCallback((point: Point) => {
    if (point.x === offset.current.x && point.y === offset.current.y) return
    offset.current = point
    setPoint(point)
  }, [])
  const bounded = useCallback((point: Point): Point => {
    const node = origin.current
    if (!node) return point
    const anchor = node.getBoundingClientRect()
    const main = node.closest('main')
    const area = main?.getBoundingClientRect()
    const footer = main ? parseFloat(getComputedStyle(main).paddingBottom) : 0
    return {
      x: clamp(
        point.x,
        Math.max(0, area?.left ?? 0) + EDGE - anchor.left,
        Math.min(window.innerWidth, area?.right ?? window.innerWidth) - EDGE - anchor.right,
      ),
      y: clamp(
        point.y,
        Math.max(0, area?.top ?? 0) + EDGE - anchor.top,
        Math.min(window.innerHeight, (area?.bottom ?? window.innerHeight) - footer) -
          EDGE -
          anchor.bottom,
      ),
    }
  }, [])
  useLayoutEffect(() => {
    if (!moved) return
    const node = origin.current
    const main = node?.closest('main')
    const keepInView = () => move(bounded(offset.current))
    const observer = new ResizeObserver(keepInView)
    if (node) observer.observe(node)
    if (main) observer.observe(main)
    window.addEventListener('resize', keepInView)
    main?.addEventListener('scroll', keepInView, { passive: true })
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', keepInView)
      main?.removeEventListener('scroll', keepInView)
    }
  }, [bounded, move, moved])

  const home = () => {
    setSnapping(true)
    move(HOME)
  }
  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary) return
    event.currentTarget.setPointerCapture(event.pointerId)
    gesture.current = {
      id: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      before: offset.current,
      snapped: !moved,
    }
    setSnapping(false)
    setDragging(true)
  }
  const drag = (event: PointerEvent<HTMLDivElement>) => {
    const active = gesture.current
    if (!active || active.id !== event.pointerId) return
    const next = bounded({
      x: active.before.x + event.clientX - active.start.x,
      y: active.before.y + event.clientY - active.start.y,
    })
    // The pointer has to pull farther out than it did to snap in. Keep
    // reading from its unsnapped position, so it can leave without release.
    const near = Math.hypot(next.x, next.y) <= (active.snapped ? RELEASE : SNAP)
    if (near !== active.snapped) {
      active.snapped = near
      setSnapping(near)
    }
    move(near ? HOME : next)
  }
  const finish = (event: PointerEvent<HTMLDivElement>, cancelled = false) => {
    const active = gesture.current
    if (!active || active.id !== event.pointerId) return
    gesture.current = null
    setDragging(false)
    if (cancelled) {
      setSnapping(false)
      move(active.before)
    }
  }
  const key = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? 48 : 16
    if (event.key === 'Home' || event.key === 'Escape') {
      event.preventDefault()
      home()
    } else if (
      event.key === 'ArrowLeft' ||
      event.key === 'ArrowRight' ||
      event.key === 'ArrowUp' ||
      event.key === 'ArrowDown'
    ) {
      event.preventDefault()
      setSnapping(false)
      move(
        bounded({
          x:
            offset.current.x +
            (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
          y:
            offset.current.y +
            (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0),
        }),
      )
    }
  }
  const tone = closed || !countdown ? 'calm' : countdownTone(countdown.remaining)
  const Icon = closed ? LockIcon : TimerIcon

  return (
    <div {...stylex.props(styles.seat, workbench && styles.workbench)}>
      <div ref={origin} {...stylex.props(styles.origin)}>
        {dragging && (
          <svg aria-hidden data-slot="deadline-home" {...stylex.props(styles.target)}>
            <rect x="1" y="1" rx="12" {...stylex.props(styles.targetStroke)} />
          </svg>
        )}
        <div
          {...facts}
          data-testid={id}
          data-tone={tone}
          data-dragging={dragging || undefined}
          data-snapped={(dragging && snapping) || undefined}
          {...stylex.props(
            styles.dock,
            enterOnMount && styles.enter,
            dragging && styles.held,
            snapping && styles.snap,
          )}
          style={moved || snapping ? { translate: `${point.x}px ${point.y}px` } : undefined}
          onPointerDown={start}
          onPointerMove={drag}
          onPointerUp={finish}
          onPointerCancel={(event) => finish(event, true)}
          onLostPointerCapture={(event) => finish(event, true)}
        >
          <div {...stylex.props(styles.content)}>
            <button
              type="button"
              aria-label={m.deadline_move()}
              title={m.deadline_move()}
              onKeyDown={key}
              onClick={(event) => {
                if (event.detail === 0) home()
              }}
              {...stylex.props(styles.handle)}
            >
              <Icon aria-hidden className={stylex.props(styles.icon).className} />
            </button>
            <span
              title={countdown ? title : undefined}
              {...stylex.props(styles.title, countdown && styles.timedTitle)}
            >
              {title}
            </span>
            {detail && <span {...stylex.props(styles.detail)}>{detail}</span>}
            {countdown && (
              <span
                data-slot="deadline-countdown"
                {...stylex.props(styles.figures, countdownColors[tone])}
              >
                {countdown.progress != null && (
                  <span aria-hidden {...stylex.props(styles.track)}>
                    <span
                      data-slot="deadline-progress"
                      {...stylex.props(styles.fill)}
                      style={{ width: `${Math.round(countdown.progress * 100)}%` }}
                    />
                  </span>
                )}
                <span aria-label={countdown.text}>
                  <Ticker value={countdown.text} />
                </span>
              </span>
            )}
            {aside && <span {...stylex.props(styles.detail)}>{aside}</span>}
          </div>
          <button
            type="button"
            aria-haspopup="dialog"
            aria-label={m.flow_openTimeline()}
            title={m.flow_openTimeline()}
            {...stylex.props(styles.timelineButton)}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => openBatchFlow(batchId)}
          >
            <ListTreeIcon aria-hidden className={stylex.props(styles.icon).className} />
          </button>
        </div>
      </div>
    </div>
  )
}
