import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  UNSAFE_createMemoryHistory as createMemoryHistory,
  type HistoryRouterProps,
  type Location,
} from 'react-router'
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

describe('more than one guard at once', () => {
  it('holds the move while any of them would lose something, and saves every one in turn', async () => {
    const { gate, at } = gateAt(['/a'])
    const saved: string[] = []
    gate.guard({ blocks: leavesThePage, save: () => (saved.push('first'), true) })
    gate.guard({ blocks: leavesThePage, save: async () => (saved.push('second'), true) })
    gate.history.push('/b')
    const question = gate.held()
    expect(question?.to.pathname).toBe('/b')
    expect(await question?.save?.()).toBe(true)
    expect(saved).toEqual(['first', 'second'])
    gate.leave()
    expect(at()).toBe('/b')
  })

  it('stops at the first save that does not go through', async () => {
    const { gate } = gateAt(['/a'])
    const saved: string[] = []
    gate.guard({ blocks: leavesThePage, save: () => (saved.push('first'), false) })
    gate.guard({ blocks: leavesThePage, save: () => (saved.push('second'), true) })
    gate.history.push('/b')
    expect(await gate.held()?.save?.()).toBe(false)
    expect(saved).toEqual(['first'])
  })

  it('offers no save when one of them has none: going means going without those changes', () => {
    const { gate } = gateAt(['/a'])
    gate.guard({ blocks: leavesThePage, save: () => true })
    gate.guard(guardPath)
    gate.history.push('/b')
    expect(gate.held()).not.toBeNull()
    expect(gate.held()?.save).toBeUndefined()
  })

  it('keeps asking about what is still unsaved once one of them comes down', async () => {
    const { gate, at } = gateAt(['/a'])
    const saved: string[] = []
    const first = gate.guard({ blocks: leavesThePage, save: () => (saved.push('first'), true) })
    gate.guard({ blocks: leavesThePage, save: () => (saved.push('second'), true) })
    gate.history.push('/b')
    const asked = gate.held()
    // the first page saved on its own and turned clean meanwhile
    first()
    const still = gate.held()
    expect(still).not.toBeNull()
    expect(await still?.save?.()).toBe(true)
    expect(saved).toEqual(['second'])
    // an answer to either form of the question makes the one move, once
    gate.leave(asked ?? undefined)
    expect(at()).toBe('/b')
    expect(gate.held()).toBeNull()
    gate.leave(still ?? undefined)
    expect(at()).toBe('/b')
  })
})

type History = HistoryRouterProps['history']

// A history that answers a step through it the way the browser does: later,
// as a pop of its own, and not at all for a step past either end.
const browserLike = (entries: string[]) => {
  const memory = createMemoryHistory({ initialEntries: entries, v5Compat: true })
  let length = entries.length
  let index = length - 1
  const due: (() => void)[] = []
  const base: History = {
    get action() {
      return memory.action
    },
    get location() {
      return memory.location
    },
    createHref: (to) => memory.createHref(to),
    createURL: (to) => memory.createURL(to),
    encodeLocation: (to) => memory.encodeLocation(to),
    push(to, state) {
      // a push drops whatever lay ahead
      index += 1
      length = index + 1
      memory.push(to, state)
    },
    replace: (to, state) => memory.replace(to, state),
    go(delta) {
      if (index + delta < 0 || index + delta >= length) return
      due.push(() => {
        index += delta
        memory.go(delta)
      })
    },
    listen: (listener) => memory.listen(listener),
  }
  /** lets the browser get round to the steps asked for so far, not the ones they lead to */
  const settle = () => {
    for (const step of due.splice(0)) step()
  }
  const gate = createLeaveGate(base)
  const told: string[] = []
  gate.history.listen((update) => told.push(`${update.location.pathname}${update.location.search}`))
  return { base, gate, told, settle }
}

describe('the gate over a history that answers later', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('puts a move the page made while a step back was being undone on the page’s own entry', async () => {
    const { base, gate, told, settle } = browserLike(['/a', '/b'])
    gate.guard(guardPath)
    // the reader's back arrives, and is being undone
    base.go(-1)
    settle()
    expect(gate.held()?.to.pathname).toBe('/a')
    // the page writes its query before the undo has landed
    gate.history.replace('/b?tab=2')
    expect(told).toEqual([])
    settle()
    // told once the page is back on its own entry, and the entry before is untouched
    expect(told).toEqual(['/b?tab=2'])
    expect(base.location.pathname).toBe('/b')
    expect(gate.held()).not.toBeNull()
    // and the reader's step is taken again when they go
    gate.leave()
    await Promise.resolve()
    settle()
    expect(told.at(-1)).toBe('/a')
  })

  it('still asks about the reader’s own step after the page stepped past the end of history', () => {
    const { base, gate, told, settle } = browserLike(['/a', '/b'])
    gate.guard(guardPath)
    // a step forward from the last entry: the browser never answers it
    gate.bypass(() => gate.history.go(1))
    settle()
    base.go(-1)
    settle()
    expect(told).toEqual([])
    expect(gate.held()?.to.pathname).toBe('/a')
  })

  it('still asks about the same step once the page’s own has long gone unanswered', () => {
    const { base, gate, told, settle } = browserLike(['/a', '/b'])
    gate.guard(guardPath)
    const now = vi.spyOn(performance, 'now').mockReturnValue(1_000)
    // two steps back from the second entry: past the start, never answered
    gate.bypass(() => gate.history.go(-2))
    settle()
    // the page moves on inside itself, and the reader later takes the same
    // two steps from there, which do lead somewhere now
    gate.history.push('/b?tab=2')
    now.mockReturnValue(10_000)
    base.go(-2)
    settle()
    expect(told).toEqual(['/b?tab=2'])
    expect(gate.held()?.to.pathname).toBe('/a')
  })
})
