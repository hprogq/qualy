// The Qualy mark and wordmark, as numbers.
//
// A ring of eight identical sectors with one of them - the tail - slid out
// along the direction it faces, so the ring has a gap and the Q has its
// tail from the same part. Every length is a multiple of s, the line width.
// Screen coordinates throughout: x to the right, y down, angles clockwise
// from +x. The ring's outer contour is the circle of radius 3s; its inner
// contour is the ellipse rx 2s, ry 2.1s, so the horizontal strokes of the
// ring come out a tenth thinner than the vertical ones - the usual optical
// correction for a round shape standing beside straight stems. Sector k
// spans 22.5 + 45k to 67.5 + 45k degrees; sector 0 faces 45 degrees, lower
// right, and is the one that becomes the tail by moving 1.5s that way.
// Because the inner contour is an ellipse the sectors are not rotated
// copies: each one meets the same ellipse at its own angles.
//
// The letters u a l y are built from the same vocabulary and nothing else:
// round bands, straight stems, flat cuts. Their spacing is not a table but
// a rule, applied at run time (see wordmarkLayout): the white between
// neighbours is measured on scanlines across the x-height and set to one
// frozen amount.
//
// Everything is a fill under the non-zero rule - positive contours run
// clockwise on screen, holes counter-clockwise, and a stem laid over a
// band simply adds to it. Numbers are fixed to three decimals so the
// strings come out the same on every run and every machine.

export interface Point {
  readonly x: number
  readonly y: number
}

/** a number as it is written into a path: three decimals, no negative zero */
export const fixed = (value: number): string => {
  const rounded = Math.round(value * 1000) / 1000
  return String(rounded === 0 ? 0 : rounded)
}

const radians = (degrees: number) => (degrees * Math.PI) / 180

// ---------------------------------------------------------------------------
// the ring

const OUTER = 3
const INNER = 2
/** ry over rx of an inner contour, the ring's and the bowls' alike */
export const INNER_STRETCH = 1.05
export const SEGMENTS = 8
const SECTOR = 360 / SEGMENTS
const SECTOR_START = 22.5
/** the direction the tail faces and moves in, degrees */
const TAIL_DIRECTION = 45
/** how far the tail moves, in s */
export const SLIDE = 1.5

/** where the ray at `degrees` from the origin meets the axis-aligned ellipse rx, ry */
const onEllipse = (rx: number, ry: number, degrees: number): Point => {
  const t = radians(degrees)
  const r = (rx * ry) / Math.hypot(ry * Math.cos(t), rx * Math.sin(t))
  return { x: r * Math.cos(t), y: r * Math.sin(t) }
}

const shift = (point: Point, by: Point): Point => ({ x: point.x + by.x, y: point.y + by.y })
const xy = (point: Point) => `${fixed(point.x)} ${fixed(point.y)}`

export interface RingOptions {
  /** ry over rx of the inner contour */
  readonly innerStretch?: number
  /** where the ring's centre sits */
  readonly center?: Point
  /** how far the sector is displaced from the ring, in absolute units */
  readonly offset?: Point
}

/** the tail's displacement for a module s */
export const tailOffset = (s: number): Point => ({
  x: SLIDE * s * Math.cos(radians(TAIL_DIRECTION)),
  y: SLIDE * s * Math.sin(radians(TAIL_DIRECTION)),
})

/**
 * One sector of the ring: outer arc clockwise, radial cut in, inner arc
 * back counter-clockwise, radial cut out.
 */
export function sectorPath(k: number, s: number, options: RingOptions = {}): string {
  const stretch = options.innerStretch ?? INNER_STRETCH
  const center = shift(options.center ?? { x: 0, y: 0 }, options.offset ?? { x: 0, y: 0 })
  const from = SECTOR_START + SECTOR * k
  const to = from + SECTOR
  const outer = OUTER * s
  const rx = INNER * s
  const ry = rx * stretch
  const at = (radius: number, ryOf: number, degrees: number) =>
    shift(onEllipse(radius, ryOf, degrees), center)
  return [
    `M${xy(at(outer, outer, from))}`,
    `A${fixed(outer)} ${fixed(outer)} 0 0 1 ${xy(at(outer, outer, to))}`,
    `L${xy(at(rx, ry, to))}`,
    `A${fixed(rx)} ${fixed(ry)} 0 0 0 ${xy(at(rx, ry, from))}`,
    'Z',
  ].join('')
}

