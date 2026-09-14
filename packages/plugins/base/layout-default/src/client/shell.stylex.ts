import * as stylex from '@stylexjs/stylex'

// Measurements two parts of the shell have to agree on.
//
// The bar at the foot of a narrow window draws itself this tall, and the
// page above it keeps exactly this much room free. A plain exported number
// cannot do that: the compiler reads a `stylex.create` at build time and
// only follows values it can resolve statically, which across files means
// a `.stylex.ts` module like this one. Written as a length, since that is
// what both sides of the agreement use it as.
export const shell = stylex.defineConsts({
  bottomBarHeight: '56px',
  // The bars at the head, which the page has to keep room for. They are the
  // bars' own declared heights, written here because two files need them:
  // the bars draw themselves this tall and the scroller opens exactly this
  // much at its top for them to float over. Measured at runtime too - a
  // rotation or a larger text setting can make them taller - but the
  // measurement only corrects what these already got right, so no frame is
  // ever laid out with the page under the bars.
  topBarHeight: '56px',
  phoneTopBarHeight: '48px',
  sectionBarHeight: '40px',
})
