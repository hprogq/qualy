import { describe, expect, it } from 'vitest'
import { grantsOf } from '../src/client/access/model.ts'

// The staff page shows what each role gives, where it used to show one line
// per person. The page may only divide what the server said, never add to
// it: the roles' capabilities in force, put together, are the person's
// `effective` exactly as readAccess sums it - each source's `current`, the
// person's turned-off ones taken out.

const sumOf = (sources: readonly { current: readonly string[] }[], denied: readonly string[]) =>
  [
    ...new Set(
      sources.flatMap((source) => grantsOf({ current: [...source.current] }, denied).inForce),
    ),
  ].sort()

const serverEffective = (
  sources: readonly { current: readonly string[] }[],
  denied: readonly string[],
) =>
  [...new Set(sources.flatMap((source) => source.current))]
    .filter((code) => !denied.includes(code))
    .sort()

describe('what each role gives in a round', () => {
  const cases = [
    {
      name: 'one role',
      sources: [{ current: ['assessment.review.process', 'assessment.ranking.view'] }],
      denied: [],
    },
    {
      name: 'three roles, overlapping, one capability turned off for the person',
      sources: [
        { current: ['assessment.review.process', 'assessment.ranking.view'] },
        { current: ['assessment.entry.read-all', 'assessment.review.process'] },
        { current: ['assessment.entry.record'] },
      ],
      denied: ['assessment.review.process'],
    },
    {
      name: 'a lapsed role, which carries nothing',
      sources: [{ current: [] }, { current: ['assessment.ranking.view'] }],
      denied: [],
    },
  ]

  for (const one of cases) {
    it(`adds up to what the person may do: ${one.name}`, () => {
      expect(sumOf(one.sources, one.denied)).toEqual(serverEffective(one.sources, one.denied))
    })
  }

  it('says a turned-off capability under every role that carries it, and nowhere else', () => {
    const denied = ['assessment.review.process']
    expect(
      grantsOf({ current: ['assessment.review.process', 'assessment.ranking.view'] }, denied),
    ).toEqual({
      inForce: ['assessment.ranking.view'],
      turnedOff: ['assessment.review.process'],
    })
    expect(grantsOf({ current: ['assessment.entry.record'] }, denied)).toEqual({
      inForce: ['assessment.entry.record'],
      turnedOff: [],
    })
  })
})
