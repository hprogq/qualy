import { describe, expect, it } from 'vitest'
import { UNNAMED, namedChainOf, unitChainOf, unitPathOf } from '../src/client/roster/unit-path.ts'

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
      steps: ['软件学院', '2023级', '软件2301班'],
      path: '软件学院 / 2023级 / 软件2301班',
      unknown: 0,
    })
  })

  it('keeps a unit it cannot name in its place', () => {
    const lineage = ['gone', 'college', 'school'].map(step)
    expect(unitPathOf(lineage, nameOf)).toEqual({
      steps: ['软件学院', '…'],
      path: '软件学院 / …',
      unknown: 1,
    })
  })

  it('names somebody who stands at the root itself', () => {
    expect(unitPathOf([step('school')], nameOf)).toEqual({
      steps: ['示例大学'],
      path: '示例大学',
      unknown: 0,
    })
  })

  it('keeps the root on the whole chain, which every level is shown on', () => {
    const lineage = ['class', 'grade', 'college', 'school'].map(step)
    expect(unitChainOf(lineage, nameOf)).toEqual(['示例大学', '软件学院', '2023级', '软件2301班'])
    expect(unitChainOf(['gone', 'school'].map(step), nameOf)).toEqual(['示例大学', '…'])
  })
})

describe('a chain named by the server, with units that have gone', () => {
  const GONE = 'gone'

  it('says a gone unit by its word, never by the mark a line leaves levels off with', () => {
    const { levels, gone } = namedChainOf(['示例大学', '软件学院', null, '软件2301班'], GONE)
    expect(levels).toEqual(['示例大学', '软件学院', GONE, '软件2301班'])
    expect(levels).not.toContain(UNNAMED)
    expect(gone).toBe(1)
  })

  it('says a run of gone levels once', () => {
    expect(namedChainOf(['示例大学', null, null], GONE)).toEqual({
      levels: ['示例大学', GONE],
      gone: 2,
    })
    expect(namedChainOf(['示例大学', null, '2023级', null, null], GONE).levels).toEqual([
      '示例大学',
      GONE,
      '2023级',
      GONE,
    ])
  })

  it('leaves a chain with nothing gone as it came', () => {
    expect(namedChainOf(['示例大学', '软件学院'], GONE)).toEqual({
      levels: ['示例大学', '软件学院'],
      gone: 0,
    })
    expect(namedChainOf([], GONE)).toEqual({ levels: [], gone: 0 })
  })
})
