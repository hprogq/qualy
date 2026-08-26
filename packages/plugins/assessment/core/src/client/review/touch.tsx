import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronsRightIcon } from 'lucide-react'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'

// The act that confirms a decision under a thumb. Its pointer-reading hooks
// live next door in pointer.ts - the fast-refresh gate holds a component
// file to exporting components alone.

/** how far along the track a release still counts as meant */
const FAR_ENOUGH = 0.85

/** the handle's box and its inset from the track, shared by the arithmetic */
const HANDLE = 44
const INSET = 4

const styles = stylex.create({
  track: {
    position: 'relative',
    height: 44,
    width: '100%',
    touchAction: 'none',
    overflow: 'hidden',
    borderRadius: `calc(${tokens.radiusLg} + 4px)`,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 50%, transparent)`,
    userSelect: 'none',
  },
  trackWaiting: {
    opacity: 0.6,
  },
  // The ground the handle has covered, drawn as one pill the handle caps:
  // same inset, same radius, ending under the handle's far edge - not a
  // square smudge trailing a floating block. Its ink is the handle's own
  // at a whisper, so the two read as one control filling up.
  fill: {
    position: 'absolute',
    top: INSET,
    bottom: INSET,
    left: INSET,
    borderRadius: 9,
    backgroundColor: `color-mix(in oklab, ${tokens.primary} 12%, transparent)`,
    willChange: 'width',
  },
  // transitions only while nothing is held: a finger tracks raw, a release
  // runs the handle and its fill back smoothly
  fillSettling: {
    transitionProperty: 'width',
    transitionDuration: '150ms',
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
  word: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 14,
    fontWeight: 500,
    opacity: 1,
    transitionProperty: 'opacity',
    transitionDuration: '150ms',
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
  wordFaded: {
    opacity: 0.3,
  },
  wordReady: {
    color: tokens.foreground,
  },
  wordWaiting: {
    color: tokens.mutedForeground,
  },
  handle: {
    position: 'absolute',
    top: INSET,
    bottom: INSET,
    left: INSET,
    display: 'flex',
    width: HANDLE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    backgroundColor: tokens.primary,
    color: tokens.primaryForeground,
    boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.1)',
    willChange: 'transform',
  },
  handleSettling: {
    transitionProperty: 'transform',
    transitionDuration: '150ms',
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
  handleIcon: {
    width: 16,
    height: 16,
  },
})

/**
 * An act keyed to a drag across, for a pointer that is a thumb.
 *
 * A tap does nothing and a hold does nothing: only carrying the handle to
 * the far end sends, and letting go early runs it back. A held press was
 * tried first and lost - the platform answers a long press with text
 * selection and a magnifier, which turned every deliberate confirm into a
 * fight with the browser. A drag is the one gesture nothing else claims.
 */
export function SlideKey({
  label,
  waiting,
  ready,
  testId = 'slide-confirm',
  onConfirmed,
}: {
  /** what completing the slide does, said as an instruction */
  label: string
  /** what stands in the way while it cannot be slid */
  waiting: string
  ready: boolean
  testId?: string
  onConfirmed: () => void
}) {
  const track = useRef<HTMLDivElement | null>(null)
  const fill = useRef<HTMLSpanElement | null>(null)
  const handle = useRef<HTMLButtonElement | null>(null)
  /** how far the handle has been carried, in px from the track's left */
  const [at, setAt] = useState(0)
  // The same distance again, readable at event time: a fast flick lands
  // pointermove and pointerup in one frame, and the release handler's
  // closure still holds the render before the move - judged off state, a
  // clean full carry read as zero and nothing went out.
  const carried = useRef(0)
  const [dragging, setDragging] = useState(false)
  const [span, setSpan] = useState(0)
  const grip = useRef<{ pointer: number; start: number; from: number } | null>(null)
  const sent = useRef(false)

  useEffect(() => {
    const rail = track.current
    if (rail === null) return
    const measure = () => {
      const grabbed = rail.querySelector('[data-slide-handle]')
      const width = grabbed instanceof HTMLElement ? grabbed.offsetWidth : 0
      setSpan(Math.max(0, rail.clientWidth - width - INSET * 2))
    }
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(rail)
    return () => watch.disconnect()
  }, [])

  /**
   * The carry, written to the elements in the same event that read the
   * pointer: a handle that waits for the next render commit trails the
   * finger by a frame or two, which is exactly what reads as "loose". The
   * state below still updates - the attribute and the word's fade follow
   * it - but the geometry never waits for it.
   */
  const paint = (next: number) => {
    if (handle.current !== null) handle.current.style.transform = `translateX(${next}px)`
    if (fill.current !== null) fill.current.style.width = next <= 0 ? '0px' : `${next + HANDLE}px`
  }

  const letGo = useCallback(() => {
    grip.current = null
    carried.current = 0
    setDragging(false)
    setAt(0)
    paint(0)
  }, [])

  // an act cleared out from under the drag takes the drag with it
  useEffect(() => {
    if (!ready) letGo()
    sent.current = false
  }, [ready, letGo])

  const move = (event: React.PointerEvent) => {
    const held = grip.current
    if (held === null || held.pointer !== event.pointerId) return
    const next = Math.min(span, Math.max(0, held.from + event.clientX - held.start))
    carried.current = next
    paint(next)
    setAt(next)
  }

  const release = (event: React.PointerEvent) => {
    const held = grip.current
    if (held === null || held.pointer !== event.pointerId) return
    const across = span > 0 && carried.current >= span * FAR_ENOUGH
    if (across && !sent.current) {
      sent.current = true
      grip.current = null
      setDragging(false)
      setAt(span)
      paint(span)
      onConfirmed()
      return
    }
    letGo()
  }

  return (
    <div
      ref={track}
      data-testid={testId}
      data-slide-at={span > 0 ? Math.round((at / span) * 100) : 0}
      {...stylex.props(styles.track, !ready && styles.trackWaiting)}
    >
      <span
        ref={fill}
        aria-hidden
        {...stylex.props(styles.fill, !dragging && styles.fillSettling)}
        style={{ width: at <= 0 ? 0 : at + HANDLE }}
      />
      <span
        {...stylex.props(
          styles.word,
          dragging && at > span * 0.3 && styles.wordFaded,
          ready ? styles.wordReady : styles.wordWaiting,
        )}
      >
        {ready ? label : waiting}
      </span>
      <button
        ref={handle}
        type="button"
        data-slide-handle
        disabled={!ready}
        aria-label={label}
        // Pointer events with capture: one set of handlers answers a finger,
        // a stylus and a mouse alike, and the capture keeps the drag alive
        // when it strays off the handle mid-carry.
        onPointerDown={(event) => {
          if (!ready) return
          try {
            event.currentTarget.setPointerCapture(event.pointerId)
          } catch {
            // a pointer id the platform has no record of; the drag still counts
          }
          grip.current = { pointer: event.pointerId, start: event.clientX, from: carried.current }
          setDragging(true)
        }}
        onPointerMove={move}
        onPointerUp={release}
        onPointerCancel={letGo}
        onContextMenu={(event) => event.preventDefault()}
        {...stylex.props(styles.handle, !dragging && styles.handleSettling)}
        style={{ transform: `translateX(${at}px)` }}
      >
        <ChevronsRightIcon aria-hidden className={stylex.props(styles.handleIcon).className} />
      </button>
    </div>
  )
}
