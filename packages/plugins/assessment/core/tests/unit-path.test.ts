import { describe, expect, it } from 'vitest'
import { unitPathOf } from '../src/client/roster/unit-path.ts'

// Where somebody stands, said once for every screen that names it: from the
// top down, without the root everybody on the round shares, and with a unit
// that cannot be named kept in its place.

const names = new Map([
  ['school', '示例大学'],
  ['college', '软件学院'],
  ['grade', '2023级'],
  ['class', '软件2301班'],
])
const nameOf = (nodeId: string) => names.get(nodeId)
const step = (nodeId: string) => ({ nodeId })

describe('a participant’s unit path', () => {
  it('reads the frozen lineage from the top down, less the root', () => {
    // stored from their own unit up to the root
    const lineage = ['class', 'grade', 'college', 'school'].map(step)
    expect(unitPathOf(lineage, nameOf)).toEqual({
      path: '软件学院 / 2023级 / 软件2301班',
      unknown: 0,
    })
  })

  it('keeps a unit it cannot name in its place', () => {
    const lineage = ['gone', 'college', 'school'].map(step)
    expect(unitPathOf(lineage, nameOf)).toEqual({ path: '软件学院 / …', unknown: 1 })
  })

  it('names somebody who stands at the root itself', () => {
    expect(unitPathOf([step('school')], nameOf)).toEqual({ path: '示例大学', unknown: 0 })
  })
})
