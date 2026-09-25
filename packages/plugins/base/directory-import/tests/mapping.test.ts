import { describe, expect, it } from 'vitest'
import { resolveChain } from '../src/server/mapping.ts'
import { desiredTree, judgeRows } from '../src/server/plan.ts'

// The reading of a mapping and of a file, with nothing looked up: the chain
// the grammar admits, the chain it refuses, and the tree a set of rows
// implies.

const SCHOOL = '11111111-1111-4111-8111-111111111101'
const CAMPUS = '11111111-1111-4111-8111-111111111102'
const COLLEGE = '11111111-1111-4111-8111-111111111103'
const GRADE = '11111111-1111-4111-8111-111111111104'
const CLASS = '11111111-1111-4111-8111-111111111105'
const ROOT = '22222222-2222-4222-8222-222222222201'
const SOFTWARE = '22222222-2222-4222-8222-222222222202'

const types = [
  { id: SCHOOL, name: '学校', sortOrder: 0 },
  { id: CAMPUS, name: '校区', sortOrder: 1 },
  { id: COLLEGE, name: '学院', sortOrder: 2 },
  { id: GRADE, name: '年级', sortOrder: 3 },
  { id: CLASS, name: '班级', sortOrder: 4 },
]
const rules = [
  { parentTypeId: SCHOOL, childTypeId: CAMPUS },
  { parentTypeId: SCHOOL, childTypeId: COLLEGE },
  { parentTypeId: CAMPUS, childTypeId: COLLEGE },
  { parentTypeId: COLLEGE, childTypeId: GRADE },
  { parentTypeId: COLLEGE, childTypeId: CLASS },
  { parentTypeId: GRADE, childTypeId: CLASS },
]
const root = { id: ROOT, parentId: null, orgTypeId: SCHOOL, name: '示例大学', path: 'r', depth: 0 }
const software = {
  id: SOFTWARE,
  parentId: ROOT,
  orgTypeId: COLLEGE,
  name: '软件学院',
  path: 'r.s',
  depth: 1,
}
const headers = new Set(['A', 'B', 'C', 'D', 'E'])

const mapping = (
  levels: readonly { orgTypeId: string; column: string }[],
  anchorNodeId: string | null = null,
) => ({
  displayName: { column: 'B' },
  businessNo: { column: 'A' },
  organization: { anchorNodeId, levels },
})

describe('resolving the chain of units', () => {
  it('orders the chosen levels the one way the grammar admits, whatever order they came in', () => {
    const resolved = resolveChain({
      root,
      types,
      rules,
      ancestry: [root],
      mapping: mapping([
        { orgTypeId: CLASS, column: 'E' },
        { orgTypeId: COLLEGE, column: 'C' },
        { orgTypeId: GRADE, column: 'D' },
      ]),
      headers,
    })
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(
      resolved.chain.levels.map((level) => [level.orgTypeName, level.source, level.column]),
    ).toEqual([
      ['学校', 'root', null],
      ['学院', 'column', 'C'],
      ['年级', 'column', 'D'],
      ['班级', 'column', 'E'],
    ])
    expect(resolved.chain.leafTypeId).toBe(CLASS)
    expect(resolved.chain.anchor.id).toBe(ROOT)
  })

  it('starts under the anchor, and refuses a level the anchor already stands at', () => {
    const under = resolveChain({
      root,
      types,
      rules,
      ancestry: [root, software],
      mapping: mapping([{ orgTypeId: CLASS, column: 'E' }], SOFTWARE),
      headers,
    })
    expect(under.ok).toBe(true)
    if (under.ok) {
      expect(under.chain.levels.map((level) => level.source)).toEqual([
        'root',
        'fixed-node',
        'column',
      ])
      expect(under.chain.anchor.id).toBe(SOFTWARE)
    }
    const above = resolveChain({
      root,
      types,
      rules,
      ancestry: [root, software],
      mapping: mapping([{ orgTypeId: COLLEGE, column: 'C' }], SOFTWARE),
      headers,
    })
    expect(above).toEqual({ ok: false, problem: { reason: 'type-above-anchor', subject: COLLEGE } })
  })

  it('never fills a gap the file does not carry, and names where the chain breaks', () => {
    // school -> campus -> class has no campus -> class rule, and the chain
    // is not allowed to go through the college the file never mentions
    const broken = resolveChain({
      root,
      types,
      rules,
      ancestry: [root],
      mapping: mapping([
        { orgTypeId: CAMPUS, column: 'C' },
        { orgTypeId: CLASS, column: 'E' },
      ]),
      headers,
    })
    expect(broken).toEqual({ ok: false, problem: { reason: 'chain-broken', subject: CAMPUS } })
  })

  it('refuses a fork the grammar leaves open', () => {
    // school parents both campus and college: with both chosen and no rule
    // between them, either could come first
    const ambiguous = resolveChain({
      root,
      types,
      rules: rules.filter(
        (rule) => !(rule.parentTypeId === CAMPUS && rule.childTypeId === COLLEGE),
      ),
      ancestry: [root],
      mapping: mapping([
        { orgTypeId: CAMPUS, column: 'C' },
        { orgTypeId: COLLEGE, column: 'D' },
      ]),
      headers,
    })
    expect(ambiguous).toEqual({
      ok: false,
      problem: { reason: 'chain-ambiguous', subject: SCHOOL },
    })
  })

  it('holds every column to the sheet, and one field per column', () => {
    expect(
      resolveChain({
        root,
        types,
        rules,
        ancestry: [root],
        mapping: mapping([{ orgTypeId: COLLEGE, column: 'Z' }]),
        headers,
      }),
    ).toEqual({ ok: false, problem: { reason: 'column-missing', subject: 'Z' } })
    expect(
      resolveChain({
        root,
        types,
        rules,
        ancestry: [root],
        mapping: mapping([{ orgTypeId: COLLEGE, column: 'A' }]),
        headers,
      }),
    ).toEqual({ ok: false, problem: { reason: 'column-repeated', subject: 'A' } })
  })
})

