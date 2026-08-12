import { AnimatePresence, motion } from 'motion/react'
import { cn } from '../lib/utils.ts'

// A value that changes while you are looking at it.
//
// A countdown that swaps its text every second is a flicker; the eye reads it
// as noise and stops trusting the number. So a changed character leaves
// blurred and its replacement arrives blurred, over a fraction of a second.
//
// A changed DIGIT, not the whole line: going from 39 to 38 seconds moves one
// digit, and blurring the words around it says something happened to them
// too. The rest of the line stays perfectly still, which is what makes the
// one moving digit legible.
//
// Text-free like the rest of this package: the caller has already decided
// what the value says.

/**
 * The value as the pieces that can change independently.
 *
 * Every digit stands alone, because a digit is what ticks; everything between
 * them stays one piece. Splitting the words too would put each character in
 * its own box, and a line of boxes is set differently from a line of text -
 * kerning goes, and CJK words come out visibly spaced.
 */
const pieces = (value: string): string[] => {
  const out: string[] = []
  for (const character of value) {
    const digit = character >= '0' && character <= '9'
    const last = out.at(-1)
    if (digit || last === undefined || (last >= '0' && last <= '9')) out.push(character)
    else out[out.length - 1] = last + character
  }
  return out
}

export function Ticker({
  value,
  className,
}: {
  /** the value, already formatted; a change is what animates */
  value: string
  className?: string
}) {
  return (
    // the whole line animates its own size, so a value that loses a piece
    // ("37 分 1 秒" becoming "37 分") closes the gap instead of snapping shut
    <motion.span layout className={cn('inline-flex tabular-nums whitespace-nowrap', className)}>
      {pieces(value).map((piece, at) => (
        // one presence per position: only the pieces whose text changed have
        // anything to swap
        <AnimatePresence key={at} initial={false} mode="popLayout">
          <motion.span
            layout
            key={piece}
            // pre, because a space at the edge of an inline block is trimmed:
            // "3 分 20 秒" set as boxes comes out as "3分20秒"
            className="inline-block whitespace-pre"
            initial={{ opacity: 0, y: 5, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -5, filter: 'blur(4px)', position: 'absolute' }}
            transition={{
              duration: 0.22,
              ease: [0.32, 0.72, 0, 1],
              layout: { duration: 0.3, ease: [0.32, 0.72, 0, 1] },
            }}
          >
            {piece}
          </motion.span>
        </AnimatePresence>
      ))}
    </motion.span>
  )
}
