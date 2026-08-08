import { describe, expect, it } from 'vitest'
import { encodeQueryCursor, readQueryCursor } from '../src/index.ts'

// A cursor is client-held, so every part of it is attacker-controlled. What
// makes it safe is that the only two answers are "the key" and "unusable" -
// never "the first page", and never a value passed on to a query. A part
// naming a uuid column is the sharp case: `id > 'x'` reaches postgres as a
// cast error, which the query path turns into a defect, so a malformed
// request would be answered with a 500 rather than the refusal the contract
// prescribes.

const encode = (payload: unknown) =>
  btoa(JSON.stringify(payload)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')

const ID = '0198f37b-9a63-7b3e-8f1a-6f9d0c3b2a41'

describe('the pagination cursor', () => {
  it('reads back what it wrote, and only for the same query', () => {
    const cursor = encodeQueryCursor('users:a:subtree:', ['Wang', ID])
    expect(readQueryCursor(cursor, 'users:a:subtree:', ['text', 'uuid'])).toEqual(['Wang', ID])
    // a cursor from another filter would silently skip or repeat rows
    expect(readQueryCursor(cursor, 'users:b:subtree:', ['text', 'uuid'])).toBeNull()
    expect(readQueryCursor(undefined, 'users:a:subtree:', ['text', 'uuid'])).toBeUndefined()
  })

  it('refuses a part that is not the shape its column holds', () => {
    // structurally valid, semantically a cast error waiting to happen
    expect(
      readQueryCursor(encode({ v: 1, q: 'grants:', k: ['x'] }), 'grants:', ['uuid']),
    ).toBeNull()
    expect(readQueryCursor(encode({ v: 1, q: 'grants:', k: [ID] }), 'grants:', ['uuid'])).toEqual([
      ID,
    ])
    // free text stays free: only the parts declared uuid are constrained
    expect(
      readQueryCursor(encode({ v: 1, q: 'users:', k: ['x', ID] }), 'users:', ['text', 'uuid']),
    ).toEqual(['x', ID])
  })

  it('refuses what it cannot read at all', () => {
    for (const bad of [
      'not-base64!!',
      encode({ v: 2, q: 'grants:', k: [ID] }),
      encode({ v: 1, q: 'grants:', k: [ID, ID] }),
      encode({ v: 1, q: 'grants:', k: [7] }),
      encode({ v: 1, q: 'grants:' }),
    ]) {
      expect(readQueryCursor(bad, 'grants:', ['uuid'])).toBeNull()
    }
  })
})
