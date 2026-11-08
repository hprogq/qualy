import { describe, expect, it, vi } from 'vitest'
import { createLeaveDecision, leavesThePage } from '../src/routing/leave-gate.ts'

const at = (pathname: string, search = '') => ({ pathname, search, hash: '' })
const guard = { blocks: leavesThePage }

describe('the Data Router leave decision', () => {
  it('blocks only real page changes by default', () => {
    const gate = createLeaveDecision()
    gate.controls.guard(guard)
    expect(gate.blockers(at('/a'), at('/b'))).toEqual([guard])
    expect(gate.blockers(at('/a', '?one'), at('/a', '?two'))).toEqual([])
  })

  it('asks once for all active guards and cancels or proceeds the router move exactly once', () => {
    const gate = createLeaveDecision()
    gate.controls.guard(guard)
    const proceed = vi.fn(),
      reset = vi.fn()
    gate.hold(gate.blockers(at('/a'), at('/b')), at('/b'), proceed, reset)
    expect(gate.controls.held()?.to).toEqual(at('/b'))
    gate.controls.stay()
    gate.controls.stay()
    expect(reset).toHaveBeenCalledTimes(1)
    expect(proceed).not.toHaveBeenCalled()
    gate.hold([guard], at('/b'), proceed, reset)
    gate.controls.leave()
    gate.controls.leave()
    expect(proceed).toHaveBeenCalledTimes(1)
    expect(gate.controls.held()).toBeNull()
  })

  it('saves all guarded changes in order and stops when a save fails', async () => {
    const gate = createLeaveDecision()
    const saved: string[] = []
    const first = {
      blocks: leavesThePage,
      save: () => {
        saved.push('first')
        return true
      },
    }
    const second = {
      blocks: leavesThePage,
      save: () => {
        saved.push('second')
        return false
      },
    }
    gate.hold([first, second], at('/b'), vi.fn())
    expect(await gate.controls.held()?.save?.()).toBe(false)
    expect(saved).toEqual(['first', 'second'])
  })

  it('offers save only when every guard can save', () => {
    const gate = createLeaveDecision()
    gate.hold([guard, { blocks: leavesThePage, save: () => true }], at('/b'), vi.fn())
    expect(gate.controls.held()?.save).toBeUndefined()
  })

  it('keeps an answered move valid if saving removed its last guard', () => {
    const gate = createLeaveDecision(),
      proceed = vi.fn()
    const remove = gate.controls.guard(guard)
    gate.hold([guard], at('/b'), proceed)
    const question = gate.controls.held()!
    remove()
    expect(gate.controls.held()).toBeNull()
    gate.controls.leave(question)
    expect(proceed).toHaveBeenCalledOnce()
  })

  it('does not let a stale save answer navigate a newer request', () => {
    const gate = createLeaveDecision(),
      old = vi.fn(),
      next = vi.fn()
    gate.hold([guard], at('/b'), old)
    const question = gate.controls.held()!
    gate.hold([guard], at('/c'), next)
    gate.controls.leave(question)
    gate.controls.stay(question)
    expect(old).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
    expect(gate.controls.held()?.to).toEqual(at('/c'))
  })

  it('honors custom guards and restores them after a synchronous bypass, including an exception', () => {
    const gate = createLeaveDecision()
    const custom = { blocks: () => true }
    gate.controls.guard(custom)
    gate.controls.bypass(() => expect(gate.blockers(at('/a'), at('/b'))).toEqual([]))
    expect(gate.blockers(at('/a'), at('/a'))).toEqual([custom])
    expect(() =>
      gate.controls.bypass(() => {
        throw new Error('failed move')
      }),
    ).toThrow('failed move')
    expect(gate.blockers(at('/a'), at('/b'))).toEqual([custom])
  })
})
