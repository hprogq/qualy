import { describe, expect, it } from 'vitest'
import { shapeOf, toggleNode, type TreeSelectionNode } from '../src/lib/tree-selection.ts'

// The picker's whole promise: the selection is always the minimal non-nested
// set matching what the person sees ticked. The case that motivated these
// tests: tick a major, untick two of its classes - the result must be the
// remaining classes, not an empty set.

const node = (id: string, path: string): TreeSelectionNode => ({
  id,
  name: id,
  path,
  depth: path.split('.').length - 1,
})

const TREE = [
  node('root', 'r'),
  node('cs', 'r.cs'),
  node('c1', 'r.cs.c1'),
  node('c2', 'r.cs.c2'),
  node('c3', 'r.cs.c3'),
  node('c4', 'r.cs.c4'),
  node('math', 'r.math'),
  node('m1', 'r.math.m1'),
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
            expect(byId.get(b)!.path.startsWith(`${byId.get(a)!.path}.`)).toBe(false)
          }
        }
      }
    }
  })
})
