import * as stylex from '@stylexjs/stylex'

/**
 * Announced, never shown: a label a screen reader reads and a screen does not.
 *
 * It is pinned to its containing block's own origin, which is the part that
 * is easy to leave out and expensive to leave out. An absolutely positioned
 * element with no positioned ancestor takes the page itself as its
 * containing block: it is not clipped by the scrolling region it appears to
 * be inside, and it parks at its static position - which, halfway down a long
 * page, is below the window. The document then grows to reach it, and the
 * screen carries a second scrollbar over a strip of nothing. Pinned, it can
 * only ever sit at the top-left of whatever block owns it, hidden either way.
 *
 * Stated once because it was stated eleven times, and every one of those was
 * one static ancestor away from doing the same thing.
 */
export const visuallyHidden = stylex.create({
  text: {
    position: 'absolute',
    insetBlockStart: 0,
    insetInlineStart: 0,
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: 'hidden',
    clipPath: 'inset(50%)',
    whiteSpace: 'nowrap',
    borderWidth: 0,
  },
})
