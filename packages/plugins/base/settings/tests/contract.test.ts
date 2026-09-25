import { describe, expect, it } from 'vitest'
import { Exit, Schema } from 'effect'
import { settingsApiGroup } from '../src/api.ts'

// The version a term is written against, on the wire.
//
// The write stores it plus one in an int4 column and matches the row on it,
// so a number past what that column holds was not an empty answer but a
// database error (22003) - a 500 for a malformed request. The boundary says
// so first.

const [payload] = [...settingsApiGroup.endpoints.putTerm.payload.values()]
const decode = Schema.decodeUnknownExit(
  payload!.schemas[0] as unknown as Schema.Codec<unknown, unknown>,
)

describe('the version a term is written against', () => {
  it('reads every version the column can take a step past, and nothing beyond', () => {
    expect(Exit.isSuccess(decode({ version: 0, override: {} }))).toBe(true)
    expect(Exit.isSuccess(decode({ version: 2_147_483_646, override: {} }))).toBe(true)
    // stored plus one, this would no longer fit
    expect(Exit.isSuccess(decode({ version: 2_147_483_647, override: {} }))).toBe(false)
    expect(Exit.isSuccess(decode({ version: 3_000_000_000, override: {} }))).toBe(false)
  })
})
