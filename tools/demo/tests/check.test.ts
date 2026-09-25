import { describe, expect, it } from 'vitest'
import { awake, cst } from '../seed/context.ts'
import { positionalOf, seedOptionsOf } from '../options.ts'
import { judgeSituations, type Situation } from '../situations.ts'

// demo:check reads the flags demo:seed was given, and asks for a situation
// only when the run was meant to write it; reviewers act in the day.

describe('the seed options', () => {
  it('default to the review stage with the route change made', () => {
    expect(seedOptionsOf([])).toEqual({ stage: 'review', migrationBefore: false })
  })

  it('read the same flags demo:seed takes', () => {
    expect(seedOptionsOf(['--stage=entry', '--migration-state=before'])).toEqual({
      stage: 'entry',
      migrationBefore: true,
    })
    expect(() => seedOptionsOf(['--stage=later'])).toThrow(/--stage/)
    expect(() => seedOptionsOf(['--migration-state=after'])).toThrow(/--migration-state/)
  })

  it('leave the sample size where it was', () => {
    expect(positionalOf(['--stage=entry', '40'])).toEqual(['40'])
  })
})

describe('what a check requires', () => {
  const situations: Situation[] = [
    { account: 'student', label: 'always', count: 0 },
    { account: 'student', label: 'appeal', count: 0, needs: 'review-stage' },
    { account: 'student', label: 'reroute', count: 0, needs: 'route-change' },
    { account: 'counsellor', label: 'roster', count: 0, needs: 'ruling' },
  ]
  const labels = (list: readonly Situation[]) => list.map((one) => one.label)

  it('requires everything a full run writes, but never what waits on a ruling', () => {
    const judged = judgeSituations(situations, { stage: 'review', migrationBefore: false })
    expect(labels(judged.missing)).toEqual(['always', 'appeal', 'reroute'])
    expect(labels(judged.pending)).toEqual(['roster'])
    expect(judged.notExpected).toEqual([])
  })

  it('leaves appeals and the route change out while the selection is still filing', () => {
    const judged = judgeSituations(situations, { stage: 'entry', migrationBefore: false })
    expect(labels(judged.missing)).toEqual(['always'])
    expect(labels(judged.notExpected)).toEqual(['appeal', 'reroute'])
  })

  it('leaves the route change out when it was kept for the demonstration', () => {
    const judged = judgeSituations(situations, { stage: 'review', migrationBefore: true })
    expect(labels(judged.missing)).toEqual(['always', 'appeal'])
    expect(labels(judged.notExpected)).toEqual(['reroute'])
  })
})

describe('reviewers', () => {
  it('act in the day', () => {
    expect(awake(cst('2025-03-05T14:20:00'))).toEqual(cst('2025-03-05T14:20:00'))
    expect(awake(cst('2025-03-05T22:59:00'))).toEqual(cst('2025-03-05T22:59:00'))
    expect(awake(cst('2025-03-05T08:00:00'))).toEqual(cst('2025-03-05T08:00:00'))
    // the small hours move to that morning, the late evening to the next
    expect(awake(cst('2025-03-06T02:07:00'))).toEqual(cst('2025-03-06T09:07:00'))
    expect(awake(cst('2025-03-05T23:40:00'))).toEqual(cst('2025-03-06T09:40:00'))
  })
})