/**
 * Sectors 1 to 7 as one path: the band from 67.5 degrees the long way
 * round to 382.5. The static mark and wordmark draw the ring with this,
 * because seven fills that share edges leave hairlines where they meet
 * and one fill leaves none; only the loader and the live wordmark, which
 * need every sector to carry its own opacity, draw the sectors apart.
 */
export function bandPath(
  s: number,
  options: Pick<RingOptions, 'innerStretch' | 'center'> = {},
): string {
  const stretch = options.innerStretch ?? INNER_STRETCH
  const center = options.center ?? { x: 0, y: 0 }
  const from = SECTOR_START + SECTOR
  const to = SECTOR_START + 360
  const outer = OUTER * s
  const rx = INNER * s
  const ry = rx * stretch
  const at = (radius: number, ryOf: number, degrees: number) =>
    shift(onEllipse(radius, ryOf, degrees), center)
  return [
    `M${xy(at(outer, outer, from))}`,
    `A${fixed(outer)} ${fixed(outer)} 0 1 1 ${xy(at(outer, outer, to))}`,
    `L${xy(at(rx, ry, to))}`,
    `A${fixed(rx)} ${fixed(ry)} 0 1 0 ${xy(at(rx, ry, from))}`,
    'Z',
  ].join('')
}

export interface MarkPaths {
  readonly s: number
  readonly center: Point
  /** the 8s square around the centre */
  readonly viewBox: string
  /** index 0 is the tail, already displaced; 1 to 7 are the sectors left on the ring */
  readonly segments: readonly string[]
  /** sectors 1 to 7 as one path, for the static drawing */
  readonly band: string
  /** the tail, the same path as segments[0] */
  readonly tail: string
  readonly tailOffset: Point
}

/** the tail's farthest reach from the centre along either axis, in s */
export const reach =
  OUTER * Math.cos(radians(SECTOR_START)) + SLIDE * Math.cos(radians(TAIL_DIRECTION))

/** the eight segments of the mark around a centre, the tail slid out */
export function segmentsAround(
  center: Point,
  s: number,
  innerStretch = INNER_STRETCH,
): readonly string[] {
  const offset = tailOffset(s)
  return Array.from({ length: SEGMENTS }, (_, k) =>
    sectorPath(k, s, { center, innerStretch, ...(k === 0 ? { offset } : {}) }),
  )
}

/** the static mark on its 8s canvas */
export function markPaths(
  s = 16,
  options: Pick<RingOptions, 'innerStretch' | 'center'> = {},
): MarkPaths {
  const center = options.center ?? { x: 4 * s, y: 4 * s }
  const segments = segmentsAround(center, s, options.innerStretch)
  return {
    s,
    center,
    viewBox: `${fixed(center.x - 4 * s)} ${fixed(center.y - 4 * s)} ${fixed(8 * s)} ${fixed(8 * s)}`,
    segments,
    band: bandPath(s, { center, innerStretch: options.innerStretch }),
    tail: segments[0]!,
    tailOffset: tailOffset(s),
  }
}

// ---------------------------------------------------------------------------
// the letters, each drawn with its box's left edge at x and the baseline at y = 0

/** cap height in s: the ring's 6s overshoots it by 3% top and bottom together */
export const CAP = 6 / 1.03
/** x-height in s */
export const X_HEIGHT = 4
/** a bowl's outer radius in s; its inner contour is the ellipse s by s times the stretch */
const BOWL = 2
/** how far the y's stem descends below the baseline, in s */
const DESCENT = 1.5

export type Letter = 'u' | 'a' | 'l' | 'y'

const stem = (x: number, top: number, bottom: number, s: number) =>
  `M${fixed(x)} ${fixed(top)}L${fixed(x + s)} ${fixed(top)}L${fixed(x + s)} ${fixed(bottom)}L${fixed(x)} ${fixed(bottom)}Z`

/**
 * The u: two stems down from the x-height to the bowl's centre line, joined
 * by the lower half of the bowl's band; one contour, clockwise.
 */
const cup = (x: number, s: number, stretch: number): string => {
  const mid = -BOWL * s
  const top = -X_HEIGHT * s
  const rx = s
  const ry = s * stretch
  return [
    `M${fixed(x)} ${fixed(top)}`,
    `L${fixed(x + s)} ${fixed(top)}`,
    `L${fixed(x + s)} ${fixed(mid)}`,
    `A${fixed(rx)} ${fixed(ry)} 0 0 0 ${fixed(x + 3 * s)} ${fixed(mid)}`,
    `L${fixed(x + 3 * s)} ${fixed(top)}`,
    `L${fixed(x + 4 * s)} ${fixed(top)}`,
    `L${fixed(x + 4 * s)} ${fixed(mid)}`,
    `A${fixed(BOWL * s)} ${fixed(BOWL * s)} 0 0 1 ${fixed(x)} ${fixed(mid)}`,
    'Z',
  ].join('')
}

