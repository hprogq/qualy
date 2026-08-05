import { describe, expect, it } from 'vitest'
import {
  coveredBy,
  forestRoots,
  forestShape,
  subtreeCoveredBy,
  type ResolvedScope,
} from '../src/coverage.ts'

// The coverage rule, tested on its own rather than only through a database.
//
// It decides how much of the tree a caller sees, and one of its cases is on
// record as having gone wrong: a self anchor once read the whole subtree below
// it. That is not a crash, it is a caller quietly seeing more than they hold,
// so it needs a test that states the distinction directly.

const scope = (
  tenantWide: boolean,
  ...anchors: Array<[string, string, 'self' | 'subtree']>
): ResolvedScope => ({
  tenantWide,
  anchors: anchors.map(([id, path, coverage]) => ({ id, path, coverage })),
})

describe('what an anchor covers', () => {
  it('lets a self anchor cover its own node and nothing below it', () => {
    const held = scope(false, ['a', 'r.a', 'self'])
    expect(coveredBy(held, { id: 'a', path: 'r.a' })).toBe(true)
    // the recorded incident: this must not become true
    expect(coveredBy(held, { id: 'x', path: 'r.a.x' })).toBe(false)
    expect(subtreeCoveredBy(held, { path: 'r.a' })).toBe(false)
  })

  it('lets a subtree anchor cover itself and everything below', () => {
    const held = scope(false, ['a', 'r.a', 'subtree'])
    expect(coveredBy(held, { id: 'a', path: 'r.a' })).toBe(true)
    expect(coveredBy(held, { id: 'x', path: 'r.a.x' })).toBe(true)
    expect(subtreeCoveredBy(held, { path: 'r.a' })).toBe(true)
  })

  it('stops at a label boundary rather than a string prefix', () => {
    const held = scope(false, ['a', 'r.a', 'subtree'])
    // r.ab is a sibling, not a descendant, however much its path looks like one
    expect(coveredBy(held, { id: 'ab', path: 'r.ab' })).toBe(false)
    expect(subtreeCoveredBy(held, { path: 'r.ab' })).toBe(false)
  })

  it('matches a self anchor by id, so two nodes cannot share one', () => {
    const held = scope(false, ['a', 'r.a', 'self'])
    // same path, different node: only the anchored id is covered
    expect(coveredBy(held, { id: 'other', path: 'r.a' })).toBe(false)
  })

  it('gives tenant-wide authority everything, including subtree promises', () => {
    const held = scope(true)
    expect(coveredBy(held, { id: 'anything', path: 'r.z.q' })).toBe(true)
    expect(subtreeCoveredBy(held, { path: 'r.z.q' })).toBe(true)
  })

  it('covers nothing when no anchor was granted', () => {
    const held = scope(false)
    expect(coveredBy(held, { id: 'a', path: 'r.a' })).toBe(false)
    expect(subtreeCoveredBy(held, { path: 'r.a' })).toBe(false)
  })
})

describe('which anchors a projection actually reads', () => {
  it('lets a shallower subtree swallow a deeper one', () => {
    const shape = forestShape(scope(false, ['a', 'r.a', 'subtree'], ['x', 'r.a.x', 'subtree']))
    expect(shape.subtrees.map((anchor) => anchor.id)).toEqual(['a'])
    expect(shape.selves).toEqual([])
  })

  it('keeps sibling subtrees apart', () => {
    const shape = forestShape(scope(false, ['a', 'r.a', 'subtree'], ['b', 'r.b', 'subtree']))
    expect(shape.subtrees.map((anchor) => anchor.id).sort()).toEqual(['a', 'b'])
  })

  it('drops a self anchor that a kept subtree already contains', () => {
    const shape = forestShape(scope(false, ['a', 'r.a', 'subtree'], ['x', 'r.a.x', 'self']))
    expect(shape.selves).toEqual([])
  })

  it('keeps a self anchor no subtree contains', () => {
    const shape = forestShape(scope(false, ['a', 'r.a', 'subtree'], ['q', 'r.q', 'self']))
    expect(shape.selves.map((anchor) => anchor.id)).toEqual(['q'])
  })

  it('keeps a self anchor beside a subtree at the same path', () => {
    // the sibling-prefix case again, this time in the deduplication
    const shape = forestShape(scope(false, ['a', 'r.a', 'subtree'], ['ab', 'r.ab', 'self']))
    expect(shape.selves.map((anchor) => anchor.id)).toEqual(['ab'])
  })

  it('names as roots only the anchors whose nodes were actually read', () => {
    const shape = forestShape(scope(false, ['a', 'r.a', 'subtree'], ['gone', 'r.gone', 'self']))
    // an anchor whose node vanished between the grant and the read drops out
    expect(forestRoots(shape, (id) => id === 'a')).toEqual(['a'])
  })
})
