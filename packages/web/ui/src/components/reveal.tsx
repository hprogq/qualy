import { useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

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