/** the a: the whole bowl band, with a stem down its right side over the band */
const bowlWithStem = (x: number, s: number, stretch: number): string => {
  const mid = -BOWL * s
  const outer = BOWL * s
  const rx = s
  const ry = s * stretch
  return [
    `M${fixed(x + 4 * s)} ${fixed(mid)}`,
    `A${fixed(outer)} ${fixed(outer)} 0 1 1 ${fixed(x)} ${fixed(mid)}`,
    `A${fixed(outer)} ${fixed(outer)} 0 1 1 ${fixed(x + 4 * s)} ${fixed(mid)}`,
    'Z',
    `M${fixed(x + 3 * s)} ${fixed(mid)}`,
    `A${fixed(rx)} ${fixed(ry)} 0 1 0 ${fixed(x + s)} ${fixed(mid)}`,
    `A${fixed(rx)} ${fixed(ry)} 0 1 0 ${fixed(x + 3 * s)} ${fixed(mid)}`,
    'Z',
    stem(x + 3 * s, -X_HEIGHT * s, 0, s),
  ].join('')
}

export function letterPath(letter: Letter, x: number, s: number, stretch = INNER_STRETCH): string {
  switch (letter) {
    case 'u':
      return cup(x, s, stretch)
    case 'a':
      return bowlWithStem(x, s, stretch)
    case 'l':
      return stem(x, -CAP * s, 0, s)
    case 'y':
      return cup(x, s, stretch) + stem(x + 3 * s, -X_HEIGHT * s, DESCENT * s, s)
  }
}

