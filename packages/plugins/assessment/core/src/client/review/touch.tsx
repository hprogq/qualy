import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronsRightIcon } from 'lucide-react'
import { cn } from '@qualy/ui/cn'

// The act that confirms a decision under a thumb. Its pointer-reading hooks
// live next door in pointer.ts - the fast-refresh gate holds a component
// file to exporting components alone.

/** how far along the track a release still counts as meant */
const FAR_ENOUGH = 0.85

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
      const handle = rail.querySelector('[data-slide-handle]')
      const width = handle instanceof HTMLElement ? handle.offsetWidth : 0
      setSpan(Math.max(0, rail.clientWidth - width - 8))
    }
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(rail)
    return () => watch.disconnect()
  }, [])

  const letGo = useCallback(() => {
    grip.current = null
    carried.current = 0
    setDragging(false)
    setAt(0)
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
      className={cn(
        'relative h-11 w-full touch-none overflow-hidden rounded-xl border bg-muted/50 select-none',
        !ready && 'opacity-60',
      )}
    >
      {/* the trail the handle has covered, so progress reads as progress */}
      <span
        aria-hidden
        style={{ width: at + 44 }}
        className={cn('absolute inset-y-0 left-0 bg-primary/10', !dragging && 'transition-[width]')}
      />
      <span
        className={cn(
          'absolute inset-0 flex items-center justify-center text-sm font-medium transition-opacity',
          dragging && at > span * 0.3 ? 'opacity-30' : 'opacity-100',
          ready ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {ready ? label : waiting}
      </span>
      <button
        type="button"
        data-slide-handle
        disabled={!ready}
        aria-label={label}
        style={{ transform: `translateX(${at}px)` }}
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
        className={cn(
          'absolute top-1 bottom-1 left-1 flex w-11 items-center justify-center rounded-[9px] bg-primary text-primary-foreground',
          !dragging && 'transition-transform',
        )}
      >
        <ChevronsRightIcon aria-hidden className="size-4" />
      </button>
    </div>
  )
}
