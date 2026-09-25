import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { itemsOf, type Term } from '../rules.ts'
import { EPISODE_KINDS, EPISODES, TRIAL_ITEM, episodesOf } from '../seed/episodes.ts'

// The persona student's written-out terms are only ever played by a full
// seeding run, which takes over an hour. These catch, in a second, the
// mistakes that would otherwise surface near its end: an episode nobody
// plays, a claim on a question the term does not ask, a field the form does
// not have.

const questionsOf = (term: Term) => [...itemsOf(term), TRIAL_ITEM]
const ASSETS = path.resolve('tools/demo/assets')

describe('the persona episodes', () => {
  afterEach(() => {
    delete process.env.QUALY_DEMO_EPISODES
  })

  it('plays every kind of episode in some term', () => {
    const played = new Set(Object.values(EPISODES).flatMap((list) => list.map((one) => one.kind)))
    expect([...EPISODE_KINDS].filter((kind) => !played.has(kind))).toEqual([])
  })

  it('files each claim on a question its term asks, with fields its form has', () => {
    const problems: string[] = []
    for (const term of Object.keys(EPISODES) as Term[]) {
      const questions = questionsOf(term)
      for (const episode of EPISODES[term]) {
        for (const claim of [episode.first, episode.claim, episode.refiled]) {
          if (claim === undefined) continue
          const question = questions.find((one) => one.key === claim.item)
          if (question === undefined) {
            problems.push(`${term} ${episode.kind}: no question ${claim.item}`)
            continue
          }
          const fields = new Set(question.fields.map((field) => field.key))
          for (const key of [
            ...Object.keys(claim.payload),
            ...Object.keys(episode.corrected ?? {}),
          ]) {
            if (!fields.has(key)) problems.push(`${term} ${episode.kind}: no field ${key}`)
          }
        }
      }
    }
    expect(problems).toEqual([])
  })

  it('gives each episode the claims its kind plays', () => {
    const missing = Object.values(EPISODES)
      .flat()
      .filter(
        (episode) =>
          (episode.kind !== 'record-void' && episode.claim === undefined) ||
          (episode.kind === 'item-void' &&
            (episode.claim?.item !== TRIAL_ITEM.key || episode.refiled === undefined)) ||
          (episode.kind === 'rounds' && episode.corrected === undefined) ||
          (episode.kind === 'revoke' && episode.first === undefined),
      )
      .map((episode) => episode.kind)
    expect(missing).toEqual([])
  })

  it('revokes a claim that duplicates one filed before it', () => {
    // the revocation's reason names another claim of the same activity; the
    // term has to hold it, or the reason is false on the page
    for (const episode of Object.values(EPISODES)
      .flat()
      .filter((one) => one.kind === 'revoke')) {
      expect(episode.first?.item).toBe(episode.claim?.item)
      expect(episode.first?.payload['activity']).toBe(episode.claim?.payload['activity'])
    }
  })

  it('files each claim with a picture that is there', () => {
    const absent = Object.values(EPISODES)
      .flat()
      .flatMap((episode) => [episode.first, episode.claim, episode.refiled])
      .filter((claim) => claim !== undefined)
      .filter((claim) => !fs.existsSync(path.join(ASSETS, `${claim.proof}.jpg`)))
      .map((claim) => claim.proof)
    expect(absent).toEqual([])
  })

  it('plays every episode in the first term when asked to', () => {
    process.env.QUALY_DEMO_EPISODES = 'first'
    expect(episodesOf('23-24-1', 0)).toHaveLength(Object.values(EPISODES).flat().length)
    expect(episodesOf('23-24-2', 1)).toEqual([])
    delete process.env.QUALY_DEMO_EPISODES
    expect(episodesOf('23-24-2', 1)).toBe(EPISODES['23-24-2'])
  })
})
