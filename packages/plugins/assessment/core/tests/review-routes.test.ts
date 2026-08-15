import { describe, expect, it } from 'vitest'
import {
  doubtOpen,
  enterableFrom,
  isRouteEnd,
  nextAfter,
  readPolicy,
  readResolved,
  stageById,
  type ResolvedPolicy,
} from '../src/review/chain.ts'

// Two routes, and the one thing that must never change under a round: what
// the policy it was opened with says, however that policy was written down.

const selector = { kind: 'roleAt' as const, nodeTypeId: 'type', roleIds: ['role'] }
const quorum = { type: 'any' as const }

describe('reading a stored policy', () => {
  it('reads two routes as two routes', () => {
    const policy = readPolicy({
      normal: { stages: [{ id: 'n1', selector, quorum }] },
      doubt: { stages: [{ id: 'd1', selector, quorum }] },
    })
    expect(policy.normal.map((one) => one.id)).toEqual(['n1'])
    expect(policy.doubt.map((one) => one.id)).toEqual(['d1'])
  })

  it('splits one list with a marker in it where the marker says', () => {
    // everything up to and including the marker was the ordinary flow;
    // everything after it was what an escalation walked
    const policy = readPolicy({
      stages: [
        { selector, quorum },
        { selector, quorum },
        { selector, quorum },
      ],
      normalTerminal: 1,
    })
    expect(policy.normal.map((one) => one.id)).toEqual(['legacy-0', 'legacy-1'])
    expect(policy.doubt.map((one) => one.id)).toEqual(['legacy-2'])
  })

  it('names a step written before names by where it sat in that one list', () => {
    // the same derivation the round rows were backfilled with, so a round
    // standing at position 2 still finds position 2
    const policy = readPolicy({
      stages: [
        { selector, quorum },
        { selector, quorum },
      ],
    })
    expect(policy.normal.map((one) => one.id)).toEqual(['legacy-0'])
    expect(policy.doubt.map((one) => one.id)).toEqual(['legacy-1'])
  })

  it('reads a round frozen before the split the same way', () => {
    const frozen = readResolved({
      normalTerminal: 0,
      stages: [
        { index: 0, selector, quorum, roleIds: ['role'], nodeId: 'a', skipped: null },
        { index: 1, selector, quorum, roleIds: ['role'], nodeId: 'b', skipped: null },
      ],
    })
    expect(frozen.normal).toEqual([
      {
        id: 'legacy-0',
        route: 'normal',
        index: 0,
        selector,
        quorum,
        roleIds: ['role'],
        nodeId: 'a',
        skipped: null,
      },
    ])
    expect(frozen.doubt.map((one) => ({ id: one.id, index: one.index }))).toEqual([
      { id: 'legacy-1', index: 0 },
    ])
  })

  it('gives nothing for a policy that is not one', () => {
    expect(readPolicy(null)).toEqual({ normal: [], doubt: [] })
    expect(readPolicy('a chain, honest')).toEqual({ normal: [], doubt: [] })
  })
})

const stage = (id: string, route: 'normal' | 'doubt', index: number, nodeId: string | null) => ({
  id,
  route,
  index,
  selector,
  quorum,
  roleIds: ['role'],
  nodeId,
  skipped: nodeId === null ? ('no-such-level' as const) : null,
})

describe('walking a resolved policy', () => {
  const policy: ResolvedPolicy = {
    normal: [
      stage('n1', 'normal', 0, 'a'),
      stage('n2', 'normal', 1, null),
      stage('n3', 'normal', 2, 'c'),
    ],
    doubt: [stage('d1', 'doubt', 0, 'x'), stage('d2', 'doubt', 1, 'y')],
  }

  it('steps over a level this person sits under no unit of', () => {
    expect(nextAfter(policy, policy.normal[0]!)?.id).toBe('n3')
  })

  it('knows the end of a route without looking at the other one', () => {
    expect(isRouteEnd(policy, policy.normal[2]!)).toBe(true)
    // the last ordinary step is the end of the ordinary route even though
    // the doubt route has steps after it - they are not after it
    expect(isRouteEnd(policy, policy.doubt[0]!)).toBe(false)
    expect(isRouteEnd(policy, policy.doubt[1]!)).toBe(true)
  })

  it('finds a step by name, and only in the route it belongs to', () => {
    expect(stageById(policy, 'normal', 'n3')?.index).toBe(2)
    expect(stageById(policy, 'doubt', 'n3')).toBeNull()
  })

  it('offers a doubt only when there is a route to raise it onto', () => {
    expect(doubtOpen(policy)).toBe(true)
    expect(doubtOpen({ normal: policy.normal, doubt: [] })).toBe(false)
    // a doubt route none of whose steps resolved is no route at all
    expect(doubtOpen({ normal: policy.normal, doubt: [stage('d1', 'doubt', 0, null)] })).toBe(false)
    expect(enterableFrom(policy, 'doubt', 0)?.id).toBe('d1')
  })
})
