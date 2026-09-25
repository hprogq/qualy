import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { settler } from '../src/client/roster/live-settle.ts'

// The roster's live wake-ups become reads: one per burst once it goes quiet,
// and never later than a fixed time after the burst began.

describe('coalescing the roster’s live wake-ups', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads once a burst goes quiet, with everything the burst was about', () => {
    const fire = vi.fn()
    const live = settler<string>({ settle: 1_000, maxWait: 5_000, fire })
    live.wake('entries-changed')
    vi.advanceTimersByTime(400)
    live.wake('result-changed')
    vi.advanceTimersByTime(999)
    expect(fire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fire).toHaveBeenCalledTimes(1)
    expect(fire).toHaveBeenCalledWith(['entries-changed', 'result-changed'])
  })

  it('reads a burst that never goes quiet no later than its longest wait', () => {
    const fire = vi.fn()
    const live = settler<string>({ settle: 1_000, maxWait: 5_000, fire })
    // a wake-up every 300 milliseconds for twelve seconds
    for (let at = 0; at < 12_000; at += 300) {
      live.wake('review-instance-changed')
      vi.advanceTimersByTime(300)
    }
    // at five and at ten seconds, not once the queue is done
    expect(fire).toHaveBeenCalledTimes(2)
    live.cancel()
  })

  it('reads nothing once cancelled', () => {
    const fire = vi.fn()
    const live = settler<string>({ settle: 1_000, maxWait: 5_000, fire })
    live.wake('entries-changed')
    live.cancel()
    vi.advanceTimersByTime(10_000)
    expect(fire).not.toHaveBeenCalled()
  })
})
