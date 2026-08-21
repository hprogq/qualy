import { describe, expect, it } from 'vitest'
import { projectEntrySummary } from '../src/entry/summary.ts'

// One claim, one identity line (§32.74): the configured fields in their
// configured order, or the first fields that can actually identify the
// claim - never attachments, never blanks in the fallback, and blanks
// kept in the configured case so tables keep their columns.

const FORM = {
  fields: [
    { id: 'f-cert', key: 'cert', label: '获奖证书', type: 'attachment' },
    { id: 'f-date', key: 'date', label: '获奖日期', type: 'date' },
    { id: 'f-name', key: 'name', label: '竞赛名称', type: 'text' },
    { id: 'f-level', key: 'level', label: '竞赛级别', type: 'text' },
    { id: 'f-award', key: 'award', label: '获奖等级', type: 'text' },
  ],
}

describe('the entry summary projection', () => {
  it('follows the configured order, keeps configured blanks, drops attachments', () => {
    const parts = projectEntrySummary({
      formConfig: FORM,
      displayConfig: { entrySummary: { fieldIds: ['f-name', 'f-cert', 'f-award', 'f-level'] } },
      payload: { name: '中国机器人大赛', award: '' },
    })
    // the attachment is refused, the fourth id falls off the cap, and the
    // blank award keeps its column
    expect(parts).toEqual([
      { fieldId: 'f-name', label: '竞赛名称', value: '中国机器人大赛' },
      { fieldId: 'f-award', label: '获奖等级', value: '' },
      { fieldId: 'f-level', label: '竞赛级别', value: '' },
    ])
  })

  it('falls back to the first identifying fields: no attachments, no blanks', () => {
    const parts = projectEntrySummary({
      formConfig: FORM,
      displayConfig: null,
      payload: { date: '2026-05-13', name: '蓝桥杯', level: '', award: '二等奖' },
    })
    expect(parts).toEqual([
      { fieldId: 'f-date', label: '获奖日期', value: '2026-05-13' },
      { fieldId: 'f-name', label: '竞赛名称', value: '蓝桥杯' },
      { fieldId: 'f-award', label: '获奖等级', value: '二等奖' },
    ])
  })

  it('answers a formless or empty claim with no parts at all', () => {
    expect(projectEntrySummary({ formConfig: null, displayConfig: null, payload: {} })).toEqual([])
    expect(projectEntrySummary({ formConfig: FORM, displayConfig: null, payload: {} })).toEqual([])
  })

  it('reaches configured fields by founding key when the form has no ids', () => {
    const bare = { fields: [{ key: 'name', label: '名称', type: 'text' }] }
    expect(
      projectEntrySummary({
        formConfig: bare,
        displayConfig: { entrySummary: { fieldIds: ['name'] } },
        payload: { name: '值' },
      }),
    ).toEqual([{ fieldId: 'name', label: '名称', value: '值' }])
  })
})
