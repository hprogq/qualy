import { describe, expect, it } from 'vitest'

import { markGeometry, pieceReach } from '../src/geometry.ts'

// The mark as the numbers say it is: no pixels, only the path strings and
// what they have to satisfy.

/** every point a path lands on: the end of each M, L and A command */
const landings = (d: string): { x: number; y: number }[] =>
  [...d.matchAll(/[MLA]([^MLAZ]+)/g)].map((match) => {
    const numbers = match[1]!.trim().split(/\s+/).map(Number)
    return { x: numbers.at(-2)!, y: numbers.at(-1)! }
  })

describe('the mark geometry', () => {
  it('is the same on every call', () => {
    expect(markGeometry()).toEqual(markGeometry())
    const placed = { s: 7, center: { x: 1, y: 2 } }
    expect(markGeometry(placed)).toEqual(markGeometry(placed))
    expect(markGeometry().ring).toMatch(/^M[\d.]+ [\d.]+A/)
  })

  it('starts the ring where the specification says', () => {
    // s = 16 on a 128 canvas: (64 + 48 cos 67.5, 64 + 48 sin 67.5)
    const first = landings(markGeometry().ring)[0]!
    expect(first.x).toBeCloseTo(82.37, 2)
    expect(first.y).toBeCloseTo(108.35, 2)
  })

  it('keeps every part inside the 8s canvas', () => {
    const geometry = markGeometry({ s: 16 })
    expect(geometry.viewBox).toBe('0 0 128 128')
    for (const d of [geometry.ring, geometry.piece, geometry.pieceHome, geometry.track]) {
      const points = landings(d)
      expect(points.length).toBeGreaterThan(0)
      for (const point of points) {
        expect(point.x).toBeGreaterThanOrEqual(0)
        expect(point.x).toBeLessThanOrEqual(128)
        expect(point.y).toBeGreaterThanOrEqual(0)
        expect(point.y).toBeLessThanOrEqual(128)
      }
    }
    // the tail's farthest reach along an axis, in s: under the 4s half-edge
    expect(pieceReach).toBeCloseTo(3.832, 3)
    expect(pieceReach).toBeLessThan(4)
  })

  it('slides the tail 1.5s along the direction of the gap', () => {
    const geometry = markGeometry({ s: 16 })
    const slide = 1.5 * 16 * Math.SQRT1_2
    expect(geometry.offset.x).toBeCloseTo(slide, 3)
    expect(geometry.offset.y).toBeCloseTo(slide, 3)
    const home = landings(geometry.pieceHome)
    const out = landings(geometry.piece)
    expect(out).toHaveLength(home.length)
    home.forEach((point, at) => {
      expect(out[at]!.x - point.x).toBeCloseTo(slide, 2)
      expect(out[at]!.y - point.y).toBeCloseTo(slide, 2)
    })
  })

  it('frames the 8s square around wherever the centre is put', () => {
    expect(markGeometry({ s: 10, center: { x: 30, y: -5 } }).viewBox).toBe('-10 -45 80 80')
  })
})
