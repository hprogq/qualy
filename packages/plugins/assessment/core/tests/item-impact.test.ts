import { describe, expect, it } from 'vitest'
import { impactOf } from '../src/item/impact.ts'

// What counts as a change to a live question. jsonb hands its objects back
// with the keys re-sorted, so a configuration that came out of the
// database and the same configuration typed in a browser differ in key
// order and in nothing else - a report that called that a change opened a
// dialog about work the save would never have touched.

const FORM = {
  fields: [
    { id: 'f1', key: 'f1', type: 'text', label: '献血地点', required: true },
    { id: 'f2', key: 'f2', type: 'date', label: '献血时间', required: true },
  ],
}
const POLICY = {
  normal: {
    stages: [
      {
        id: 's1',
        label: '初审',
        selector: { kind: 'roleAt', nodeTypeId: 'n1', roleIds: ['r1', 'r2'] },
        quorum: { type: 'any' },
      },
    ],
  },
}

/** the same thing, with every object's keys written in another order */
const reordered = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(reordered)
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(record)
        .reverse()
        .map((key) => [key, reordered(record[key])]),
    )
  }
  return value
}

const report = (next: { formConfig: unknown; reviewPolicy: unknown }) =>
  impactOf({
    currentRevisionId: 'rev-1',
    currentConfig: { formConfig: FORM, reviewPolicy: POLICY },
    nextConfig: next,
    live: [
      {
        entryId: 'e1',
        status: 'in_review',
        reviewInstanceId: 'ri-1',
        entryRevisionId: 'er-1',
        itemRevisionId: 'rev-1',
        payload: {},
        formConfig: FORM,
      },
    ],
    rounds: [
      {
        id: 'ri-1',
        entryId: 'e1',
        revisionId: 'er-1',
        participantId: 'p-1',
        state: 'active',
        route: 'normal',
        stageId: 's1',
        effectiveChain: POLICY,
      },
    ],
    incompatible: [],
  })

describe('what counts as a change to a live question', () => {
  it('reads a key-reordered configuration as the same configuration', () => {
    const impact = report({
      formConfig: reordered(FORM),
      reviewPolicy: reordered(POLICY),
    })
    expect(impact.form.changed).toBe(false)
    expect(impact.review.changed).toBe(false)
    // and with nothing changed, the round in flight is not counted against
    expect(impact.review.sameStageMappable).toBe(0)
  })

  it('still sees a real edit: one renamed label, one stage gone', () => {
    const renamed = {
      fields: [{ ...FORM.fields[0]!, label: '采血地点' }, FORM.fields[1]!],
    }
    expect(report({ formConfig: renamed, reviewPolicy: POLICY }).form.changed).toBe(true)
    expect(
      report({ formConfig: FORM, reviewPolicy: { normal: { stages: [] } } }).review.changed,
    ).toBe(true)
  })

  it('keeps array order meaningful: two fields swapped is a change', () => {
    const swapped = { fields: [FORM.fields[1]!, FORM.fields[0]!] }
    expect(report({ formConfig: swapped, reviewPolicy: POLICY }).form.changed).toBe(true)
  })
})
