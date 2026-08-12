import { memo, useLayoutEffect, useRef, useState } from 'react'
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
// Nothing here animates layout. Layout animation means measuring every piece
// on every frame, and this redraws once a second on every card of a list -
// which was enough on its own to make every other animation on the page
// stutter. What moves is opacity, blur and a transform, all of which the
// compositor owns; the only measurement left is the line's own width, taken
// once per changed value so the box can still close a gap smoothly when a
// piece leaves.
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

// Memoised on the value, which is the whole input: a caller that re-renders
// on a clock would otherwise walk this tree every tick whether or not a single
// character moved.
export const Ticker = memo(function Ticker({
  value,
  className,
}: {
  /** the value, already formatted; a change is what animates */
  value: string
  className?: string
}) {
  const line = useRef<HTMLSpanElement>(null)
  const [width, setWidth] = useState<number | null>(null)
  useLayoutEffect(() => {
    // once per changed value rather than once per frame: the width is what a
    // leaving piece takes with it, and the box outside tweens to the new one
    if (line.current) setWidth(line.current.offsetWidth)
  }, [value])

  return (
    <span
      className={cn(
        'inline-block overflow-hidden align-bottom transition-[width] duration-300',
        className,
      )}
      style={width === null ? undefined : { width }}
    >
      <span ref={line} className="inline-flex tabular-nums whitespace-nowrap">
        {pieces(value).map((piece, at) => (
          // One slot per position, and the slot is what the leaving piece is
          // positioned against: taken out of the flow with nothing of its own
          // to sit in, it lands at the start of the line and the digit flies
          // across the words on its way out.
          <span key={at} className="relative inline-flex">
            {/* only the pieces whose text changed have anything to swap */}
            <AnimatePresence initial={false}>
              <motion.span
                key={piece}
                // pre, because a space at the edge of an inline block is
                // trimmed: "3 分 20 秒" set as boxes comes out as "3分20秒"
                className="inline-block whitespace-pre"
                initial={{ opacity: 0, y: 5, filter: 'blur(4px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                exit={{
                  opacity: 0,
                  y: -5,
                  filter: 'blur(4px)',
                  position: 'absolute',
                  left: 0,
                  top: 0,
                }}
                transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
              >
                {piece}
              </motion.span>
            </AnimatePresence>
          </span>
        ))}
      </span>
    </span>
  )
})
