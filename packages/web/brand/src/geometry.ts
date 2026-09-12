// The Qualy mark, as numbers.
//
// A ring with one segment missing, and that segment slid out along the
// direction of the gap to become the tail of a Q. Ring and tail are one
// part: the loader is the same part going round the same track. Every
// length is a multiple of s, the line width. Outer radius 3s, inner 2s; the
// gap is 45 degrees wide and centred on 45 degrees in screen terms (y down,
// angles clockwise from +x), so it spans 22.5 to 67.5 degrees; the tail is
// the gap's own segment moved 1.5s along that same direction. The canvas is
// the 8s square around the ring's centre, which puts the centre at 50% 50%
// of it - the loader's rotation origin.
//
// Everything is a fill, never a stroke, and the cuts are radial with no
// rounding. Numbers are fixed to three decimals so the strings come out the
// same on every run and every machine.

export interface Point {
  readonly x: number
  readonly y: number
}

export interface MarkOptions {
  /** the module: line width, and the unit of every other length */
  readonly s?: number
  /** where the ring's centre sits; the centre of the 8s canvas by default */
  readonly center?: Point
}

export interface MarkGeometry {
  readonly s: number
  readonly center: Point
  /** the 8s square around the centre */
  readonly viewBox: string
  /** the ring with its gap */
  readonly ring: string
  /** the tail: the gap's own segment, displaced along the gap direction */
  readonly piece: string
  /** the same segment before it slides out, sitting in the gap */
  readonly pieceHome: string
  /** the full ring with no gap, the loader's track */
  readonly track: string
  /** how far the tail slides, in absolute units */
  readonly offset: Point
}

const OUTER = 3
const INNER = 2
const GAP_START = 22.5
const GAP_END = 67.5
const GAP_DIRECTION = 45
const SLIDE = 1.5

const radians = (degrees: number) => (degrees * Math.PI) / 180

/** how far the tail reaches from the centre along either axis, in s */
export const pieceReach =
  OUTER * Math.cos(radians(GAP_START)) + SLIDE * Math.cos(radians(GAP_DIRECTION))

/** a number as it is written into a path: three decimals, no negative zero */
export const fixed = (value: number): string => {
  const rounded = Math.round(value * 1000) / 1000
  return String(rounded === 0 ? 0 : rounded)
}

const at = (center: Point, radius: number, degrees: number): Point => ({
  x: center.x + radius * Math.cos(radians(degrees)),
  y: center.y + radius * Math.sin(radians(degrees)),
})

const xy = (point: Point) => `${fixed(point.x)} ${fixed(point.y)}`

const arc = (radius: number, large: 0 | 1, sweep: 0 | 1, to: Point) =>
  `A${fixed(radius)} ${fixed(radius)} 0 ${large} ${sweep} ${xy(to)}`

/** the ring: outer arc the long way round, radial cut, inner arc back */
const band = (center: Point, s: number): string => {
  const outer = OUTER * s
  const inner = INNER * s
  return [
    `M${xy(at(center, outer, GAP_END))}`,
    arc(outer, 1, 1, at(center, outer, GAP_START)),
    `L${xy(at(center, inner, GAP_START))}`,
    arc(inner, 1, 0, at(center, inner, GAP_END)),
    'Z',
  ].join('')
}

/** the segment that fills the gap: the same band, the short way round */
const segment = (center: Point, s: number): string => {
  const outer = OUTER * s
  const inner = INNER * s
  return [
    `M${xy(at(center, outer, GAP_START))}`,
    arc(outer, 0, 1, at(center, outer, GAP_END)),
    `L${xy(at(center, inner, GAP_END))}`,
    arc(inner, 0, 0, at(center, inner, GAP_START)),
    'Z',
  ].join('')
}

/** the whole ring: outer circle one way, inner circle the other, so the non-zero rule leaves the band */
const annulus = (center: Point, s: number): string => {
  const outer = OUTER * s
  const inner = INNER * s
  return [
    `M${xy(at(center, outer, 0))}`,
    arc(outer, 1, 1, at(center, outer, 180)),
    arc(outer, 1, 1, at(center, outer, 0)),
    'Z',
    `M${xy(at(center, inner, 0))}`,
    arc(inner, 1, 0, at(center, inner, 180)),
    arc(inner, 1, 0, at(center, inner, 0)),
    'Z',
  ].join('')
}

export function markGeometry(options: MarkOptions = {}): MarkGeometry {
  const s = options.s ?? 16
  const center = options.center ?? { x: 4 * s, y: 4 * s }
  const offset = {
    x: SLIDE * s * Math.cos(radians(GAP_DIRECTION)),
    y: SLIDE * s * Math.sin(radians(GAP_DIRECTION)),
  }
  return {
    s,
    center,
    viewBox: `${fixed(center.x - 4 * s)} ${fixed(center.y - 4 * s)} ${fixed(8 * s)} ${fixed(8 * s)}`,
    ring: band(center, s),
    piece: segment({ x: center.x + offset.x, y: center.y + offset.y }, s),
    pieceHome: segment(center, s),
    track: annulus(center, s),
    offset,
  }
}
