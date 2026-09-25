import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { APPEAL_REASONS } from '../catalog.ts'
import { EVERY_ASK, askFor, requirementsOf } from '../seed/asks.ts'

// What the demonstration says was supplied has to be there when a visitor
// opens it. An ask names a file and its answer uploads a picture, so the
// picture must exist; an appeal carries a reason and nothing else, so no
// reason may say something is attached.

const ASSETS = path.resolve('tools/demo/assets')

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

  it('fit the question they are made on', () => {
    expect(askFor('competition').asset).toBe('notice-1')
    expect(askFor('conduct').asset).toBe('signature-1')
    // a question with no ask of its own gets the stamped participation note
    expect(askFor('campus').asset).toBe('campus-1')
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
