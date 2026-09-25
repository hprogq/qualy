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
const policy = (normal: unknown[], escalation: unknown[] = []) => ({
  normal: { stages: normal },
  escalation: { stages: escalation },
})

const reasons = (value: unknown) => validateReviewPolicy(value).map((issue) => issue.reason)

describe('the review policy shape', () => {
  it('accepts one roleAt stage ending there', () => {
    expect(reasons(policy([stage()]))).toEqual([])
  })

  it('accepts several role ids in one stage', () => {
    const single = stage()
    single.selector.roleIds.push(randomUUID())
    expect(reasons(policy([single]))).toEqual([])
  })

  it('accepts two routes that share no steps', () => {
    // the class monitor decides ordinarily; an escalation goes somewhere else
    // entirely rather than carrying on down the same list (§32.62)
    expect(
      reasons(
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

  it('accepts a policy with no escalation route at all', () => {
    // nothing says a question must have one; escalating is then simply
    // not offered
    expect(reasons({ normal: { stages: [stage()] } })).toEqual([])
  })

  it('seats a panel only on an escalation middle step', () => {
    // `all` is the sitting's shape (§32.66): the ordinary route confirms one
    // voice at a time, and the escalation route's last step must speak with
    // one final voice - a split there would have nowhere left to go
    expect(reasons(policy([stage({ quorum: { type: 'all' } })]))).toContain(
      'policy-quorum-all-normal',
    )
    expect(reasons(policy([stage()], [stage({ quorum: { type: 'all' } })]))).toContain(
      'policy-quorum-all-terminal',
    )
    expect(reasons(policy([stage()], [stage({ quorum: { type: 'all' } }), stage()]))).toEqual([])
  })

  it('refuses the quorums the engine cannot yet count, by their own name', () => {
    // atLeast's count is policy that must hold even when eligibility shrinks
    // the room, and no aggregation rule for it has been ruled
    expect(reasons(policy([stage({ quorum: { type: 'atLeast', count: 2 } })]))).toContain(
      'policy-quorum-not-counted',
    )
  })

  it('takes a spoken name for a step, and refuses a blank one', () => {
    expect(reasons(policy([stage({ label: '班委初审' })]))).toEqual([])
    expect(reasons(policy([stage({ label: '   ' })]))).toContain('policy-label-invalid')
    expect(reasons(policy([stage({ label: '名'.repeat(51) })]))).toContain('policy-label-invalid')
  })

  it('refuses everything outside the grammar, by name', () => {
    expect(reasons(policy([]))).toContain('policy-stages-required')
    expect(
      reasons(
        policy([{ id: 's', selector: { kind: 'whoeverIsAround' }, quorum: { type: 'any' } }]),
      ),
    ).toContain('policy-selector-kind')
    expect(reasons(policy([stage({ quorum: { type: 'mostOf' } })]))).toContain('policy-quorum-type')
    expect(reasons({ ...policy([stage()]), sideChain: {} })).toContain('policy-unknown-key')
  })

  it('refuses a policy written as one list with a marker in it', () => {
    // still read and still walked, never written again: accepting both
    // shapes is how the two routes would drift back into being a prefix of
    // one another (§32.62)
    expect(reasons({ stages: [stage()], normalTerminal: 0 })).toEqual(['policy-version-legacy'])
  })

  it('insists every step is named, and named once', () => {
    expect(reasons(policy([{ ...stage(), id: undefined }]))).toContain('policy-stage-id-required')
    expect(reasons(policy([{ ...stage(), id: 'Not A Name' }]))).toContain(
      'policy-stage-id-required',
    )
    // across both routes, because migrating an in-flight round asks "is this
    // step still here" of the whole policy
    const twice = stage({ id: 'same' })
    expect(reasons(policy([twice], [{ ...stage(), id: 'same' }]))).toContain(
      'policy-stage-id-duplicate',
    )
  })

  it('refuses stages whose parts are not what they say', () => {
    expect(
      reasons(
        policy([
          stage({
            selector: { kind: 'roleAt', nodeTypeId: 'not-a-uuid', roleIds: [randomUUID()] },
          }),
        ]),
      ),
    ).toContain('policy-node-type-required')
    expect(
      reasons(
        policy([stage({ selector: { kind: 'roleAt', nodeTypeId: randomUUID(), roleIds: [] } })]),
      ),
    ).toContain('policy-roles-required')
    expect(reasons('not even an object')).toEqual(['policy-not-an-object'])
  })

  it('holds administrative items to the same shape: the chain is their remedy', () => {
    // recording never walks the chain, but an appeal later resolves it from
    // this very revision - a policy with no chain would be immutable history
    // with no way back (assessment-design §13/§15)
    expect(reasons(policy([stage()]))).toEqual([])
    expect(reasons({})).toContain('policy-stages-required')
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
    const found = reasons(smuggling)
    expect(found.filter((reason) => reason === 'policy-unknown-key')).toHaveLength(3)
  })
})

// Every round frozen from a policy carries its steps, and every reviewer
// lookup walks a step's roles. Neither was bounded, so one save could make
// every later read of the question pay for a route nobody walks.
describe('how much one policy may say', () => {
  it('takes a route of ten steps and refuses an eleventh', () => {
    const route = (count: number) => Array.from({ length: count }, () => stage())
    expect(reasons(policy(route(10)))).toEqual([])
    expect(reasons(policy(route(11)))).toEqual(['policy-stages-too-many'])
    expect(reasons(policy([stage()], route(11)))).toEqual(['policy-stages-too-many'])
  })

  it('takes twenty roles on a step and refuses more', () => {
    const naming = (count: number) =>
      stage({
        selector: {
          kind: 'roleAt',
          nodeTypeId: randomUUID(),
          roleIds: Array.from({ length: count }, () => randomUUID()),
        },
      })
    expect(reasons(policy([naming(20)]))).toEqual([])
    expect(reasons(policy([naming(21)]))).toEqual(['policy-roles-too-many'])
  })
})
