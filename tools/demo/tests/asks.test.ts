import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { APPEAL_REASONS } from '../catalog.ts'
import { EVERY_ASK, SCRIPTED_ASKS, askFor, requirementsOf, type Filing } from '../seed/asks.ts'
import { claimsOf } from '../seed/claims.ts'
import { makeRandom } from '../seed/context.ts'
import { PROOF_ASSETS } from '../seed/files.ts'
import { CET4_REPORTS, PAPERS } from '../seed/papers.ts'
import { TERM_PLANS } from '../seed/term.ts'
import type { Student } from '../seed/world.ts'

// What the demonstration says was supplied has to be there when a visitor
// opens it. An ask names a file and its answer uploads a picture, so the
// picture must exist and must be something the claim did not already have;
// an appeal carries a reason and nothing else, so no reason may say
// something is attached.

const ASSETS = path.resolve('tools/demo/assets')

/** what the chance flows file, over every term and a spread of students */
const termFilings = (): Filing[] => {
  const random = makeRandom(7)
  const filings: Filing[] = []
  for (const plan of TERM_PLANS) {
    for (let i = 0; i < 60; i++) {
      const student: Student = {
        id: `s${i}`,
        name: '',
        number: '',
        classKey: '2023-se-1',
        major: 'se',
        activity: (i % 10) / 10 + 0.05,
        standing: 0.5,
      }
      filings.push(...claimsOf(student, plan.term, random, plan.material))
    }
  }
  return filings
}

/** what the selection's applicants file by chance: every paper both ways, and awards */
const selectionFilings = (): Filing[] => [
  ...Object.entries(PAPERS).flatMap(([item, paper]) =>
    [paper.whole, paper.flawed].map((proof) => ({ item, payload: {}, proof })),
  ),
  ...CET4_REPORTS.flatMap((report) =>
    [report.asset, PAPERS['cet4']!.flawed].map((proof) => ({
      item: 'cet4',
      payload: { score: report.score },
      proof,
    })),
  ),
  ...PROOF_ASSETS.competition.map((proof) => ({ item: 'competition', payload: {}, proof })),
  ...[...PROOF_ASSETS.project, ...PROOF_ASSETS.software].map((proof) => ({
    item: 'research',
    payload: {},
    proof,
  })),
]

describe('asks for more material', () => {
  it('ask for a file, with a note beside it at most', () => {
    for (const ask of EVERY_ASK) {
      const pieces = requirementsOf(ask)
      expect(pieces.filter((one) => one.kind === 'file' && one.required)).toHaveLength(1)
      expect(pieces.filter((one) => one.kind === 'text' && one.required)).toEqual([])
    }
  })

  it('are answered with a picture that is there', () => {
    const absent = EVERY_ASK.filter(
      (ask) => !fs.existsSync(path.join(ASSETS, `${ask.asset}.jpg`)),
    ).map((ask) => ask.asset)
    expect(absent).toEqual([])
  })

  it('are never answered with the picture the claim was filed with', () => {
    const filings = [...termFilings(), ...selectionFilings()]
    const repeated = filings
      .filter((filing) => askFor(filing)?.asset === filing.proof)
      .map((filing) => `${filing.item} ${filing.proof}`)
    expect([...new Set(repeated)]).toEqual([])
  })

  it('are made by chance only on questions with an ask of their own', () => {
    const asked = new Set(
      [...termFilings(), ...selectionFilings()]
        .filter((filing) => askFor(filing) !== undefined)
        .map((filing) => filing.item),
    )
    expect([...asked].sort()).toEqual(
      [
        'campus',
        'competition',
        'practice',
        'research',
        'sport',
        'application',
        'conduct',
        'transcript',
        'cet4',
      ].sort(),
    )
    for (const item of [
      'certificate',
      'language',
      'blood',
      'instructor',
      'flag-guard',
      'article',
    ]) {
      expect(askFor({ item, payload: {}, proof: 'certificate-1' })).toBeUndefined()
    }
  })

  it('ask about a paper only when it lacks what the ask names', () => {
    for (const [item, paper] of Object.entries(PAPERS)) {
      expect(askFor({ item, payload: { score: 531 }, proof: paper.whole })).toBeUndefined()
      expect(askFor({ item, payload: { score: 531 }, proof: paper.flawed })).toBeDefined()
    }
    // the report that comes back shows the score that was filed
    for (const report of CET4_REPORTS) {
      const ask = askFor({
        item: 'cet4',
        payload: { score: report.score },
        proof: PAPERS['cet4']!.flawed,
      })
      expect(ask?.asset).toBe(report.asset)
    }
  })

  it('made by the episodes and scenes come back with another picture than the one filed', () => {
    for (const [name, { on, ask }] of Object.entries(SCRIPTED_ASKS)) {
      expect(ask.asset, name).not.toBe(on)
      expect(fs.existsSync(path.join(ASSETS, `${ask.asset}.jpg`)), name).toBe(true)
      expect(requirementsOf(ask).filter((one) => one.required)).toHaveLength(1)
    }
  })

  it('ask for the team roster only on a team award', () => {
    expect(askFor({ item: 'sport', payload: { team: true }, proof: 'sport-1' })?.asset).toBe(
      'roster-1',
    )
    expect(askFor({ item: 'sport', payload: { team: false }, proof: 'sport-1' })).toBeUndefined()
  })
})

describe('appeal reasons', () => {
  it('never say something is attached', () => {
    const claiming = Object.values(APPEAL_REASONS)
      .flat()
      .filter((reason) => /附|已补充|现已|补交了/.test(reason))
    expect(claiming).toEqual([])
  })
})
