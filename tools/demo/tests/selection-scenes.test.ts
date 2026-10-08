import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CET4_REPORTS, PAPERS } from '../seed/papers.ts'
import { randomStream } from '../seed/random-stream.ts'
import {
  CORRECTED_REPORT,
  COUNSELLOR_PAPER_STORIES,
  SELECTION_AWARD_PROOFS,
  historyBasis,
} from '../seed/selection-scenes.ts'

describe('selection demonstration material', () => {
  it('reserves distinct current histories and supplies the flawed and corrected evidence', () => {
    expect(new Set(COUNSELLOR_PAPER_STORIES.map((story) => story.kind))).toEqual(
      new Set([
        'initial',
        'revised',
        'multiple-rounds',
        'awaiting-supplement',
        'answered-supplement',
        'appeal',
        'reopen',
        'escalated',
      ]),
    )
    for (const story of COUNSELLOR_PAPER_STORIES) {
      const paper = PAPERS[story.item]!
      for (const asset of [paper.whole, paper.flawed, paper.ask.asset]) {
        expect(fs.existsSync(new URL(`../assets/${asset}.jpg`, import.meta.url))).toBe(true)
      }
    }
  })

  it('makes the second correction fix the typed score instead of replacing correct evidence', () => {
    expect(CORRECTED_REPORT.original.asset).toBe(PAPERS['cet4']!.flawed)
    expect(CORRECTED_REPORT.original.score).toBe(CORRECTED_REPORT.complete.score)
    expect(CORRECTED_REPORT.complete.asset).toBe(CORRECTED_REPORT.corrected.asset)
    const report = CET4_REPORTS.find((one) => one.asset === CORRECTED_REPORT.corrected.asset)!
    expect(CORRECTED_REPORT.complete.score).not.toBe(report.score)
    expect(CORRECTED_REPORT.corrected.score).toBe(report.score)
  })

  it('pairs award parameters with the facts on the selected certificate', () => {
    expect(SELECTION_AWARD_PROOFS).toEqual([
      { proof: 'competition-1', level: 'provincial', rank: 1, team: true },
      { proof: 'competition-2', level: 'national', rank: 3, team: false },
      { proof: 'competition-3', level: 'municipal', rank: 2, team: false },
      { proof: 'competition-4', level: 'provincial', rank: 1, team: false },
    ])
    for (const award of SELECTION_AWARD_PROOFS)
      expect(fs.existsSync(new URL(`../assets/${award.proof}.jpg`, import.meta.url))).toBe(true)
  })

  it('records the actual source terms and the provisional status at import time', () => {
    const basis = historyBasis(
      [
        { batchId: 'previous', term: '25-26-1', status: 'archived' },
        { batchId: 'current', term: '25-26-2', status: 'active' },
      ],
      new Date('2026-09-23T18:00:00Z'),
    )
    expect(basis).toContain('25-26-1、25-26-2 学期成绩')
    expect(basis).toContain('截至 2026-09-24')
    expect(basis).toContain('25-26-2 为未结束批次的阶段性成绩')
    expect(basis).toContain('后续变化由工作人员核对后更正')
    expect(basis).not.toContain('六学期')
  })
})

describe('stable event randomness', () => {
  const draws = (person: string, event: string) => {
    const random = randomStream('selection', person, event)
    return Array.from({ length: 12 }, () => random.next())
  }

  it('keeps a person’s event unchanged when other people or events are added', () => {
    const before = draws('person-a', 'competition')
    draws('new-person', 'competition')
    draws('person-a', 'transcript')
    expect(draws('person-a', 'competition')).toEqual(before)
    expect(draws('person-b', 'competition')).not.toEqual(before)
    expect(draws('person-a', 'transcript')).not.toEqual(before)
  })
})
