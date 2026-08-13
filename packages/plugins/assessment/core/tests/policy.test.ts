import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { validateReviewPolicy } from '../src/item/policy.ts'

// The policy validator on its own: the one accepted shape, and every wider
// shape of the frozen grammar named and refused. Widening the engine later
// must mean deleting refusals here, never reinterpreting stored policies.

const stage = () => ({
  selector: { kind: 'roleAt', nodeTypeId: randomUUID(), roleIds: [randomUUID()] },
  quorum: { type: 'any' },
})

const reasons = (entrySource: 'student' | 'administrative', policy: unknown) =>
  validateReviewPolicy(entrySource, policy).map((issue) => issue.reason)

describe('the review policy shape', () => {
  it('accepts exactly one roleAt stage with quorum any, ending there', () => {
    expect(reasons('student', { stages: [stage()], normalTerminal: 0 })).toEqual([])
  })

  it('accepts several role ids in the one stage', () => {
    const single = stage()
    single.selector.roleIds.push(randomUUID())
    expect(reasons('student', { stages: [single], normalTerminal: 0 })).toEqual([])
  })

  it('refuses everything the engine does not implement, by name', () => {
    expect(reasons('student', { stages: [], normalTerminal: 0 })).toContain('policy-single-stage')
    expect(reasons('student', { stages: [stage(), stage()], normalTerminal: 0 })).toContain(
      'policy-single-stage',
    )
    expect(
      reasons('student', {
        stages: [
          { selector: { kind: 'nearestRole', roleId: randomUUID() }, quorum: { type: 'any' } },
        ],
        normalTerminal: 0,
      }),
    ).toContain('policy-selector-role-at')
    expect(
      reasons('student', {
        stages: [{ ...stage(), quorum: { type: 'atLeast', n: 2 } }],
        normalTerminal: 0,
      }),
    ).toContain('policy-quorum-any')
    expect(reasons('student', { stages: [stage()], normalTerminal: 1 })).toContain(
      'policy-terminal-first',
    )
    expect(reasons('student', { stages: [stage()], normalTerminal: 0, escalation: {} })).toContain(
      'policy-unknown-key',
    )
  })

  it('refuses stages whose parts are not what they say', () => {
    expect(
      reasons('student', {
        stages: [
          {
            selector: { kind: 'roleAt', nodeTypeId: 'not-a-uuid', roleIds: [randomUUID()] },
            quorum: { type: 'any' },
          },
        ],
        normalTerminal: 0,
      }),
    ).toContain('policy-node-type-required')
    expect(
      reasons('student', {
        stages: [
          {
            selector: { kind: 'roleAt', nodeTypeId: randomUUID(), roleIds: [] },
            quorum: { type: 'any' },
          },
        ],
        normalTerminal: 0,
      }),
    ).toContain('policy-roles-required')
    expect(reasons('student', 'not even an object')).toEqual(['policy-not-an-object'])
  })

  it('holds administrative items to the same shape: the chain is their remedy', () => {
    // recording never walks the chain, but an appeal later resolves it from
    // this very revision - a policy with no chain would be immutable history
    // with no way back (assessment-design §13/§15)
    expect(reasons('administrative', { stages: [stage()], normalTerminal: 0 })).toEqual([])
    expect(reasons('administrative', {})).toContain('policy-single-stage')
  })

  it('refuses unknown keys at every level, not only the top', () => {
    const smuggling = {
      stages: [
        {
          selector: {
            kind: 'roleAt',
            nodeTypeId: randomUUID(),
            roleIds: [randomUUID()],
            futureFallback: true,
          },
          quorum: { type: 'any', futureN: 3 },
          someFutureRule: true,
        },
      ],
      normalTerminal: 0,
    }
    const found = reasons('student', smuggling)
    expect(found.filter((reason) => reason === 'policy-unknown-key')).toHaveLength(3)
  })
})