describe('judging the rows of a file', () => {
  const chain = (() => {
    const resolved = resolveChain({
      root,
      types,
      rules,
      ancestry: [root],
      mapping: mapping([
        { orgTypeId: COLLEGE, column: 'C' },
        { orgTypeId: CLASS, column: 'D' },
      ]),
      headers,
    })
    if (!resolved.ok) throw new Error('fixture chain')
    return resolved.chain
  })()

  it('names what each incomplete row lacks, and a repeated identifier by its first row', () => {
    const rows = judgeRows(
      [
        { rowNo: 2, cells: { A: '001', B: '张三', C: '软件学院', D: '1班' } },
        { rowNo: 3, cells: { A: '001', B: '李四', C: '软件学院', D: '1班' } },
        { rowNo: 4, cells: { B: '王五', C: '软件学院' } },
      ],
      mapping([]),
      chain,
    )
    expect(rows[0]!.issues).toEqual([])
    expect(rows[1]!.issues.map((issue) => [issue.reason, issue.detail])).toEqual([
      ['duplicate-in-file', '2'],
    ])
    expect(rows[2]!.issues.map((issue) => [issue.field, issue.reason])).toEqual([
      ['businessNo', 'business-no-required'],
      [`org.${CLASS}`, 'org-level-required'],
    ])
  })

  it('holds each field to the column it is written to, and refuses control characters', () => {
    const rows = judgeRows(
      [
        { rowNo: 2, cells: { A: '001', B: '张'.repeat(100), C: '软件学院', D: '1班' } },
        { rowNo: 3, cells: { A: '002', B: '李'.repeat(101), C: '软件学院', D: '1班' } },
        { rowNo: 4, cells: { A: '0\u00003', B: '王五', C: '软件学院', D: '1班' } },
        { rowNo: 5, cells: { A: '004', B: '赵\n六', C: '软件学院', D: '1班' } },
        { rowNo: 6, cells: { A: '005', B: '孙七', C: '软件学院\u001f1班', D: '1班' } },
      ],
      mapping([]),
      chain,
    )
    expect(rows.map((row) => row.issues.map((issue) => [issue.field, issue.reason]))).toEqual([
      [],
      [['displayName', 'display-name-too-long']],
      [['businessNo', 'control-character']],
      [['displayName', 'control-character']],
      [[`org.${COLLEGE}`, 'control-character']],
    ])
    // the separator a path is keyed by cannot arrive from a cell, so no two
    // paths fold into one unit
    expect(desiredTree(rows, chain).map((node) => node.names.join('/'))).toEqual([
      '软件学院',
      '软件学院/1班',
    ])
  })

  it('folds complete rows into one tree, parents before children', () => {
    const rows = judgeRows(
      [
        { rowNo: 2, cells: { A: '001', B: '张三', C: '软件学院', D: '1班' } },
        { rowNo: 3, cells: { A: '002', B: '李四', C: '软件学院', D: '1班' } },
        { rowNo: 4, cells: { A: '003', B: '王五', C: '软件学院', D: '2班' } },
        { rowNo: 5, cells: { A: '004', B: '赵六', C: '外语学院', D: '1班' } },
        { rowNo: 6, cells: { A: '', B: '孙七', C: '外语学院', D: '9班' } },
      ],
      mapping([]),
      chain,
    )
    const tree = desiredTree(rows, chain)
    expect(tree.map((node) => [node.depth, node.names.join('/'), node.orgTypeId])).toEqual([
      [1, '外语学院', COLLEGE],
      [1, '软件学院', COLLEGE],
      [2, '外语学院/1班', CLASS],
      [2, '软件学院/1班', CLASS],
      [2, '软件学院/2班', CLASS],
    ])
  })
})
