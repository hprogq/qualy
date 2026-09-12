import { describe, expect, it } from 'vitest'

import {
  bandPath,
  CAP,
  INNER_STRETCH,
  letterBox,
  letterPath,
  markPaths,
  reach,
  sectorPath,
  SEGMENTS,
  TARGET_WHITE,
  wordmarkLayout,
} from '../src/geometry.ts'

// The mark and the wordmark as the numbers say they are: no pixels, only
// the path strings and what they have to satisfy.

interface Point {
  x: number
  y: number
}

/** every point a path lands on: the end of each M, L and A command */
const landings = (d: string): Point[] =>
  [...d.matchAll(/[MLA]([^MLAZ]+)/g)].map((match) => {
    const numbers = match[1]!.trim().split(/\s+/).map(Number)
    return { x: numbers.at(-2)!, y: numbers.at(-1)! }
  })

const s = 16
const R = 3 * s
const rx = 2 * s
const ry = rx * INNER_STRETCH
const radians = (degrees: number) => (degrees * Math.PI) / 180

describe('the eight sectors', () => {
  const center = { x: 64, y: 64 }
  const sectors = Array.from({ length: SEGMENTS }, (_, k) => sectorPath(k, s, { center }))

  it('start and end where the specification says', () => {
    // sector 0 on the 128 canvas: outer arc from 22.5 to 67.5 degrees
    const [start, end] = landings(sectors[0]!)
    expect(start!.x).toBeCloseTo(108.35, 2)
    expect(start!.y).toBeCloseTo(82.37, 2)
    expect(end!.x).toBeCloseTo(82.37, 2)
    expect(end!.y).toBeCloseTo(108.35, 2)
  })

  it('keep their outer corners on the circle and their inner corners on the ellipse', () => {
    for (const d of sectors) {
      const [outerStart, outerEnd, innerEnd, innerStart] = landings(d)
      for (const point of [outerStart!, outerEnd!]) {
        expect(Math.hypot(point.x - center.x, point.y - center.y)).toBeCloseTo(R, 2)
      }
      for (const point of [innerStart!, innerEnd!]) {
        const dx = (point.x - center.x) / rx
        const dy = (point.y - center.y) / ry
        expect(dx * dx + dy * dy).toBeCloseTo(1, 3)
      }
      // radial cuts: each inner corner lies on the ray through its outer
      // corner, as closely as three decimals in the path allow
      const ray = (a: Point, b: Point) =>
        Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x)
      expect(ray(outerStart!, innerStart!)).toBeCloseTo(0, 4)
      expect(ray(outerEnd!, innerEnd!)).toBeCloseTo(0, 4)
    }
  })

  it('tile the whole band: each one ends exactly where the next begins', () => {
    for (let k = 0; k < SEGMENTS; k += 1) {
      const [, outerEnd, innerEnd] = landings(sectors[k]!)
      const [outerStart, , , innerStart] = landings(sectors[(k + 1) % SEGMENTS]!)
      expect(outerEnd).toEqual(outerStart)
      expect(innerEnd).toEqual(innerStart)
    }
  })

  it('add up to the area of the band', () => {
    // each sector, as the region between the circle and the ellipse over
    // its own 45 degrees, integrated in polar form; eight of them must be
    // the whole band, pi (R^2 - rx ry)
    const inner = (t: number) => (rx * ry) / Math.hypot(ry * Math.cos(t), rx * Math.sin(t))
    let total = 0
    for (let k = 0; k < SEGMENTS; k += 1) {
      const from = radians(22.5 + 45 * k)
      const steps = 2000
      const width = radians(45) / steps
      for (let i = 0; i < steps; i += 1) {
        const t = from + (i + 0.5) * width
        total += 0.5 * (R * R - inner(t) ** 2) * width
      }
    }
    expect(total).toBeCloseTo(Math.PI * (R * R - rx * ry), 3)
  })

  it('are what the one-piece band is made of', () => {
    // the band runs from where sector 1 starts to where sector 7 ends, on
    // the same circle and the same ellipse, so the static drawing and the
    // segmented one are the same shape
    const [outerStart, outerEnd, innerEnd, innerStart] = landings(bandPath(s, { center }))
    expect(outerStart).toEqual(landings(sectors[1]!)[0])
    expect(outerEnd).toEqual(landings(sectors[7]!)[1])
    expect(innerEnd).toEqual(landings(sectors[7]!)[2])
    expect(innerStart).toEqual(landings(sectors[1]!)[3])
    expect(bandPath(s, { center })).toMatch(/A48 48 0 1 1 .*A32 33.6 0 1 0 /)
  })

  it('are the same string on every call', () => {
    expect(sectorPath(3, 7, { center: { x: 1, y: 2 } })).toBe(
      sectorPath(3, 7, { center: { x: 1, y: 2 } }),
    )
    expect(markPaths()).toEqual(markPaths())
  })
})

