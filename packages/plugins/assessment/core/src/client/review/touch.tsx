import { useCallback, useEffect, useRef, useState } from 'react'

// The act that reviewing keys to under a thumb. Its pointer-reading hooks
// live next door in pointer.ts - the fast-refresh gate holds a component
// file to exporting components alone.

/** how long a thumb has to stay down before the act goes out */
const HOLD_MS = 900

/**
 * An act keyed to a press held down, for a pointer that is a thumb.
 *
 * A tap chooses; only the full hold sends. Letting go early is a change of
 * mind: nothing goes out and the fill runs back. The words never move - the
 * label is drawn once in the key's ink and once in the fill's, the second
 * clipped to however far the fill has swept, so the sweep reads the label
 * out rather than pushing a copy of it across. The clipped copy is sized to
 * the key's measured width; sizing it to the viewport squeezed it anywhere
 * the key was narrower than the screen.
 */
export function HoldKey({
  label,
  waiting,
  ready,
  testId = 'hold-submit',
  onHeld,
}: {
  /** what holding it does, said as an instruction: nobody guesses a hold */
  label: string
  /** what stands in the way while it cannot be held */
  waiting: string
  ready: boolean
  testId?: string
  onHeld: () => void
}) {
  const [held, setHeld] = useState(false)
  const [width, setWidth] = useState(0)
  const node = useRef<HTMLButtonElement | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const key = node.current
    if (key === null) return
    const measure = () => setWidth(key.clientWidth)
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(key)
    return () => watch.disconnect()
  }, [])

  const stop = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    setHeld(false)
  }, [])
  useEffect(() => stop, [stop])
  // an act cleared out from under the press takes the press with it
  useEffect(() => {
    if (!ready) stop()
  }, [ready, stop])

  const start = () => {
    if (!ready || timer.current !== null) return
    setHeld(true)
    timer.current = setTimeout(() => {
      timer.current = null
      setHeld(false)
      onHeld()
    }, HOLD_MS)
  }

  const sweep = {
    width: held ? '100%' : '0%',
    transitionDuration: held ? `${HOLD_MS}ms` : '150ms',
  }
  const words = ready ? label : waiting

  return (
    <button
      ref={node}
      type="button"
      disabled={!ready}
      data-testid={testId}
      data-holding={held ? 'yes' : 'no'}
      // Pointer events rather than touch: one set of handlers answers a
      // finger, a stylus and a mouse alike, and the capture keeps the press
      // alive when the thumb slides off the edge of the key mid-hold.
      onPointerDown={(event) => {
        try {
          event.currentTarget.setPointerCapture(event.pointerId)
        } catch {
          // a pointer id the platform has no record of; the press still counts
        }
        start()
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onContextMenu={(event) => event.preventDefault()}
      className="relative flex h-11 w-full shrink-0 touch-none items-center justify-center overflow-hidden rounded-xl border text-sm font-medium select-none disabled:opacity-60"
    >
      {/* a quiet invitation while it waits to be held: the pulse is what
          says this key is not a tap, before the words are even read */}
      {ready && !held && (
        <span
          aria-hidden
          className="absolute inset-0 animate-pulse rounded-[inherit] bg-primary/10"
        />
      )}
      {/* the fill is the only thing that moves */}
      <span
        aria-hidden
        style={sweep}
        className="absolute inset-y-0 left-0 bg-primary transition-[width] ease-linear motion-reduce:transition-none"
      />
      <span className="relative">{words}</span>
      <span
        aria-hidden
        style={sweep}
        className="absolute inset-y-0 left-0 overflow-hidden transition-[width] ease-linear motion-reduce:transition-none"
      >
        <span
          style={{ width }}
          className="absolute inset-y-0 left-0 flex items-center justify-center text-primary-foreground"
        >
          {words}
        </span>
      </span>
    </button>
  )
}
