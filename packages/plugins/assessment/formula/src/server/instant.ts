// A timestamp on its way out, as the api declares it.
//
// The driver hands back a `Date` for a timestamptz and a string when the row
// came through a path that did not decode it, and the wire shape is one
// string either way. Written twice in this plugin's two dto builders, which
// is once too many for a conversion whose whole content is "whichever of the
// two this is".

export const isoInstant = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString()
