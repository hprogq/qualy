import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { phaseAlarm } from '../src/client/phase-alarm.ts'

describe('planned phase alarm', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
  })
  afterEach(() => vi.useRealTimers())

  it('keeps a distant boundary armed without waking until it arrives', () => {
    const wake = vi.fn()
    const cancel = phaseAlarm(49 * 60 * 60 * 1_000, wake)
    vi.advanceTimersByTime(49 * 60 * 60 * 1_000 + 749)
    expect(wake).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(wake).toHaveBeenCalledTimes(1)
    cancel()
  })

  it('retries an unchanged past boundary with capped backoff, then stops on cancellation', () => {
    const wake = vi.fn()
    const cancel = phaseAlarm(-1_000, wake)
    expect(wake).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(4_999)
    expect(wake).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(wake).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(10_000 + 20_000 + 40_000 + 80_000 + 120_000)
    expect(wake).toHaveBeenCalledTimes(7)
    vi.advanceTimersByTime(119_999)
    expect(wake).toHaveBeenCalledTimes(7)
    cancel()
    vi.advanceTimersByTime(500_000)
    expect(wake).toHaveBeenCalledTimes(7)
  })

  it('rechecks the wall clock when it moves backwards', () => {
    const wake = vi.fn()
    const cancel = phaseAlarm(10_000, wake)
    vi.setSystemTime(-10_000)
    vi.advanceTimersByTime(10_750)
    expect(wake).not.toHaveBeenCalled()
    vi.advanceTimersByTime(10_000)
    expect(wake).toHaveBeenCalledTimes(1)
    cancel()
  })
})
