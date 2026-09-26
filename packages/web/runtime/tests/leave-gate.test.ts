import { describe, expect, it } from 'vitest'
import { UNSAFE_createMemoryHistory as createMemoryHistory, type Location } from 'react-router'
import { createLeaveGate, leavesThePage } from '../src/leave-gate.ts'

// The gate over the history the router reads, driven the way the router
// drives it: pushes and replaces from links and navigate(), pops from the
// browser's own back. What the router is told is what the reader sees.

const gateAt = (entries: string[]) => {
  const base = createMemoryHistory({ initialEntries: entries, v5Compat: true })
  const gate = createLeaveGate(base)
  const told: Location[] = []
  gate.history.listen((update) => told.push(update.location))
  const at = () => told.at(-1)?.pathname ?? gate.history.location.pathname
  return { base, gate, told, at }
}

const guardPath = { blocks: leavesThePage }

describe('the gate a page with unsaved changes stands', () => {
  it('lets every move through while nobody guards', () => {
    const { gate, at } = gateAt(['/a'])
    gate.history.push('/b')
    expect(at()).toBe('/b')
    gate.history.replace('/c')
    expect(at()).toBe('/c')
  })

  it('holds a push to another page, and makes it once the reader goes', () => {
    const { gate, at, told } = gateAt(['/a'])
    gate.guard(guardPath)
    gate.history.push('/b')
    expect(told).toHaveLength(0)
    expect(gate.held()?.to.pathname).toBe('/b')
    gate.leave()
    expect(at()).toBe('/b')
    expect(gate.held()).toBeNull()
  })

  it('drops a held move when the reader stays', () => {
    const { gate, told } = gateAt(['/a'])
    gate.guard(guardPath)
    gate.history.replace('/b')
    gate.stay()
    expect(gate.held()).toBeNull()
    expect(told).toHaveLength(0)
    // a second answer to a question already answered moves nothing
    gate.leave()
    expect(told).toHaveLength(0)
  })

  it('lets a move inside the page through: the same path in another state', () => {
    const { gate, at, told } = gateAt(['/items?open=1'])
    gate.guard(guardPath)
    gate.history.push('/items?open=2')
    expect(told).toHaveLength(1)
    expect(at()).toBe('/items')
    expect(gate.held()).toBeNull()
  })

  it('undoes a step back at once, and takes it again only when the reader goes', () => {
    const { base, gate, told, at } = gateAt(['/a', '/b'])
    gate.guard(guardPath)
    gate.history.go(-1)
    // the router never heard of it, and the history is back where it was
    expect(told).toHaveLength(0)
    expect(base.location.pathname).toBe('/b')
    expect(gate.held()?.to.pathname).toBe('/a')
    gate.leave()
    return Promise.resolve().then(() => {
      expect(at()).toBe('/a')
      expect(base.location.pathname).toBe('/a')
    })
  })

  it('makes the move the reader answered, even once the question has been put away', () => {
    const { gate, at } = gateAt(['/a'])
    const stand = gate.guard(guardPath)
    gate.history.push('/b')
    const going = gate.held()!
    // the page saved, turned clean and took its guard down meanwhile
    stand()
    expect(gate.held()).toBeNull()
    gate.leave(going)
    expect(at()).toBe('/b')
  })

  it('does not ask about a move the page makes itself', () => {
    const { gate, at } = gateAt(['/a', '/b'])
    gate.guard(guardPath)
    gate.bypass(() => gate.history.push('/c'))
    expect(at()).toBe('/c')
    gate.bypass(() => gate.history.go(-1))
    expect(at()).toBe('/b')
    expect(gate.held()).toBeNull()
  })

  it('asks the page what counts as leaving it', () => {
    const { gate, told } = gateAt(['/items?open=1'])
    gate.guard({ blocks: (from, to) => from.search !== to.search })
    gate.history.push('/items?open=2')
    expect(told).toHaveLength(0)
    expect(gate.held()?.to.search).toBe('?open=2')
  })

  it('forgets the question when the guard comes down', () => {
    const { gate } = gateAt(['/a'])
    const stand = gate.guard(guardPath)
    let heard = 0
    gate.subscribe(() => (heard += 1))
    gate.history.push('/b')
    expect(heard).toBe(1)
    stand()
    expect(gate.held()).toBeNull()
    expect(heard).toBe(2)
  })
})
