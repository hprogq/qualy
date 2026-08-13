import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { validateReviewPolicy } from '../src/item/policy.ts'

// The policy validator on its own: the frozen grammar of §14 accepted whole,
// and everything outside it named and refused.

const stage = () => ({
  selector: { kind: 'roleAt', nodeTypeId: randomUUID(), roleIds: [randomUUID()] },
  quorum: { type: 'any' },
})

const reasons = (entrySource: 'student' | 'administrative', policy: unknown) =>
  validateReviewPolicy(entrySource, policy).map((issue) => issue.reason)

describe('the review policy shape', () => {
  it('accepts one roleAt stage ending there', () => {
    expect(reasons('student', { stages: [stage()], normalTerminal: 0 })).toEqual([])
  })

  it('accepts several role ids in one stage', () => {
    const single = stage()
    single.selector.roleIds.push(randomUUID())
    expect(reasons('student', { stages: [single], normalTerminal: 0 })).toEqual([])
  })

  it('accepts a chain whose ordinary flow ends before its doubt stages', () => {
    // the class monitor decides ordinarily; the stages past the terminal are
    // where an escalation goes, described by the same list (§14)
    expect(
      reasons('student', {
        stages: [
          stage(),
          stage(),
          { selector: { kind: 'nearestRole', roleId: randomUUID() }, quorum: { type: 'any' } },
        ],
        normalTerminal: 0,
      }),
    ).toEqual([])
  })

  it('refuses the quorums the engine cannot yet count, by their own name', () => {
    // in the grammar, not in the engine: a stored `all` run as `any` would
    // be a configuration meaning something other than it says
    for (const quorum of [{ type: 'all' }, { type: 'atLeast', count: 2 }]) {
      expect(reasons('student', { stages: [{ ...stage(), quorum }], normalTerminal: 0 })).toContain(
        'policy-quorum-not-counted',
      )
    }
  })

  it('refuses everything outside the grammar, by name', () => {
    expect(reasons('student', { stages: [], normalTerminal: 0 })).toContain(
      'policy-stages-required',
    )
    expect(
      reasons('student', {
        stages: [{ selector: { kind: 'whoeverIsAround' }, quorum: { type: 'any' } }],
        normalTerminal: 0,
      }),
    ).toContain('policy-selector-kind')
    expect(
      reasons('student', {
        stages: [{ ...stage(), quorum: { type: 'mostOf' } }],
        normalTerminal: 0,
      }),
    ).toContain('policy-quorum-type')

    // the ordinary flow has to end at a stage the chain has
    expect(reasons('student', { stages: [stage()], normalTerminal: 1 })).toContain(
      'policy-terminal-in-chain',
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
    expect(reasons('administrative', {})).toContain('policy-stages-required')
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
