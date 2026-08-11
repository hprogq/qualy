import { describe, expect, it } from 'vitest'
import {
  isAncestor,
  shapeOf,
  toggleNode,
  type TreeSelectionNode,
} from '../src/lib/tree-selection.ts'

// The picker's whole promise: the selection is always the minimal non-nested
// set matching what the person sees ticked. The case that motivated these
// tests: tick a major, untick two of its classes - the result must be the
// remaining classes, not an empty set.

const node = (id: string, parentId: string | null): TreeSelectionNode => ({
  id,
  name: id,
  parentId,
})

const TREE = [
  node('root', null),
  node('cs', 'root'),
  node('c1', 'cs'),
  node('c2', 'cs'),
  node('c3', 'cs'),
  node('c4', 'cs'),
  node('math', 'root'),
  node('m1', 'math'),
]

const shape = shapeOf(TREE)
const byId = new Map(TREE.map((entry) => [entry.id, entry]))
const toggle = (selection: Iterable<string>, id: string) =>
  [...toggleNode(shape, new Set(selection), byId.get(id)!)].sort()

describe('tree selection', () => {
  it('unticking one class of a ticked major keeps the other classes', () => {
    expect(toggle(['cs'], 'c1')).toEqual(['c2', 'c3', 'c4'])
  })

  it('unticking a second class keeps the rest, not nothing', () => {
    expect(toggle(['c2', 'c3', 'c4'], 'c2')).toEqual(['c3', 'c4'])
  })

  it('unticking a grandchild of the root keeps every other branch', () => {
    expect(toggle(['root'], 'c1')).toEqual(['c2', 'c3', 'c4', 'math'])
  })

  it('ticking a parent absorbs its explicitly selected children', () => {
    expect(toggle(['c1', 'c2', 'm1'], 'cs')).toEqual(['cs', 'm1'])
  })

  it('ticking and unticking the same node is a no-op overall', () => {
    expect(toggle(['cs'], 'math')).toEqual(['cs', 'math'])
    expect(toggle(['cs', 'math'], 'math')).toEqual(['cs'])
  })

  it('never returns a nested pair', () => {
    const states: string[][] = [['root'], ['cs'], ['c1', 'c2'], ['cs', 'math'], []]
    for (const state of states) {
      for (const target of TREE) {
        const result = toggleNode(shape, new Set(state), target)
        for (const a of result) {
          for (const b of result) {
            if (a === b) continue
            expect(isAncestor(shape, byId.get(a)!, byId.get(b)!)).toBe(false)
          }
        }
      }
    }
  })
})
