import { describe, expect, it } from 'vitest'
import {
  escalationOpen,
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
      escalation: { stages: [{ id: 'd1', selector, quorum }] },
    })
    expect(policy.normal.map((one) => one.id)).toEqual(['n1'])
    expect(policy.escalation.map((one) => one.id)).toEqual(['d1'])
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
    expect(policy.escalation.map((one) => one.id)).toEqual(['legacy-2'])
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
    expect(policy.escalation.map((one) => one.id)).toEqual(['legacy-1'])
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
        // frozen before steps had names: read back nameless, not undefined
        label: null,
        route: 'normal',
        index: 0,
        selector,
        quorum,
        roleIds: ['role'],
        nodeId: 'a',
        skipped: null,
      },
    ])
    expect(frozen.escalation.map((one) => ({ id: one.id, index: one.index }))).toEqual([
      { id: 'legacy-1', index: 0 },
    ])
  })

  it('gives nothing for a policy that is not one', () => {
    expect(readPolicy(null)).toEqual({ normal: [], escalation: [] })
    expect(readPolicy('a chain, honest')).toEqual({ normal: [], escalation: [] })
  })
})

const stage = (
  id: string,
  route: 'normal' | 'escalation',
  index: number,
  nodeId: string | null,
  /**
   * Why it resolved to no unit, when it did.
   *
   * `no-such-level` is a level this participant does not sit under and may
   * be stepped over; `no-holder` is a vacancy and must not be. They were one
   * thing here for a long time, which is why only the first was ever walked.
   */
  vacant: 'no-such-level' | 'no-holder' = 'no-such-level',
) => ({
  id,
  label: null,
  route,
  index,
  selector,
  quorum,
  roleIds: ['role'],
  nodeId,
  skipped: nodeId === null ? vacant : null,
})

describe('walking a resolved policy', () => {
  const policy: ResolvedPolicy = {
    normal: [
      stage('n1', 'normal', 0, 'a'),
      stage('n2', 'normal', 1, null),
      stage('n3', 'normal', 2, 'c'),
    ],
    escalation: [stage('d1', 'escalation', 0, 'x'), stage('d2', 'escalation', 1, 'y')],
  }

  it('steps over a level this person sits under no unit of', () => {
    expect(nextAfter(policy, policy.normal[0]!)?.id).toBe('n3')
  })

  it('stops at a duty nobody holds rather than stepping over it', () => {
    // ADR 0007 and §32.62 clause eight: a `nearestRole` step with no holder
    // anywhere on this lineage is a vacancy, not a level to skip. Stepping
    // over it made the step before it the route's end, so a claim was
    // approved and scored with that reviewer never having seen it.
    const vacancy: ResolvedPolicy = {
      normal: [
        stage('n1', 'normal', 0, 'a'),
        stage('n2', 'normal', 1, null, 'no-holder'),
        stage('n3', 'normal', 2, 'c'),
      ],
      escalation: [],
    }
    const next = nextAfter(vacancy, vacancy.normal[0]!)
    expect(next?.id).toBe('n2')
    // and it carries no unit, which is what makes an arrival read it as
    // blocked for want of an assignee
    expect(next?.nodeId).toBeNull()
    // so the step before it is not the end of the route
    expect(isRouteEnd(vacancy, vacancy.normal[0]!)).toBe(false)
  })

  it('has nowhere to go when the vacancy is the last step', () => {
    const vacancy: ResolvedPolicy = {
      normal: [stage('n1', 'normal', 0, 'a'), stage('n2', 'normal', 1, null, 'no-holder')],
      escalation: [],
    }
    // the round stands at the vacancy, and there is nothing after it
    expect(nextAfter(vacancy, vacancy.normal[1]!)).toBeNull()
    expect(isRouteEnd(vacancy, vacancy.normal[1]!)).toBe(true)
  })

  it('knows the end of a route without looking at the other one', () => {
    expect(isRouteEnd(policy, policy.normal[2]!)).toBe(true)
    // the last ordinary step is the end of the ordinary route even though
    // the escalation route has steps after it - they are not after it
    expect(isRouteEnd(policy, policy.escalation[0]!)).toBe(false)
    expect(isRouteEnd(policy, policy.escalation[1]!)).toBe(true)
  })

  it('finds a step by name, and only in the route it belongs to', () => {
    expect(stageById(policy, 'normal', 'n3')?.index).toBe(2)
    expect(stageById(policy, 'escalation', 'n3')).toBeNull()
  })

  it('offers escalating only when there is a route to escalate onto', () => {
    expect(escalationOpen(policy)).toBe(true)
    expect(escalationOpen({ normal: policy.normal, escalation: [] })).toBe(false)
    // an escalation route none of whose steps resolved is no route at all
    expect(
      escalationOpen({ normal: policy.normal, escalation: [stage('d1', 'escalation', 0, null)] }),
    ).toBe(false)
    expect(enterableFrom(policy, 'escalation', 0)?.id).toBe('d1')
  })
})
