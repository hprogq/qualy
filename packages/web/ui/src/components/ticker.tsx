import { AnimatePresence, motion } from 'motion/react'
import { cn } from '../lib/utils.ts'

// A value that changes while you are looking at it.
//
// A countdown that swaps its text every second is a flicker; the eye reads it
// as noise and stops trusting the number. So a changed character leaves
// blurred and its replacement arrives blurred, over a fraction of a second.
//
// A changed CHARACTER, not the whole line: going from 39 to 38 seconds moves
// one digit, and blurring the words around it says something happened to them
// too. The rest of the line stays perfectly still, which is what makes the
// one moving digit legible.
//
// Text-free like the rest of this package: the caller has already decided
// what the value says.

/**
 * Where each character sits, so a character keeps its identity across renders.
 *
 * Keyed by position rather than by content: at position 4 the digit 9 becoming
 * 8 is a change at that position, and keying by the character would make it a
 * different element entirely every time any neighbour shifted.
 */
const positions = (value: string) => [...value]

export function Ticker({
  value,
  className,
}: {
  /** the value, already formatted; a change is what animates */
  value: string
  className?: string
}) {
  return (
    <span className={cn('inline-flex tabular-nums whitespace-nowrap', className)}>
      {positions(value).map((character, at) => (
        // one presence per position: only the ones whose character changed
        // have anything to swap
        <AnimatePresence key={at} initial={false} mode="popLayout">
          <motion.span
            key={character}
            className="inline-block"
            initial={{ opacity: 0, y: 5, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -5, filter: 'blur(4px)', position: 'absolute' }}
            transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
          >
            {/* a space of its own would collapse, and the words would close
                up over it every time a digit beside it moved */}
            {character === ' ' ? ' ' : character}
          </motion.span>
        </AnimatePresence>
      ))}
    </span>
  )
}
