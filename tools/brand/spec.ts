// The numbers the brand tools share.
//
// The first two are the only ones the specification leaves to the eye; they
// were settled against tools/brand/out/preview-*.png, and the committed
// wordmark was generated with the values here. Everything else is frozen by
// docs/brand.md.

/** clearance between the tail's rightmost point and the left edge of the u, in s */
export const TAIL_GAP = 0.5
/** taken off every advance, in em */
export const TRACKING = -0.02

/** the module of the wordmark's coordinates; 16 makes its ring the mark's own default */
export const WORDMARK_S = 16
/** where the weight equation is solved: the wght axis, one step at a time */
export const WEIGHT_RANGE = { min: 500, max: 700 }
/** six stems over the cap height: the ring overshoots the capitals by this */
export const RING_TO_CAP = 1.03
/** how far the closest weight may miss that before the ratio has to be reported */
export const TOLERANCE = 0.02
