import { AnimatePresence, motion } from 'motion/react'
import { cn } from '../lib/utils.ts'

// A value that changes while you are looking at it.
//
// A countdown that swaps its text every second is a flicker; the eye reads it
// as noise and stops trusting the number. So the old value leaves blurred and
// the new one arrives blurred, over a fraction of a second - long enough to
// be a movement rather than a jump, short enough that the number is legible
// almost the whole time.
//
// Text-free like the rest of this package: the caller has already decided
// what the value says.
export function Ticker({
  value,
  className,
}: {
  /** the value, already formatted; a change is what animates */
  value: string
  className?: string
}) {
  return (
    <span className={cn('relative inline-flex tabular-nums', className)}>
      {/* the widest of the two values holds the width, so neighbouring text
          does not shuffle sideways every time a digit changes */}
      <span aria-hidden className="invisible whitespace-nowrap">
        {value}
      </span>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={value}
          className="absolute inset-0 whitespace-nowrap"
          initial={{ opacity: 0, y: 6, filter: 'blur(4px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -6, filter: 'blur(4px)' }}
          transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}
