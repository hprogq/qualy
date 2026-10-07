import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRightIcon, ChevronUpIcon, InfoIcon, TriangleAlertIcon } from 'lucide-react'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '../theme/tokens.stylex.ts'

export interface PageNotice {
  readonly id: string
  readonly tone: 'warning' | 'info'
  readonly label: string
  readonly actionLabel: string
  readonly onSelect: () => void
  readonly testId?: string
  readonly attributes?: Readonly<Record<`data-${string}`, string | number>>
}

const radiate = stylex.keyframes({
  '0%': { opacity: 0, transform: 'scale(1)' },
  '15%': { opacity: 0.75, transform: 'scale(1.008, 1.08)' },
  '85%, 100%': { opacity: 0, transform: 'scale(1.045, 1.55)' },
})
const REDUCE = '@media (prefers-reduced-motion: reduce)'

const styles = stylex.create({
  space: { height: 84, flexShrink: 0 },
  dock: {
    position: 'fixed',
    zIndex: 40,
    display: 'flex',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
  stack: { position: 'relative', width: 480, maxWidth: '100%', pointerEvents: 'auto' },
  wave: {
    position: 'absolute',
    inset: 0,
    borderRadius: tokens.radiusPill,
    pointerEvents: 'none',
    boxShadow: `0 0 12px 4px color-mix(in oklab, ${tokens.warning} 36%, transparent)`,
    opacity: { default: 0, [REDUCE]: 0.35 },
    animationName: { default: radiate, [REDUCE]: 'none' },
    animationDuration: '3.2s',
    animationTimingFunction: 'ease-out',
    animationIterationCount: 'infinite',
  },
  pill: {
    position: 'relative',
    display: 'flex',
    flexShrink: 0,
    alignItems: 'stretch',
    minWidth: 0,
    maxWidth: '100%',
    borderRadius: tokens.radiusPill,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    backgroundColor: tokens.surfaceElevated,
    // Elevation tokens include a second outline; this pill already has its own border.
    boxShadow: `0 4px 16px -4px color-mix(in oklab, ${tokens.foreground} 16%, transparent)`,
    color: tokens.foreground,
    overflow: 'hidden',
  },
  action: {
    display: 'flex',
    minWidth: 0,
    flexGrow: 1,
    alignItems: 'center',
    gap: 10,
    minHeight: 42,
    paddingBlock: 10,
    paddingInline: 16,
    borderWidth: 0,
    backgroundColor: { default: 'transparent', ':hover': tokens.hoverSurface },
    color: 'inherit',
    cursor: 'pointer',
    textAlign: 'start',
    fontFamily: 'inherit',
    fontSize: 13,
    lineHeight: '1.25rem',
    fontWeight: 500,
    outlineOffset: -4,
    outlineColor: tokens.focusRing,
  },
  words: { minWidth: 0, overflowWrap: 'anywhere' },
  icon: { width: 16, height: 16, flexShrink: 0, color: tokens.mutedForeground },
  warningIcon: { color: tokens.warning },
  arrow: { width: 14, height: 14, flexShrink: 0, marginInlineStart: 'auto' },
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
    fontVariantNumeric: 'tabular-nums',
    outlineOffset: -4,
    outlineColor: tokens.focusRing,
  },
  expanded: {
    position: 'absolute',
    bottom: 'calc(100% + 8px)',
    insetInline: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    maxHeight: 'min(50dvh, 20rem)',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    padding: 2,
    borderRadius: tokens.radiusLg,
  },
  // Bridge the visual gap so a pointer can reach the expanded actions.
  bridge: { position: 'absolute', insetInline: 0, bottom: '100%', height: 10 },
})

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
  const marker = useRef<HTMLDivElement>(null)
  const stack = useRef<HTMLDivElement>(null)
  const primary = useRef<HTMLDivElement>(null)
  const more = useRef<HTMLButtonElement>(null)
  const [pillHeight, setPillHeight] = useState(52)
  const [pinned, setPinned] = useState(false)
  const [hovered, setHovered] = useState(false)
  const expanded = pinned || hovered
  const [bounds, setBounds] = useState<{
    left: number
    width: number
    bottom: number
    available: number
    clearance: number
  } | null>(null)
  const detailsId = useId()
  const visible = notices.length > 0
  const ready = visible && bounds !== null

  useLayoutEffect(() => {
    const node = primary.current
    if (!ready || node === null) return
    const measure = () => setPillHeight(node.getBoundingClientRect().height)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [ready])

  useEffect(() => {
    setPinned(false)
    setHovered(false)
  }, [visible])
  useLayoutEffect(() => {
    if (!visible || marker.current === null) return
    let boundary = marker.current.closest('main') ?? marker.current.parentElement
    while (boundary !== null && boundary !== document.body) {
      if (
        boundary.tagName === 'MAIN' ||
        /(auto|scroll|hidden)/.test(getComputedStyle(boundary).overflowY)
      )
        break
      boundary = boundary.parentElement
    }
    const port = boundary === document.body ? null : boundary
    let frame = 0
    const measure = () => {
      const rect = port?.getBoundingClientRect()
      const left = Math.max(0, rect?.left ?? 0) + 12
      const right = Math.min(window.innerWidth, rect?.right ?? window.innerWidth) - 12
      // The shell reserves bottom space for its phone navigation.
      const foot = port === null ? 0 : parseFloat(getComputedStyle(port).paddingBottom) || 0
      const visibleBottom = Math.min(window.innerHeight, rect?.bottom ?? window.innerHeight)
      const visibleTop = Math.max(0, rect?.top ?? 0)
      const clearance = Math.min(
        48,
        Math.max(24, Math.round((visibleBottom - visibleTop - foot) * 0.08)),
      )
      const bottom = window.innerHeight - visibleBottom + foot + clearance
      const next = {
        left,
        width: Math.max(0, right - left),
        bottom,
        available: Math.max(0, window.innerHeight - bottom - visibleTop),
        clearance,
      }
      setBounds((old) =>
        old !== null &&
        old.left === next.left &&
        old.width === next.width &&
        old.bottom === next.bottom &&
        old.available === next.available &&
        old.clearance === next.clearance
          ? old
          : next,
      )
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    measure()
    const observer = new ResizeObserver(schedule)
    if (port !== null) observer.observe(port)
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
    }
  }, [visible])

  if (!visible) return null
  const first = notices[0]!
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
        <ChevronRightIcon aria-hidden {...stylex.props(styles.arrow)} />
      </button>
    )
  }
  return (
    <>
      <div
        ref={marker}
        aria-hidden
        data-slot="page-notice-space"
        {...stylex.props(styles.space)}
        style={{ height: pillHeight + (bounds?.clearance ?? 48) + 16 }}
      />
      {bounds !== null &&
        createPortal(
          <div
            data-testid="page-notices"
            role="region"
            aria-label={label}
            {...stylex.props(styles.dock)}
            style={{ left: bounds.left, width: bounds.width, bottom: bounds.bottom }}
          >
            <div
              ref={stack}
              data-expanded={expanded}
              {...stylex.props(styles.stack)}
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
              {!expanded && notices.some((notice) => notice.tone === 'warning') && (
                <span aria-hidden data-slot="page-notice-wave" {...stylex.props(styles.wave)} />
              )}
              <div ref={primary} {...stylex.props(styles.pill)}>
                {action(first)}
                {notices.length > 1 && (
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
                    <ChevronUpIcon aria-hidden {...stylex.props(styles.icon)} />
                  </button>
                )}
              </div>
              {expanded && notices.length > 1 && (
                <>
                  <div {...stylex.props(styles.bridge)} />
                  <div
                    id={detailsId}
                    {...stylex.props(styles.expanded)}
                    style={{
                      maxHeight: Math.max(0, Math.min(320, bounds.available - pillHeight - 12)),
                    }}
                  >
                    {notices.slice(1).map((notice) => (
                      <div key={notice.id} {...stylex.props(styles.pill)}>
                        {action(notice)}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
