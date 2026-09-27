import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { PICTURES } from '../pictures.ts'
import { itemsOf, type Term } from '../rules.ts'
import { SCRIPTED_ASKS } from '../seed/asks.ts'
import { EPISODE_KINDS, EPISODES, TRIAL_ITEM, episodesOf, type Episode } from '../seed/episodes.ts'
import { TERM_PLANS } from '../seed/term.ts'

// The persona student's written-out terms are only ever played by a full
// seeding run, which takes over an hour. These catch, in a second, the
// mistakes that would otherwise surface near its end: an episode nobody
// plays, a claim on a question the term does not ask, a field the form does
// not have.

const questionsOf = (term: Term) => [...itemsOf(term), TRIAL_ITEM]
const ASSETS = path.resolve('tools/demo/assets')
const claimsOf = (episode: Episode) =>
  [episode.first, episode.claim, episode.refiled].filter((claim) => claim !== undefined)

const NUMERALS = '〇一二三四五六七八九'
/** 二〇二三年十一月十八日 and 十二, read as numbers */
const numeral = (text: string) =>
  text.includes('十')
    ? (text.startsWith('十') ? 1 : NUMERALS.indexOf(text[0]!)) * 10 +
      (text.endsWith('十') ? 0 : NUMERALS.indexOf(text[text.length - 1]!))
    : Number([...text].map((one) => NUMERALS.indexOf(one)).join(''))
/** every day or month a picture shows, as yyyy-mm-dd or yyyy-mm */
const datesOn = (asset: string) => {
  const html = PICTURES[asset] ?? ''
  const iso = [...html.matchAll(/\d{4}-\d{2}-\d{2}/g)].map((one) => one[0])
  const written = [
    ...html.matchAll(
      /二〇([〇一二三四五六七八九]{2})年([十一二三四五六七八九]+)月(?:([十一二三四五六七八九]+)日)?/g,
    ),
  ].map(([, year, month, day]) => {
    const ym = `20${numeral(year!)}-${String(numeral(month!)).padStart(2, '0')}`
    return day === undefined ? ym : `${ym}-${String(numeral(day)).padStart(2, '0')}`
  })
  return [...iso, ...written]
}

/**
 * What each episode's certificate says, where it matters to the claim: the
 * level, the place and whether a team won it.
 */
const CERTIFICATES: Readonly<Record<string, { level: string; rank: number; team: boolean }>> = {
  'competition-1': { level: 'provincial', rank: 1, team: true },
  'competition-3': { level: 'municipal', rank: 2, team: false },
  'competition-4': { level: 'provincial', rank: 1, team: false },
}

describe('the persona episodes', () => {
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

  it('files each claim with a picture of its own term', () => {
    // a picture dated inside the term's window, and none issued after filing
    // opened; the upheld appeal is refused for an activity held the term
    // before, and its certificate says so
    const problems: string[] = []
    for (const plan of TERM_PLANS) {
      for (const episode of EPISODES[plan.term]) {
        for (const claim of claimsOf(episode)) {
          for (const date of datesOn(claim.proof)) {
            const day = date.length === 7 ? `${date}-01` : date
            const outside = day < plan.material.start || day >= plan.material.end
            if (day > plan.day || (outside && episode.kind !== 'appeal-upheld')) {
              problems.push(`${plan.term} ${episode.kind}: ${claim.proof} shows ${date}`)
            }
          }
        }
      }
    }
    expect(problems).toEqual([])
  })

  it('files each award with a certificate that says what it claims', () => {
    // except the one filed with another contest's certificate by mistake
    const problems = Object.values(EPISODES)
      .flat()
      .filter((episode) => episode.kind !== 'appeal-corrected')
      .flatMap(claimsOf)
      .filter((claim) => claim.item === 'competition')
      .filter((claim) => {
        const says = CERTIFICATES[claim.proof]
        return (
          says === undefined ||
          says.level !== claim.payload['level'] ||
          says.rank !== claim.payload['rank'] ||
          says.team !== claim.payload['team']
        )
      })
      .map((claim) => `${String(claim.payload['name'])} ${claim.proof}`)
    expect(problems).toEqual([])
  })

  it('files each claim an ask is made on with the picture the ask answers', () => {
    const on: Partial<Record<Episode['kind'], string>> = {
      supplement: SCRIPTED_ASKS.placeInList.on,
      'appeal-corrected': SCRIPTED_ASKS.rightCertificate.on,
      reopen: SCRIPTED_ASKS.correctedList.on,
    }
    for (const episode of Object.values(EPISODES).flat()) {
      const expected = on[episode.kind]
      if (expected !== undefined) expect(episode.claim?.proof, episode.kind).toBe(expected)
    }
  })

  it('plays every episode in the term hosting them all, and none in the others', () => {
    const all = Object.values(EPISODES).flat()
    expect(episodesOf('23-24-1', '23-24-1')).toEqual(all)
    expect(episodesOf('23-24-2', '23-24-1')).toEqual([])
    // a run that names later terms hosts them in the first it names
    expect(episodesOf('24-25-2', '24-25-2')).toEqual(all)
    expect(episodesOf('23-24-2', null)).toBe(EPISODES['23-24-2'])
  })
})
