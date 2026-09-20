import { describe, expect, it } from 'vitest'
import { bindingOptionsResponse } from '../src/server/binding-options.ts'
import type { BindableFormulaVersion } from '../src/server/binding-catalog.ts'

// The shape of the binding-options answer, apart from the queries behind it:
// with the writer off nothing is on offer and the current binding is history
// only, whatever the catalog would have said about it.

const version = (versionId: string): BindableFormulaVersion => ({
  versionId,
  functionId: '01920000-0000-7000-8000-0000000000f1',
  functionName: 'Sum',
  functionDescription: '把两个数加起来',
  versionNo: 2,
  releaseName: '2026 秋季',
  publishedAt: '2026-09-01T00:00:00.000Z',
  contractSha256: 'c'.repeat(64),
  inputSchema: {
    type: 'object',
    properties: { b: { type: 'decimal' }, a: { type: 'decimal' } },
  } as unknown as BindableFormulaVersion['inputSchema'],
  outputSchema: { type: 'decimal' } as unknown as BindableFormulaVersion['outputSchema'],
})

const dto = (versionId: string) => ({
  versionId,
  functionId: '01920000-0000-7000-8000-0000000000f1',
  functionName: 'Sum',
  functionDescription: '把两个数加起来',
  versionNo: 2,
  releaseName: '2026 秋季',
  publishedAt: '2026-09-01T00:00:00.000Z',
  parameters: ['a', 'b'],
})

describe('the binding options answer', () => {
  it('offers nothing and keeps the current binding as history while authoring is off', () => {
    const bound = version('01920000-0000-7000-8000-0000000000a1')
    expect(
      bindingOptionsResponse({
        authoring: false,
        current: { version: bound, bindableForNew: true },
        offered: null,
      }),
    ).toEqual({
      items: [],
      nextCursor: null,
      current: { ...dto(bound.versionId), bindableForNew: false },
    })
    expect(bindingOptionsResponse({ authoring: false, current: null, offered: null })).toEqual({
      items: [],
      nextCursor: null,
      current: null,
    })
  })

  it('passes the page and the policy through while authoring is on', () => {
    const bound = version('01920000-0000-7000-8000-0000000000a1')
    const fresh = version('01920000-0000-7000-8000-0000000000a2')
    expect(
      bindingOptionsResponse({
        authoring: true,
        current: { version: bound, bindableForNew: true },
        offered: { items: [fresh], nextCursor: 'more' },
      }),
    ).toEqual({
      items: [dto(fresh.versionId)],
      nextCursor: 'more',
      current: { ...dto(bound.versionId), bindableForNew: true },
    })
  })
})
