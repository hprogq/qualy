import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { validateReviewPolicy } from '../src/item/policy.ts'

// The policy validator on its own: the frozen grammar of §14 accepted whole,
// and everything outside it named and refused.

let minted = 0
const stage = (over: Record<string, unknown> = {}) => ({
  id: `s${(minted += 1)}`,
  selector: { kind: 'roleAt', nodeTypeId: randomUUID(), roleIds: [randomUUID()] },
  quorum: { type: 'any' },
  ...over,
})

/** the two routes, with whatever this case is about in them */
const policy = (normal: unknown[], doubt: unknown[] = []) => ({
  normal: { stages: normal },
  doubt: { stages: doubt },
})

const reasons = (entrySource: 'student' | 'administrative', value: unknown) =>
  validateReviewPolicy(entrySource, value).map((issue) => issue.reason)

describe('the review policy shape', () => {
  it('accepts one roleAt stage ending there', () => {
    expect(reasons('student', policy([stage()]))).toEqual([])
  })

  it('accepts several role ids in one stage', () => {
    const single = stage()
    single.selector.roleIds.push(randomUUID())
    expect(reasons('student', policy([single]))).toEqual([])
  })

  it('accepts two routes that share no steps', () => {
    // the class monitor decides ordinarily; a doubt goes somewhere else
    // entirely rather than carrying on down the same list (§32.62)
    expect(
      reasons(
        'student',
        policy(
          [stage(), stage()],
          [
            {
              id: 'd1',
              selector: { kind: 'nearestRole', roleId: randomUUID() },
              quorum: { type: 'any' },
            },
          ],
        ),
      ),
    ).toEqual([])
  })

  it('accepts a policy with no doubt route at all', () => {
    // nothing says a question must have one; raising a doubt is then simply
    // not offered
    expect(reasons('student', { normal: { stages: [stage()] } })).toEqual([])
  })

  it('refuses the quorums the engine cannot yet count, by their own name', () => {
    // in the grammar, not in the engine: a stored `all` run as `any` would
    // be a configuration meaning something other than it says
    for (const quorum of [{ type: 'all' }, { type: 'atLeast', count: 2 }]) {
      expect(reasons('student', policy([stage({ quorum })]))).toContain('policy-quorum-not-counted')
    }
  })

  it('refuses everything outside the grammar, by name', () => {
    expect(reasons('student', policy([]))).toContain('policy-stages-required')
    expect(
      reasons(
        'student',
        policy([{ id: 's', selector: { kind: 'whoeverIsAround' }, quorum: { type: 'any' } }]),
      ),
    ).toContain('policy-selector-kind')
    expect(reasons('student', policy([stage({ quorum: { type: 'mostOf' } })]))).toContain(
      'policy-quorum-type',
    )
    expect(reasons('student', { ...policy([stage()]), escalation: {} })).toContain(
      'policy-unknown-key',
    )
  })

  it('refuses a policy written as one list with a marker in it', () => {
    // still read and still walked, never written again: accepting both
    // shapes is how the two routes would drift back into being a prefix of
    // one another (§32.62)
    expect(reasons('student', { stages: [stage()], normalTerminal: 0 })).toEqual([
      'policy-version-legacy',
    ])
  })

  it('insists every step is named, and named once', () => {
    expect(reasons('student', policy([{ ...stage(), id: undefined }]))).toContain(
      'policy-stage-id-required',
    )
    expect(reasons('student', policy([{ ...stage(), id: 'Not A Name' }]))).toContain(
      'policy-stage-id-required',
    )
    // across both routes, because migrating an in-flight round asks "is this
    // step still here" of the whole policy
    const twice = stage({ id: 'same' })
    expect(reasons('student', policy([twice], [{ ...stage(), id: 'same' }]))).toContain(
      'policy-stage-id-duplicate',
    )
  })

  it('refuses stages whose parts are not what they say', () => {
    expect(
      reasons(
        'student',
        policy([
          stage({
            selector: { kind: 'roleAt', nodeTypeId: 'not-a-uuid', roleIds: [randomUUID()] },
          }),
        ]),
      ),
    ).toContain('policy-node-type-required')
    expect(
      reasons(
        'student',
        policy([stage({ selector: { kind: 'roleAt', nodeTypeId: randomUUID(), roleIds: [] } })]),
      ),
    ).toContain('policy-roles-required')
    expect(reasons('student', 'not even an object')).toEqual(['policy-not-an-object'])
  })

  it('holds administrative items to the same shape: the chain is their remedy', () => {
    // recording never walks the chain, but an appeal later resolves it from
    // this very revision - a policy with no chain would be immutable history
    // with no way back (assessment-design §13/§15)
    expect(reasons('administrative', policy([stage()]))).toEqual([])
    expect(reasons('administrative', {})).toContain('policy-stages-required')
  })

  it('refuses unknown keys at every level, not only the top', () => {
    const smuggling = policy([
      {
        id: 'smuggle',
        selector: {
          kind: 'roleAt',
          nodeTypeId: randomUUID(),
          roleIds: [randomUUID()],
          futureFallback: true,
        },
        quorum: { type: 'any', futureN: 3 },
        someFutureRule: true,
      },
    ])
    const found = reasons('student', smuggling)
    expect(found.filter((reason) => reason === 'policy-unknown-key')).toHaveLength(3)
  })
})
