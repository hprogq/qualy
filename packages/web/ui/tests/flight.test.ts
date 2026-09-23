import { afterEach, describe, expect, it, vi } from 'vitest'
import { afterFlight, flightDeparted, flightLanded } from '../src/lib/flight.ts'

// What waits for the wordmark: nothing when it is not flying, everything in
// order when it lands, and nothing for long should it never report landing.

afterEach(() => {
  flightLanded()
  vi.useRealTimers()
})

describe('a callback during the flight', () => {
  it('runs at once when nothing is in flight', () => {
    const ran = vi.fn()
    afterFlight(ran)
    expect(ran).toHaveBeenCalledTimes(1)
  })

  it('waits for the landing, and runs in the order it came', () => {
    const order: number[] = []
    flightDeparted()
    afterFlight(() => order.push(1))
    afterFlight(() => order.push(2))
    expect(order).toEqual([])
    flightLanded()
    expect(order).toEqual([1, 2])
    afterFlight(() => order.push(3))
    expect(order).toEqual([1, 2, 3])
  })

  it('is not held for long by a flight that never lands', () => {
    vi.useFakeTimers()
    const ran = vi.fn()
    flightDeparted()
    afterFlight(ran)
    vi.advanceTimersByTime(799)
    expect(ran).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(ran).toHaveBeenCalledTimes(1)
  })
})
