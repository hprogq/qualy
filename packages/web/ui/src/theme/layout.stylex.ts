import * as stylex from '@stylexjs/stylex'

// The page's own margin on a narrow screen, named once.
//
// It grows a little with the screen rather than sitting at one number: a
// gutter drawn for a 390pt phone reads as the card being pressed against
// the glass on a 430pt one, where the same 16 is a smaller share of the
// width. A clamp rather than a breakpoint, because nothing about this
// changes at a threshold - it is one relationship held between a floor
// (320pt phones have no width to give away) and a ceiling (past 20 the
// page starts eating the line, and a long Chinese title wraps sooner).
//
// Anything that bleeds to the screen's edge and back - a track that
// scrolls sideways, a row of pills - takes this same value as its
// negative margin and its padding. Written out by hand the two drifted
// apart the moment the gutter moved, and the cards in the track sat four
// pixels off the column they are meant to line up with.
export const layout = stylex.defineConsts({
  pageGutter: 'clamp(16px, 4.5vw, 20px)',
})
