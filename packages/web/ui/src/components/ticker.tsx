import { memo, useLayoutEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import * as stylex from '@stylexjs/stylex'
import { clsx } from 'clsx'

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
// stutter. The only measurement left is the line's own width, taken once per
// changed value so the box can still close a gap smoothly when a piece
// leaves.
//
// Opacity and the transform are the compositor's. The blur is NOT, and no
// amount of `will-change` makes it so: a blur reads pixels from outside the
// element it is applied to, so chrome cannot hand the animation to the
// compositor and runs it on the main thread instead. It is here anyway, and
// deliberately - a digit that swaps hard is the flicker this component
// exists to remove - but it is the reason a lighthouse run reports these
// spans as non-composited, and it is what to drop first if this ever costs a
// frame on a long list.
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
const styles = stylex.create({
  box: {
    display: 'inline-block',
    overflow: 'hidden',
    verticalAlign: 'bottom',
    transitionProperty: 'width',
    transitionDuration: '300ms',
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
  line: {
    display: 'inline-flex',
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  },
  seat: {
    position: 'relative',
    display: 'inline-flex',
  },
  // pre, because a space at the edge of an inline block is trimmed:
  // "3 分 20 秒" set as boxes comes out as "3分20秒"
  glyph: {
    display: 'inline-block',
    whiteSpace: 'pre',
  },
  leavingGlyph: {
    pointerEvents: 'none',
    position: 'absolute',
    top: 0,
    left: 0,
    display: 'inline-block',
    whiteSpace: 'pre',
  },
})

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
    // The line is measured the moment the value changes, which is only right
    // because a leaving piece is out of the flow from its first frame (see
    // Piece). Left to an exit animation to take it out one frame later, this
    // measured both texts at once and the box kept the width of the two of
    // them - the stray gap at the end of the bar, and the overflow past it.
    if (line.current) setWidth(line.current.offsetWidth)
  }, [value])

  const sx = stylex.props(styles.box)
  return (
    <span
      {...sx}
      className={clsx(sx.className, className)}
      style={width === null ? undefined : { width }}
    >
      <span ref={line} {...stylex.props(styles.line)}>
        {pieces(value).map((piece, at) => (
          <Piece key={at} text={piece} />
        ))}
      </span>
    </span>
  )
})

const SWAP = { duration: 0.22, ease: [0.32, 0.72, 0, 1] } as const

/**
 * One position of the value, and the character leaving it.
 *
 * The two are tracked here rather than by AnimatePresence so that the one on
 * its way out is positioned from the first frame: an exit that becomes
 * absolute a frame later is a frame in which the line is twice as wide, and
 * whatever laid the line out has already measured it by then.
 */
function Piece({ text }: { text: string }) {
  const [shown, setShown] = useState(text)
  const [leaving, setLeaving] = useState<string | null>(null)
  if (text !== shown) {
    setLeaving(shown)
    setShown(text)
  }

  return (
    <span {...stylex.props(styles.seat)}>
      <motion.span
        key={shown}
        className={stylex.props(styles.glyph).className}
        initial={{ opacity: 0, y: 5, filter: 'blur(4px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={SWAP}
      >
        {shown}
      </motion.span>
      {leaving !== null && (
        <motion.span
          key={leaving}
          aria-hidden
          className={stylex.props(styles.leavingGlyph).className}
          initial={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          animate={{ opacity: 0, y: -5, filter: 'blur(4px)' }}
          transition={SWAP}
          onAnimationComplete={() => setLeaving(null)}
        >
          {leaving}
        </motion.span>
      )}
    </span>
  )
}
