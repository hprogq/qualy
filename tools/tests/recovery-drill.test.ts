import { describe, expect, it } from 'vitest'
import { ledgerAgainst, parseSums, stampTime } from '../release/recovery-drill.ts'

// The parts of the drill that decide something without a database: how a
// backup's name says when it was taken, how its sums are read, and whether
// its migration ledger belongs to this repository.

describe('what the recovery drill reads off a backup', () => {
  it('reads the moment from the directory name backup.sh gives it', () => {
    expect(stampTime('20260929T191701Z')?.toISOString()).toBe('2026-09-29T19:17:01.000Z')
    expect(stampTime('last-success')).toBeUndefined()
    expect(stampTime('.20260929T191701Z.partial')).toBeUndefined()
  })

  it('reads SHA256SUMS the way sha256sum writes it, text or binary mode', () => {
    const sums = parseSums(
      `${'a'.repeat(64)}  qualy.dump\n${'b'.repeat(64)} *storage.tar.gz\nnot a line\n`,
    )
    expect([...sums]).toEqual([
      ['qualy.dump', 'a'.repeat(64)],
      ['storage.tar.gz', 'b'.repeat(64)],
    ])
  })

  it('accepts a ledger that is behind this lineage and names one that is not of it', () => {
    const lineage = ['1_a.sql', '2_b.sql', '3_c.sql']
    expect(ledgerAgainst(['1_a.sql', '2_b.sql'], lineage)).toEqual({ foreign: [], behind: 1 })
    expect(ledgerAgainst(['1_a.sql', '9_elsewhere.sql'], lineage)).toEqual({
      foreign: ['9_elsewhere.sql'],
      behind: 2,
    })
  })
})
