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
import { TimerIcon, LockIcon } from 'lucide-react'
import * as stylex from '@stylexjs/stylex'
import { Ticker } from '@qualy/ui/ticker'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import type { Message } from '@qualy/i18n-contract'
import { countdownTone, spanMessage, spanOf } from './progress.ts'
import { countdownColors } from './countdown.stylex.ts'
import * as m from '#messages'

const CLEARANCE = 'clamp(24px, 8cqh, 48px)'
const REDUCE = '@media (prefers-reduced-motion: reduce)'
const SNAP = 24
const EDGE = 8
const enter = stylex.keyframes({
  from: { opacity: 0, transform: 'translateY(16px)' },
  to: { opacity: 1, transform: 'none' },
})

const styles = stylex.create({
  seat: {
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
  target: {
    position: 'absolute',
    inset: 0,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: tokens.mutedForeground,
    borderRadius: tokens.radiusLg,
  },
  dock: {
    position: 'relative',
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    columnGap: 12,
    rowGap: 4,
    flexWrap: 'wrap',
    minHeight: 48,
    paddingInline: 16,
    paddingBlock: 12,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surfaceElevated,
    boxShadow: tokens.elevation2,
    fontSize: 13,
    lineHeight: '1.25rem',
    fontVariantNumeric: 'tabular-nums',
    pointerEvents: 'auto',
    touchAction: 'none',
    userSelect: 'none',
    cursor: 'grab',
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
  title: { fontWeight: 600, overflowWrap: 'anywhere' },
  detail: { color: tokens.mutedForeground, overflowWrap: 'anywhere' },
  figures: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 12,
    whiteSpace: 'nowrap',
    fontWeight: 600,
  },
  track: {
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
    { kind: 'until', at, remaining, span: spanOf(remaining), fraction: null },
    'single',
  )
  return (span.message as Message)(span.values)
}

export function DeadlineDock({
  id,
  title,
  detail,
  aside,
  closed = false,
  workbench = false,
  countdown,
  facts,
}: {
  id: string
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
  const gesture = useRef<{ id: number; start: Point; before: Point } | null>(null)
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
    }
    setSnapping(false)
    setDragging(true)
  }
  const drag = (event: PointerEvent<HTMLDivElement>) => {
    const active = gesture.current
    if (!active || active.id !== event.pointerId) return
    move(
      bounded({
        x: active.before.x + event.clientX - active.start.x,
        y: active.before.y + event.clientY - active.start.y,
      }),
    )
  }
  const finish = (event: PointerEvent<HTMLDivElement>, cancelled = false) => {
    const active = gesture.current
    if (!active || active.id !== event.pointerId) return
    gesture.current = null
    setDragging(false)
    if (cancelled) move(active.before)
    else if (Math.hypot(offset.current.x, offset.current.y) <= SNAP) home()
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
        {dragging && <div aria-hidden data-slot="deadline-home" {...stylex.props(styles.target)} />}
        <div
          {...facts}
          data-testid={id}
          data-tone={tone}
          data-dragging={dragging || undefined}
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
          <span {...stylex.props(styles.title)}>{title}</span>
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
      </div>
    </div>
  )
}