describe('the mark', () => {
  const mark = markPaths(16)

  it('has the tail slid 1.5s along 45 degrees and nothing else moved', () => {
    const slide = 1.5 * 16 * Math.SQRT1_2
    expect(mark.tailOffset.x).toBeCloseTo(slide, 3)
    expect(mark.tailOffset.y).toBeCloseTo(slide, 3)
    const home = landings(sectorPath(0, 16, { center: mark.center }))
    const out = landings(mark.segments[0]!)
    home.forEach((point, at) => {
      expect(out[at]!.x - point.x).toBeCloseTo(slide, 2)
      expect(out[at]!.y - point.y).toBeCloseTo(slide, 2)
    })
    for (let k = 1; k < SEGMENTS; k += 1) {
      expect(mark.segments[k]).toBe(sectorPath(k, 16, { center: mark.center }))
    }
    expect(mark.tail).toBe(mark.segments[0])
    expect(mark.band).toBe(bandPath(16, { center: mark.center }))
  })

  it('keeps every corner inside the 8s canvas', () => {
    expect(mark.viewBox).toBe('0 0 128 128')
    for (const d of mark.segments) {
      for (const point of landings(d)) {
        expect(point.x).toBeGreaterThanOrEqual(0)
        expect(point.x).toBeLessThanOrEqual(128)
        expect(point.y).toBeGreaterThanOrEqual(0)
        expect(point.y).toBeLessThanOrEqual(128)
      }
    }
    expect(reach).toBeCloseTo(3.832, 3)
    expect(reach).toBeLessThan(4)
  })
})

describe('the letters', () => {
  it('occupy the boxes the specification gives them', () => {
    expect(letterBox('u', 10, s)).toEqual({ left: 10, top: -64, right: 74, bottom: 0 })
    expect(letterBox('a', 10, s)).toEqual({ left: 10, top: -64, right: 74, bottom: 0 })
    expect(letterBox('l', 10, s)).toEqual({ left: 10, top: -CAP * s, right: 26, bottom: 0 })
    expect(letterBox('y', 10, s)).toEqual({ left: 10, top: -64, right: 74, bottom: 24 })
    expect(CAP * s).toBeCloseTo(93.2, 1)
  })

  it('land every corner inside their box', () => {
    for (const letter of ['u', 'a', 'l', 'y'] as const) {
      const box = letterBox(letter, 100, s)
      // within the half-thousandth the path's rounding allows
      for (const point of landings(letterPath(letter, 100, s))) {
        expect(point.x).toBeGreaterThanOrEqual(box.left - 0.0005)
        expect(point.x).toBeLessThanOrEqual(box.right + 0.0005)
        expect(point.y).toBeGreaterThanOrEqual(box.top - 0.0005)
        expect(point.y).toBeLessThanOrEqual(box.bottom + 0.0005)
      }
    }
  })

  it('match the reference drawing at s = 16 with the baseline at 120', () => {
    // the design's hand-written u is M110 56 H126 V88 A16 16 0 0 0 158 88
    // V56 H174 V88 A32 32 0 0 1 110 88 Z: the corners are the same, only
    // the inner arc's radii differ
    const u = landings(letterPath('u', 110, s)).map((point) => ({ x: point.x, y: point.y + 120 }))
    expect(u).toEqual([
      { x: 110, y: 56 },
      { x: 126, y: 56 },
      { x: 126, y: 88 },
      { x: 158, y: 88 },
      { x: 158, y: 56 },
      { x: 174, y: 56 },
      { x: 174, y: 88 },
      { x: 110, y: 88 },
    ])
    const l = landings(letterPath('l', 261.2, s)).map((point) => ({ x: point.x, y: point.y + 120 }))
    expect(l[0]!.y).toBeCloseTo(26.8, 1)
    expect(l[1]!.x).toBeCloseTo(277.2, 3)
    const y = landings(letterPath('y', 290.8, s)).map((point) => ({ x: point.x, y: point.y + 120 }))
    expect(y.at(-1)).toEqual({ x: 338.8, y: 144 })
  })
})

describe('the wordmark layout', () => {
  const layout = wordmarkLayout(16)

  it('is the same on every call and tighter for less white', () => {
    expect(wordmarkLayout(16)).toEqual(layout)
    expect(wordmarkLayout(16, { white: 0.85 }).letters[1]!.x).toBeLessThan(layout.letters[1]!.x)
  })

  it('gives every pair the frozen white, the Q-u no less', () => {
    expect(layout.target).toBe(TARGET_WHITE)
    for (const pair of ['ua', 'al', 'ly'] as const) {
      expect(layout.whites[pair]).toBeCloseTo(TARGET_WHITE, 4)
    }
    expect(layout.whites.Qu).toBeGreaterThanOrEqual(TARGET_WHITE - 1e-4)
  })

  it('keeps the tail clear of the u and the u near the ring', () => {
    expect(layout.tailClearance).toBeGreaterThanOrEqual(0.5 - 1e-6)
    expect(layout.ringToU).toBeGreaterThanOrEqual(0.6)
    expect(layout.ringToU).toBeLessThanOrEqual(0.9)
  })

  it('puts the ring where a capital stands and frames the content tightly', () => {
    expect(layout.ringCenter).toEqual({ x: 48, y: -layout.cap / 2 })
    expect(layout.band).toBe(bandPath(16, { center: layout.ringCenter }))
    const [left, top, width, height] = layout.viewBox.split(' ').map(Number)
    expect(left).toBe(0)
    expect(top).toBeCloseTo(-layout.cap / 2 - 48, 3)
    expect(left! + width!).toBeCloseTo(layout.letters[3]!.box.right, 3)
    expect(top! + height!).toBeCloseTo(24, 3)
  })

  it('applies a kern to one pair only', () => {
    const kerned = wordmarkLayout(16, { kern: { al: 0.25 } })
    expect(kerned.letters[2]!.x - layout.letters[2]!.x).toBeCloseTo(4, 6)
    expect(kerned.letters[1]!.x).toBe(layout.letters[1]!.x)
    expect(kerned.letters[3]!.x - layout.letters[3]!.x).toBeCloseTo(4, 6)
  })
})
