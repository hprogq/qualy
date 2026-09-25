import { describe, expect, it } from 'vitest'
import { linkingOnly } from '../src/scoring/linking.ts'
import type { Breakdown } from '../src/scoring/calc.ts'

// An account read by somebody who may open only some of its claims keeps
// every line and amount, but names no claim the reader could not open -
// neither in the way through a line offers nor in the line's own id, which
// is built from the claim's.

const OPEN = '01a0b900-0000-7000-8000-000000000001'
const CLOSED = '01a0b900-0000-7000-8000-000000000002'

const account: Breakdown = {
  total: '5.00',
  groups: [],
  lines: [
    {
      lineId: `entry:${OPEN}`,
      kind: 'entry',
      label: '行政认定',
      value: '2.00',
      itemId: 'item-a',
      provenance: { entryId: OPEN, entryRevisionId: 'rev-open', calculatorRef: 'fixed@1' },
    },
    {
      lineId: `entry:${CLOSED}`,
      kind: 'entry',
      label: '竞赛获奖',
      value: '3.00',
      itemId: 'item-b',
      provenance: {
        entryId: CLOSED,
        entryRevisionId: 'rev-closed',
        entryRecognitionId: 'rec-closed',
        calculatorRef: 'fixed@1',
      },
    },
    {
      lineId: 'derived:item-c',
      kind: 'derived',
      label: '固定加分',
      value: '0.00',
      itemId: 'item-c',
    },
  ],
}

describe('an account linked only where the reader may go', () => {
  it('keeps every amount, and names no claim the reader cannot open', () => {
    const read = linkingOnly(account, new Set([OPEN]))
    expect(read.total).toBe(account.total)
    expect(read.lines.map((line) => line.value)).toEqual(['2.00', '3.00', '0.00'])
    // the line the reader may follow is untouched
    expect(read.lines[0]).toEqual(account.lines[0])
    const closed = read.lines[1]!
    expect(closed.provenance).toEqual({ calculatorRef: 'fixed@1' })
    expect(closed.lineId).not.toContain(CLOSED)
    expect(JSON.stringify(read)).not.toContain(CLOSED)
    expect(JSON.stringify(read)).not.toContain('rev-closed')
    // ids stay unique within the account
    expect(new Set(read.lines.map((line) => line.lineId)).size).toBe(read.lines.length)
    expect(read.lines[2]).toEqual(account.lines[2])
  })
})
