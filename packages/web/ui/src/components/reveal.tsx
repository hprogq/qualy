import { Children, useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

import { cn } from '../lib/utils.ts'

// The entrance a screen makes: a short fade and lift, once, on mount.
// Deliberately subtle - page content should arrive, not perform.
export function Reveal({
  className,
  delay = 0,
  children,
}: {
  className?: string
  delay?: number
  children: ReactNode
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, delay, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  )
}

// A pane whose content is replaced in place: the new content fades up as the
// old leaves, so a change that happened somewhere else on screen is visibly
// the cause. Give it a `key` that changes with the content.
export function Swap({
  swapKey,
  className,
  children,
}: {
  swapKey: string
  className?: string
  children: ReactNode
}) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={swapKey}
        className={className}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.16, ease: 'easeOut' }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}

// A box that follows its own content's height instead of snapping to it.
//
// For a region whose content is replaced by something a different size - a
// heading band that hands over to the heading of whatever was opened. Left
// alone it would jump, and everything below it with it; reserving the taller
// of the two would leave a hole under the shorter one. So it travels the
// difference, in the same beat as whatever replaced the content.
export function Resizing({ className, children }: { className?: string; children: ReactNode }) {
  const reduced = useReducedMotion()
  const [content, setContent] = useState<HTMLDivElement | null>(null)
  const [height, setHeight] = useState<number | null>(null)

  useEffect(() => {
    if (content === null) return
    const watch = new ResizeObserver(() => setHeight(content.offsetHeight))
    watch.observe(content)
    setHeight(content.offsetHeight)
    return () => watch.disconnect()
  }, [content])

  return (
    <motion.div
      className={className}
      style={{ overflow: 'hidden' }}
      initial={false}
      animate={{ height: height ?? 'auto' }}
      transition={{ duration: reduced === true ? 0 : 0.2, ease: [0.22, 0.61, 0.36, 1] }}
    >
      <div ref={setContent}>{children}</div>
    </motion.div>
  )
}

// Opening one row of a list, coming back out of it, and stepping along.
//
// A detail reached from a list is not somewhere else in the product, and a
// plain fade says it is: two unrelated screens, one replaced by the other.
// So the move itself is drawn. Going in and coming back are opposite
// sideways pushes; stepping to the next or previous of the same kind of
// thing is a shorter move up or down the same stack. `none` is for a change
// the reader caused without navigating - a save that lands on the thing they
// were already looking at should not perform an arrival.
//
// Which move it was is the caller's to say, not something to infer: the same
// two screens can be reached by going in, stepping along, or not moving at
// all, and only whoever changed the screen knows which happened.
export type DrillMove = 'in' | 'out' | 'next' | 'previous' | 'none'

/** how far the arriving screen starts from where it settles */
const OFFSET: Record<DrillMove, { axis: 'x' | 'y'; from: number }> = {
  in: { axis: 'x', from: 26 },
  out: { axis: 'x', from: -26 },
  next: { axis: 'y', from: 18 },
  previous: { axis: 'y', from: -18 },
  none: { axis: 'x', from: 0 },
}

interface Going {
  axis: 'x' | 'y'
  from: number
  fade: boolean
}

const drilling = {
  enter: (going: Going) => ({ opacity: going.fade ? 0 : 1, [going.axis]: going.from }),
  settled: { opacity: 1, x: 0, y: 0 },
}

export function Drill({
  move,
  drillKey,
  className,
  children,
}: {
  /** which way the reader went to get here; `none` swaps without an arrival */
  move: DrillMove
  /** changes when the screen does, the way a route would */
  drillKey: string
  className?: string
  children: ReactNode
}) {
  // asked for less motion: the travel goes, the crossfade stays, because an
  // instant swap is the thing that loses the reader
  const reduced = useReducedMotion() === true
  const going: Going =
    move === 'none'
      ? { ...OFFSET.none, fade: false }
      : reduced
        ? { ...OFFSET.none, fade: true }
        : { ...OFFSET[move], fade: true }

  // Only what arrives is drawn. The screen being left is gone in the same
  // commit, which is what keeps the two out of each other's way: held on
  // screen together they show through one another and fight over how tall
  // the page is, and held apart in sequence the arriving screen does not
  // exist yet - so anything it is expected to fill, a heading band it
  // renders into, sits empty for the length of the exit. The direction it
  // comes from is enough to say which way the reader went.
  return (
    <motion.div
      key={drillKey}
      custom={going}
      className={className}
      variants={drilling}
      initial="enter"
      animate="settled"
      transition={{ duration: move === 'none' ? 0 : 0.2, ease: [0.22, 0.61, 0.36, 1] }}
    >
      {children}
    </motion.div>
  )
}

