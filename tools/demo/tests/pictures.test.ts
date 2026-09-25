import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { PICTURES } from '../pictures.ts'
import { PROOF_ASSETS } from '../seed/files.ts'

// The pictures claims are filed with stand behind claims in every term, from
// the spring of 2024 to the autumn of 2026. A date on one of them is wrong
// for most of those claims: a certificate issued after the claim was filed,
// or long before the term it is claimed in.

const ASSETS = path.resolve('tools/demo/assets')
const DATED = /二〇[〇一二三四五六七八九]{2}年|\d{4}\s*年|\d{4}-\d{2}-\d{2}/
const shared = [...new Set(Object.values(PROOF_ASSETS).flat())]

describe('the pictures claims are filed with', () => {
  it('are drawn and rendered', () => {
    expect(shared.filter((name) => PICTURES[name] === undefined)).toEqual([])
    expect(shared.filter((name) => !fs.existsSync(path.join(ASSETS, `${name}.jpg`)))).toEqual([])
  })

  it('carry no date, since any term may cite them', () => {
    expect(shared.filter((name) => DATED.test(PICTURES[name] ?? ''))).toEqual([])
  })
})
