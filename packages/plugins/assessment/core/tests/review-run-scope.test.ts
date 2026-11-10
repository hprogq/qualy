import { describe, expect, it } from 'vitest'
import { readRunScope, runQueryOf, writeRunScope } from '../src/client/review/run-scope.ts'

describe('the review run carried between the queue and workbench', () => {
  it('round trips a group and its filters without pagination', () => {
    const raw = writeRunScope({
      kind: 'item',
      itemId: 'item-id',
      filters: { search: '  A & B  ', unitId: 'unit-id', mark: 'supplemented' },
    })
    expect(runQueryOf(readRunScope(raw))).toEqual({
      itemId: 'item-id',
      search: 'A & B',
      unitId: 'unit-id',
      mark: 'supplemented',
    })
  })

  it('continues to read existing all, item and person links', () => {
    expect(runQueryOf(readRunScope(''))).toEqual({})
    expect(runQueryOf(readRunScope('item:one'))).toEqual({ itemId: 'one' })
    expect(runQueryOf(readRunScope('person:one'))).toEqual({ person: 'one' })
  })

  it('does not pass an unrecognized state into the API request', () => {
    expect(runQueryOf(readRunScope('item:one?mark=unknown&page=8'))).toEqual({ itemId: 'one' })
  })
})