// A ring that empties over a known span, with whatever it is counting in the
// middle of it.
//
// For a window somebody may act inside: a number alone says how long is
// left, but only after it has been read. The ring says it at a glance, and
// it is the same fact drawn twice rather than decoration - which is why it
// runs on the real deadline instead of a fixed loop. Reduced motion keeps
// the number and drops the sweep.
export function CountdownRing({
  seconds,
  remaining,
  className,
  children,
}: {
  /** how long the whole window is */
  seconds: number
  /** how much of it is left when this renders, for a ring that resumes right */
  remaining: number
  className?: string
  children?: ReactNode
}) {
  const reduced = useReducedMotion()
  const circumference = 2 * Math.PI * 11
  const left = Math.max(0, Math.min(1, remaining / seconds))
  return (
    <span className={cn('relative flex size-6.5 items-center justify-center', className)}>
      <svg viewBox="0 0 26 26" className="absolute inset-0 -rotate-90">
        <circle cx="13" cy="13" r="11" fill="none" strokeWidth="2" className="stroke-border" />
        <motion.circle
          cx="13"
          cy="13"
          r="11"
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          className="stroke-foreground"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference * (1 - left) }}
          animate={{
            strokeDashoffset: reduced === true ? circumference * (1 - left) : circumference,
          }}
          transition={{ duration: reduced === true ? 0 : seconds * left, ease: 'linear' }}
        />
      </svg>
      <span className="relative text-xs tabular-nums">{children}</span>
    </span>
  )
}

// The mark a finished run ends on: a ring drawn round once, then a tick
// struck through it.
//
// The one place on these screens where an animation is the message. Clearing
// a queue is the point of the work, and a static tick that was simply there
// when the screen arrived says nothing happened. Drawn, it says you did that.
export function DoneMark({ className }: { className?: string }) {
  const reduced = useReducedMotion()
  const still = reduced === true
  return (
    <svg viewBox="0 0 76 76" className={cn('size-16', className)} aria-hidden>
      <circle cx="38" cy="38" r="32" fill="none" strokeWidth="2" className="stroke-border" />
      <motion.circle
        cx="38"
        cy="38"
        r="32"
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        className="stroke-foreground"
        transform="rotate(-90 38 38)"
        initial={{ pathLength: still ? 1 : 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: still ? 0 : 0.62, ease: [0.4, 0, 0.2, 1] }}
      />
      <motion.path
        d="M25 39.5 34 48.5 51.5 30"
        fill="none"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-foreground"
        initial={{ pathLength: still ? 1 : 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: still ? 0 : 0.38, delay: still ? 0 : 0.52, ease: [0.4, 0, 0.2, 1] }}
      />
    </svg>
  )
}

// Children arriving one after another rather than all at once.
//
// For a screen whose parts are read in order - a mark, then what it means,
// then what to do next. The stagger is what makes it an order rather than a
// pile; anything whose parts are read at a glance should not use it.
export function Stagger({
  className,
  delay = 0,
  step = 0.07,
  children,
}: {
  className?: string
  /** held back until whatever comes before it has finished */
  delay?: number
  step?: number
  children: ReactNode
}) {
  const reduced = useReducedMotion()
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="shown"
      variants={{
        shown: {
          transition: { staggerChildren: reduced === true ? 0 : step, delayChildren: delay },
        },
      }}
    >
      {Children.map(children, (child) => (
        <motion.div
          variants={{
            hidden: { opacity: reduced === true ? 1 : 0, y: reduced === true ? 0 : 8 },
            shown: { opacity: 1, y: 0 },
          }}
          transition={{ duration: reduced === true ? 0 : 0.32, ease: [0.4, 0, 0.2, 1] }}
        >
          {child}
        </motion.div>
      ))}
    </motion.div>
  )
}

// Something that comes and goes where it stands: a bar that offers to undo,
// a strip that says what just happened.
//
// Not a dialog and not a toast - it belongs to the screen it is on and to a
// moment that ends. Wrapped in presence so the going is drawn too; without
// it the thing simply is not there any more, which reads as a glitch.
export function Appear({
  show,
  className,
  collapse = false,
  children,
}: {
  show: boolean
  className?: string
  /**
   * Whether the room it takes goes with it.
   *
   * Fading alone leaves the space behind until the animation ends, and then
   * drops it all at once - everything below jumps up a line the moment the
   * fade finishes. Collapsing animates the height too, so the page closes
   * over it. Only for something in normal flow: on an absolutely positioned
   * element there is no room to give back.
   */
  collapse?: boolean
  children: ReactNode
}) {
  const reduced = useReducedMotion()
  const still = reduced === true
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          className={className}
          style={collapse ? { overflow: 'hidden' } : undefined}
          initial={{
            opacity: 0,
            ...(collapse ? { height: 0 } : { y: still ? 0 : 12, scale: still ? 1 : 0.98 }),
          }}
          animate={{ opacity: 1, ...(collapse ? { height: 'auto' } : { y: 0, scale: 1 }) }}
          exit={{
            opacity: 0,
            ...(collapse ? { height: 0 } : { y: still ? 0 : 8, scale: still ? 1 : 0.98 }),
          }}
          transition={{ duration: still ? 0 : 0.18, ease: [0.4, 0, 0.2, 1] }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
