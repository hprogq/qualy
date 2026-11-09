import { describe, expect, it } from 'vitest'
import { submissionWindowOf, type SubmissionStage } from '../src/client/entry/submission-window.ts'

const stage = (
  displayName: string,
  status: SubmissionStage['status'],
  submitting: boolean | undefined,
  at: string | null,
  scope: Partial<SubmissionStage['scope']> = {},
): SubmissionStage => ({
  displayName,
  status,
  submitting,
  entry: { kind: at === null ? 'pending' : status === 'future' ? 'planned' : 'entered', at },
  scope: { items: null, participantsLimited: false, includesReader: null, ...scope },
})
const start = '2026-09-01T00:00:00Z'
const next = '2026-09-05T00:00:00Z'
const finish = '2026-09-07T00:00:00Z'

describe('submission countdown', () => {
  it('uses the end of consecutive phases that allow the same submission', () => {
    expect(
      submissionWindowOf(
        [
          stage('Filing', 'current', true, start),
          stage('Additional filing', 'future', true, next),
          stage('Review', 'future', false, finish),
        ],
        ['a'],
      ),
    ).toEqual({ stage: 'Filing', since: Date.parse(start), at: Date.parse(finish) })
  })

  it('does not claim a common deadline for projects whose scopes diverge', () => {
    const stages = [
      stage('Filing', 'current', true, start),
      stage('Limited', 'future', true, next, { items: [{ id: 'a' }] }),
      stage('Review', 'future', false, finish),
    ]
    expect(submissionWindowOf(stages, ['a', 'b'])).toBeNull()
    expect(submissionWindowOf(stages, ['a'])?.at).toBe(Date.parse(finish))
    expect(submissionWindowOf(stages, ['b'])?.at).toBe(Date.parse(next))
  })

  it('respects the reader scope and does not invent a cutoff for an unannounced transition', () => {
    const here = stage('Filing', 'current', true, start)
    const limited = stage('Other readers', 'future', true, next, {
      participantsLimited: true,
      includesReader: false,
    })
    expect(submissionWindowOf([here, limited], ['a'])?.at).toBe(Date.parse(next))
    expect(submissionWindowOf([here, stage('Review', 'future', false, null)], ['a'])).toBeNull()
    expect(
      submissionWindowOf([here, stage('Unknown', 'future', undefined, next)], ['a']),
    ).toBeNull()
    expect(
      submissionWindowOf([stage('Create only', 'current', false, start), limited], ['a']),
    ).toBeNull()
  })
})
