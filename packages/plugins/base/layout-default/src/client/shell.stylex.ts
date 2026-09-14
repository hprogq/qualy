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
})
