import { describe, expect, it } from 'vitest'
import { positionalOf, seedOptionsOf } from '../options.ts'
import { judgeSituations, judgeStandings, type Situation, type Standing } from '../situations.ts'

// demo:check reads the flags demo:seed was given, and asks for a situation
// only when the run was meant to write it.

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
    { account: 'student', label: 'reopened', count: 0, needs: 'last-term' },
    { account: 'counsellor', label: 'roster', count: 0, needs: 'ruling' },
  ]
  const labels = (list: readonly Situation[]) => list.map((one) => one.label)
  const full = { stage: 'review', migrationBefore: false, lastTerm: true } as const

  it('requires everything a full run writes, but never what waits on a ruling', () => {
    const judged = judgeSituations(situations, full)
    expect(labels(judged.missing)).toEqual(['always', 'appeal', 'reroute', 'reopened'])
    expect(labels(judged.pending)).toEqual(['roster'])
    expect(judged.notExpected).toEqual([])
  })

  it('leaves appeals and the route change out while the selection is still filing', () => {
    const judged = judgeSituations(situations, { ...full, stage: 'entry' })
    expect(labels(judged.missing)).toEqual(['always', 'reopened'])
    expect(labels(judged.notExpected)).toEqual(['appeal', 'reroute'])
  })

  it('leaves the route change out when it was kept for the demonstration', () => {
    const judged = judgeSituations(situations, { ...full, migrationBefore: true })
    expect(labels(judged.missing)).toEqual(['always', 'appeal', 'reopened'])
    expect(labels(judged.notExpected)).toEqual(['reroute'])
  })

  it('leaves out what only the last term writes when the run stopped before it', () => {
    const judged = judgeSituations(situations, { ...full, lastTerm: false })
    expect(labels(judged.missing)).toEqual(['always', 'appeal', 'reroute'])
    expect(labels(judged.notExpected)).toEqual(['reopened'])
  })
})

describe('what the two demonstration students show in every batch', () => {
  const batches = ['autumn', 'selection']
  const standing = (account: Standing['account'], batch: string, claims: number, total: string) =>
    ({ account, batch, claims, total }) satisfies Standing
  const whole = [
    standing('student', 'autumn', 7, '78.20'),
    standing('class-lead', 'autumn', 4, '74.35'),
    standing('student', 'selection', 9, '88.10'),
    standing('class-lead', 'selection', 5, '86.02'),
  ]

  it('passes claims of their own and a total of their own in every batch', () => {
    expect(judgeStandings(batches, whole)).toEqual([])
  })

  it('names a batch where one of them filed nothing, or is not on the roster', () => {
    const problems = judgeStandings(batches, [
      standing('student', 'autumn', 7, '78.20'),
      standing('class-lead', 'autumn', 0, '61.00'),
      standing('student', 'selection', 9, '88.10'),
    ])
    expect(problems).toEqual([
      'class-lead: nothing of their own in autumn',
      'class-lead: not on the roster of selection',
    ])
  })

  it('names an empty result, an unreadable one, and two totals alike', () => {
    const problems = judgeStandings(batches, [
      standing('student', 'autumn', 7, '0.00'),
      { ...standing('class-lead', 'autumn', 4, ''), total: null },
      standing('student', 'selection', 9, '86.02'),
      standing('class-lead', 'selection', 5, '86.02'),
    ])
    expect(problems).toEqual([
      'student: a total of 0 in autumn',
      'class-lead: no result to read in autumn',
      'both at 86.02 in selection',
    ])
  })
})