export interface Box {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

/** the box a letter occupies, drawn at x */
export function letterBox(letter: Letter, x: number, s: number): Box {
  switch (letter) {
    case 'u':
      return { left: x, top: -X_HEIGHT * s, right: x + 4 * s, bottom: 0 }
    case 'a':
      return { left: x, top: -X_HEIGHT * s, right: x + 4 * s, bottom: 0 }
    case 'l':
      return { left: x, top: -CAP * s, right: x + s, bottom: 0 }
    case 'y':
      return { left: x, top: -X_HEIGHT * s, right: x + 4 * s, bottom: DESCENT * s }
  }
}

// ---------------------------------------------------------------------------
// profiles: where an element's silhouette is on a horizontal line

/** the leftmost and rightmost x of a shape on the line y; undefined where it has none */
export interface Profile {
  readonly left: (y: number) => number | undefined
  readonly right: (y: number) => number | undefined
}

/** how far a bowl's outer circle sits inside its box on the line y: 0 at the centre line, 2s at top and bottom */
const bowlInset = (y: number, s: number): number | undefined => {
  const dy = y + BOWL * s
  const r = BOWL * s
  if (Math.abs(dy) > r) return undefined
  return r - Math.sqrt(r * r - dy * dy)
}

/** a letter's silhouette, drawn at x */
export function letterProfile(letter: Letter, x: number, s: number): Profile {
  const box = letterBox(letter, x, s)
  const inside = (y: number) => y >= box.top && y <= box.bottom
  const round = (y: number) => bowlInset(y, s)
  switch (letter) {
    case 'u':
    case 'y': {
      // stems above the bowl's centre line, the band below it; the y's
      // right stem carries on down past the baseline
      const left = (y: number) =>
        !inside(y) ? undefined : y <= -BOWL * s ? x : x + (round(y) ?? 0)
      const right = (y: number) =>
        !inside(y)
          ? undefined
          : letter === 'y' || y <= -BOWL * s
            ? x + 4 * s
            : x + 4 * s - (round(y) ?? 0)
      return { left, right }
    }
    case 'a':
      return {
        left: (y) => (inside(y) ? x + (round(y) ?? 0) : undefined),
        right: (y) => (inside(y) ? x + 4 * s : undefined),
      }
    case 'l':
      return {
        left: (y) => (inside(y) ? x : undefined),
        right: (y) => (inside(y) ? x + s : undefined),
      }
  }
}

/** the Q's silhouette, with the tail's own right edge kept apart for the clearance rule */
export interface QProfile extends Profile {
  /** the tail's right edge on the line y; undefined above and below it */
  readonly tail: (y: number) => number | undefined
  readonly tailTop: number
  readonly tailBottom: number
}

/** the Q's silhouette: the ring's circle, and the tail where it reaches past it */
export function qProfile(center: Point, s: number, innerStretch = INNER_STRETCH): QProfile {
  const outer = OUTER * s
  const ring = (y: number, side: 1 | -1) => {
    const dy = y - center.y
    if (Math.abs(dy) > outer) return undefined
    return center.x + side * Math.sqrt(outer * outer - dy * dy)
  }
  // the tail's right edge, top to bottom: the radial cut at 22.5 degrees
  // from its inner corner to its outer corner, then the outer arc down to
  // the corner at 67.5 degrees
  const tailCenter = shift(center, tailOffset(s))
  const innerCorner = shift(
    onEllipse(INNER * s, INNER * s * innerStretch, SECTOR_START),
    tailCenter,
  )
  const outerCorner = shift(onEllipse(outer, outer, SECTOR_START), tailCenter)
  const tailBottom = tailCenter.y + outer * Math.sin(radians(SECTOR_START + SECTOR))
  const tail = (y: number): number | undefined => {
    if (y >= innerCorner.y && y <= outerCorner.y) {
      const t = (y - innerCorner.y) / (outerCorner.y - innerCorner.y)
      return innerCorner.x + t * (outerCorner.x - innerCorner.x)
    }
    if (y > outerCorner.y && y <= tailBottom) {
      const dy = y - tailCenter.y
      return tailCenter.x + Math.sqrt(outer * outer - dy * dy)
    }
    return undefined
  }
  const larger = (a: number | undefined, b: number | undefined) =>
    a === undefined ? b : b === undefined ? a : Math.max(a, b)
  return {
    left: (y) => ring(y, -1),
    right: (y) => larger(ring(y, 1), tail(y)),
    tail,
    tailTop: innerCorner.y,
    tailBottom,
  }
}

// ---------------------------------------------------------------------------
// spacing by white, not by distance

export type Pair = 'Qu' | 'ua' | 'al' | 'ly'
export const PAIRS: readonly Pair[] = ['Qu', 'ua', 'al', 'ly']

/** scanlines across the x-height band that the white is measured on */
const SCANLINES = 64
/** the most one scanline may count, in s: beyond this the eye no longer reads it as a gap */
const GAP_CAP = 2
/**
 * The white every pair is set to, in s.
 *
 * Frozen from the hand-laid reference: the u and the a at their reference
 * gap of 0.6s measure 1.141s of white by this rule, and 85% of that is
 * what the design settled on. Kept as an absolute so the spacing depends
 * on nothing but the letters.
 */
export const TARGET_WHITE = 0.97
/** what the tail must keep clear of the u on every scanline, in s */
const TAIL_CLEARANCE = 0.5

const scanlines = (s: number): readonly number[] =>
  Array.from(
    { length: SCANLINES },
    (_, i) => -X_HEIGHT * s + ((i + 0.5) * (X_HEIGHT * s)) / SCANLINES,
  )

/**
 * The white between two neighbours: the gap between the left one's right
 * silhouette and the right one's left silhouette, averaged over the
 * scanlines, each capped.
 */
export function whiteBetween(left: Profile, right: Profile, s: number): number {
  const lines = scanlines(s)
  let total = 0
  for (const y of lines) {
    const a = left.right(y)
    const b = right.left(y)
    total += Math.min(GAP_CAP * s, a === undefined || b === undefined ? GAP_CAP * s : b - a)
  }
  return total / lines.length
}

/** the x at which a letter's white against its left neighbour equals the target */
const placeFor = (
  neighbour: Profile,
  letter: Letter,
  target: number,
  s: number,
  from: number,
): number => {
  const white = (x: number) => whiteBetween(neighbour, letterProfile(letter, x, s), s)
  let lo = from - 4 * s
  let hi = from + 6 * s
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2
    if (white(mid) < target) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

export interface LetterPlacement {
  readonly char: Letter
  readonly x: number
  readonly d: string
  readonly box: Box
}

export interface WordmarkOptions {
  /** hand corrections added to a pair's spacing, in s */
  readonly kern?: Partial<Record<Pair, number>>
  readonly innerStretch?: number
  /** the white to set every pair to, in s; the frozen value unless a preview is turning the knob */
  readonly white?: number
}

export interface WordmarkLayout {
  readonly s: number
  readonly cap: number
  readonly xHeight: number
  readonly viewBox: string
  readonly ringCenter: Point
  /** the Q's eight segments, index 0 the tail */
  readonly segments: readonly string[]
  /** the Q's sectors 1 to 7 as one path, for the static drawing */
  readonly band: string
  readonly letters: readonly LetterPlacement[]
  /** the white each pair ended up with, in s */
  readonly whites: Readonly<Record<Pair, number>>
  /** the white every pair was set to, in s */
  readonly target: number
  /** the least the tail keeps clear of the u on any scanline, in s */
  readonly tailClearance: number
  /** from the ring's right edge to the u's left stem, in s */
  readonly ringToU: number
  /** where the white alone would have put the u, before the clearance rule, in s from the ring's right edge */
  readonly ringToUByWhite: number
  readonly kern: Readonly<Partial<Record<Pair, number>>>
}

export function wordmarkLayout(s = 16, options: WordmarkOptions = {}): WordmarkLayout {
  const kern = options.kern ?? {}
  const stretch = options.innerStretch ?? INNER_STRETCH
  const target = (options.white ?? TARGET_WHITE) * s
  const cap = CAP * s
  const ringCenter = { x: OUTER * s, y: -cap / 2 }
  const q = qProfile(ringCenter, s, stretch)

  // the u: by white first, then no closer to the tail than the clearance
  // allows on any scanline (the tail's own extent, with its corners, so the
  // nearest point cannot fall between two samples)
  const byWhite = placeFor(q, 'u', target, s, ringCenter.x + OUTER * s) + (kern.Qu ?? 0) * s
  const uAtOrigin = letterProfile('u', 0, s)
  const tailLines = [
    q.tailTop,
    q.tailBottom,
    ...Array.from(
      { length: 256 },
      (_, i) => q.tailTop + ((i + 0.5) * (q.tailBottom - q.tailTop)) / 256,
    ),
  ].filter((y) => y <= 0)
  let byClearance = -Infinity
  for (const y of tailLines) {
    const edge = q.tail(y)
    const inset = uAtOrigin.left(y)
    if (edge === undefined || inset === undefined) continue
    byClearance = Math.max(byClearance, edge + TAIL_CLEARANCE * s - inset)
  }
  const xu = Math.max(byWhite, byClearance)

  const u = letterProfile('u', xu, s)
  const xa = placeFor(u, 'a', target, s, xu + 4 * s) + (kern.ua ?? 0) * s
  const a = letterProfile('a', xa, s)
  const xl = placeFor(a, 'l', target, s, xa + 4 * s) + (kern.al ?? 0) * s
  const l = letterProfile('l', xl, s)
  const xy = placeFor(l, 'y', target, s, xl + s) + (kern.ly ?? 0) * s
  const y = letterProfile('y', xy, s)

  let tailClearance = Infinity
  for (const line of tailLines) {
    const edge = q.tail(line)
    const inset = u.left(line)
    if (edge === undefined || inset === undefined) continue
    tailClearance = Math.min(tailClearance, inset - edge)
  }

  const placements: LetterPlacement[] = (
    [
      ['u', xu],
      ['a', xa],
      ['l', xl],
      ['y', xy],
    ] as const
  ).map(([char, x]) => ({
    char,
    x,
    d: letterPath(char, x, s, stretch),
    box: letterBox(char, x, s),
  }))

  const top = ringCenter.y - OUTER * s
  const bottom = Math.max(DESCENT * s, q.tailBottom)
  const right = xy + 4 * s
  return {
    s,
    cap,
    xHeight: X_HEIGHT * s,
    viewBox: `0 ${fixed(top)} ${fixed(right)} ${fixed(bottom - top)}`,
    ringCenter,
    segments: segmentsAround(ringCenter, s, stretch),
    band: bandPath(s, { center: ringCenter, innerStretch: stretch }),
    letters: placements,
    whites: {
      Qu: whiteBetween(q, u, s) / s,
      ua: whiteBetween(u, a, s) / s,
      al: whiteBetween(a, l, s) / s,
      ly: whiteBetween(l, y, s) / s,
    },
    target: target / s,
    tailClearance: tailClearance / s,
    ringToU: (xu - (ringCenter.x + OUTER * s)) / s,
    ringToUByWhite: (byWhite - (ringCenter.x + OUTER * s)) / s,
    kern,
  }
}
