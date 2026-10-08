import fs from 'node:fs'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { PICTURES } from '../pictures.ts'
import { CAMPUS_ACTIVITIES, COMPETITIONS } from '../catalog.ts'
import { claimsOf } from '../seed/claims.ts'
import { activityIdentityOf, unreservedClaims } from '../seed/claim-identity.ts'
import { cst, type Story } from '../seed/context.ts'
import { episodesOf } from '../seed/episodes.ts'
import { randomStream } from '../seed/random-stream.ts'
import { STAGING } from '../seed/stages.ts'
import {
  LIVE_SCENE_KINDS,
  LIVE_SERVICE,
  TermQueue,
  liveStagingOf,
  liveTermScenes,
} from '../seed/term-scenes.ts'
import type { Student } from '../seed/world.ts'

const student = (index: number): Student => ({
  id: `student-${index}`,
  name: `Demo student ${index}`,
  number: `DEMO-${index}`,
  classKey: index < 12 ? 'demo-class-1' : 'demo-class-2',
  major: 'cs',
  activity: 0.99,
  standing: 0.8,
})

describe('an active term', () => {
  it('leaves future cleanup and future follow-ups unexecuted', async () => {
    const moments: Date[] = []
    const story = {
      at_: (at: Date, effect: Effect.Effect<void, unknown, unknown>) => {
        moments.push(at)
        return effect
      },
    } as Story
    const stop = cst('2026-09-11T18:00:00')
    const queue = new TermQueue(story, stop)
    const work = { pending: 2, completed: 0, archived: false }
    queue.at(cst('2026-09-11T17:00:00'), 'review', () =>
      Effect.sync(() => {
        work.pending--
        work.completed++
        queue.at(cst('2026-09-12T09:00:00'), 'follow-up', () =>
          Effect.sync(() => {
            work.pending--
          }),
        )
      }),
    )
    queue.at(stop, 'last-event', () =>
      Effect.sync(() => {
        queue.at(stop, 'after-cutoff', () =>
          Effect.sync(() => {
            work.pending = 0
          }),
        )
      }),
    )
    queue.at(cst('2026-09-13T20:00:00'), 'sweep', () =>
      Effect.sync(() => {
        work.pending = 0
      }),
    )
    queue.at(cst('2026-09-14T10:06:00'), 'archive', () =>
      Effect.sync(() => {
        work.archived = true
      }),
    )
    await Effect.runPromise(queue.drain() as Effect.Effect<void>)
    expect(work).toEqual({ pending: 1, completed: 1, archived: false })
    expect([...queue.counts.keys()]).toEqual(['review', 'last-event'])
    expect(moments.every((at) => at <= stop)).toBe(true)
  })

  it('keeps the original plans intact while opening the live operational window', () => {
    const original = STAGING['25-26-2']
    const live = liveStagingOf(original)
    const profile = live.stages.find((stage) => stage.phaseKey === 'appeal')!.permissionProfile
    expect(profile).toEqual(
      expect.arrayContaining([
        'assessment.entry.create',
        'assessment.entry.submit',
        'assessment.entry.edit',
        'assessment.entry.appeal',
        'assessment.review.process',
        'assessment.review.reopen',
        'assessment.entry.record',
      ]),
    )
    expect(
      original.stages.find((stage) => stage.phaseKey === 'appeal')!.permissionProfile,
    ).not.toContain('assessment.entry.submit')
    expect(live.scoped).toBe(original.scoped)
  })

  it('gives both participants actionable cases and gives reviewers several kinds of history', () => {
    const people = Array.from({ length: 30 }, (_, index) => student(index))
    const scenes = liveTermScenes(people, people[0]!, people[1]!)
    expect(scenes).toHaveLength(24)
    expect(new Set(scenes.map((scene) => scene.kind))).toEqual(new Set(LIVE_SCENE_KINDS))
    expect(
      scenes.filter((scene) => scene.student.id === people[0]!.id).map((scene) => scene.kind),
    ).toEqual(['draft', 'fresh', 'supplement-waiting', 'appealed'])
    expect(
      scenes.filter((scene) => scene.student.id === people[1]!.id).map((scene) => scene.kind),
    ).toEqual(['returned', 'multiple-revisions', 'supplement-answered', 'reopened'])
    const work = scenes.filter((scene) => scene.counsellor)
    expect(new Set(work.map((scene) => scene.kind)).size).toBe(8)
    expect(
      work.filter((scene) => scene.student.classKey === people[1]!.classKey).length,
    ).toBeGreaterThanOrEqual(8)
    for (const scene of scenes) {
      expect(fs.existsSync(new URL(`../assets/${scene.claim.proof}.jpg`, import.meta.url))).toBe(
        true,
      )
    }
    expect(liveTermScenes(people.toReversed(), people[0]!, people[1]!)).toEqual(scenes)
  })

  it('keeps all three live service revisions on the same activity inside the term material window', () => {
    const people = Array.from({ length: 30 }, (_, index) => student(index))
    const scenes = liveTermScenes(people, people[0]!, people[1]!).filter(
      (scene) => scene.claim.item === 'practice',
    )
    expect(scenes.length).toBeGreaterThan(0)
    for (const scene of scenes) {
      expect(scene.claim.payload['activity']).toBe(LIVE_SERVICE.activity)
      expect(scene.claim.proof).toBe(LIVE_SERVICE.hours)
    }
    for (const asset of [LIVE_SERVICE.hours, LIVE_SERVICE.confirmation, LIVE_SERVICE.duty]) {
      const html = PICTURES[asset]!
      expect(html).toContain(LIVE_SERVICE.activity)
      expect(html).toContain(LIVE_SERVICE.date)
      const dates = html.match(/\d{4}-\d{2}-\d{2}/g) ?? []
      expect(dates.length).toBeGreaterThan(0)
      expect(dates.every((date) => date >= '2026-03-01' && date < '2026-09-01')).toBe(true)
      expect(fs.existsSync(new URL(`../assets/${asset}.jpg`, import.meta.url))).toBe(true)
    }
    expect(PICTURES[LIVE_SERVICE.confirmation]).not.toContain('具体职责')
    expect(PICTURES[LIVE_SERVICE.duty]).toContain('具体职责')
    expect(PICTURES[LIVE_SERVICE.duty]).toContain('演示专用章')
  })

  it('keeps each presenter’s live cases distinct from their other scripted and random activities', () => {
    const episodes = episodesOf('25-26-2', null).flatMap((episode) =>
      [episode.first, episode.claim, episode.refiled].filter((claim) => claim !== undefined),
    )
    const personaClaims = [...episodes, STAGING['25-26-2'].scoped!.persona.claim]
    for (let run = 0; run < 30; run++) {
      const people = Array.from({ length: 30 }, (_, index) => student(run * 30 + index))
      const reserved = new Map([[people[0]!.id, personaClaims]])
      const scenes = liveTermScenes(people, people[0]!, people[1]!, reserved)
      for (const person of people.slice(0, 2)) {
        const anchors = scenes.filter((scene) => scene.student.id === person.id)
        const scripted = [...(reserved.get(person.id) ?? []), ...anchors.map((one) => one.claim)]
        const random = claimsOf(person, '25-26-2', randomStream('dedup-check', run, person.id), {
          start: '2026-03-01',
          end: '2026-09-01',
        })
        const all = [...scripted, ...unreservedClaims(random, scripted)]
        const names = all.map(activityIdentityOf).filter((key) => key !== null)
        expect(new Set(names).size).toBe(names.length)
        for (const { claim } of anchors) {
          if (claim.item === 'campus') {
            const activity = CAMPUS_ACTIVITIES.find(
              (one) => one.name === claim.payload['activity'],
            )!
            expect(activity.contest).toBe('none')
            expect(claim.payload['participation']).toBe(activity.participation)
            expect(claim.proof).toBe('campus-1')
          }
          if (claim.item === 'competition') {
            expect(
              COMPETITIONS.find((one) => one.name === claim.payload['name'])!.levels,
            ).toContain('provincial')
            expect(claim.payload).toMatchObject({ level: 'provincial', rank: 1 })
            expect(claim.proof).toBe(
              claim.payload['team'] === true ? 'competition-1' : 'competition-4',
            )
          }
        }
      }
      expect(scenes.find((scene) => scene.kind === 'returned')!.claim.item).toBe('campus')
      expect(liveTermScenes(people.toReversed(), people[0]!, people[1]!, reserved)).toEqual(scenes)
    }
  })

  it('removes the random claim that duplicates a reserved draft and keeps unrelated claims', () => {
    const people = Array.from({ length: 30 }, (_, index) => student(index))
    const scenes = liveTermScenes(people, people[0]!, people[1]!)
    const draft = scenes.find((scene) => scene.kind === 'draft')!.claim
    const fresh = scenes.find((scene) => scene.kind === 'fresh')!.claim
    const duplicate = { ...draft, payload: { ...draft.payload, participation: '0.5' } }
    const anotherItem = { ...draft, item: 'practice' }
    const input = [duplicate, fresh, { ...fresh }, anotherItem]
    expect(unreservedClaims(input, [draft])).toEqual([fresh, anotherItem])
    expect(input).toHaveLength(4)
  })

  it('treats article republication as the same work but retains distinct research achievements', () => {
    const article = {
      item: 'article',
      payload: { title: 'Demo article', outlet: 'news-national', link: 'https://example.org/one' },
      proof: 'article-1',
      filename: 'Article.jpg',
    }
    const republished = {
      ...article,
      payload: { ...article.payload, outlet: 'campus', link: 'https://example.org/two' },
    }
    const project = {
      ...article,
      item: 'research',
      payload: { title: 'Demo project', kind: 'project-university', role: 'lead', source: 'Plan' },
    }
    const correctedRole = { ...project, payload: { ...project.payload, role: 'first' } }
    const copyright = {
      ...project,
      payload: { ...project.payload, kind: 'software', source: 'DEMO-SR-00001' },
    }
    expect(unreservedClaims([article, republished, project, correctedRole, copyright], [])).toEqual(
      [article, project, copyright],
    )
  })
})

describe('competition evidence', () => {
  const facts = {
    'competition-1': { level: 'provincial', rank: 1, team: true },
    'competition-2': { level: 'national', rank: 3, team: false },
    'competition-3': { level: 'municipal', rank: 2, team: false },
    'competition-4': { level: 'provincial', rank: 1, team: false },
  }

  it('draws submitted values from what the selected certificate proves', () => {
    const seen = new Set<string>()
    for (let index = 0; index < 100; index++) {
      const claims = claimsOf(student(index), '25-26-2', randomStream('proof-check', index), {
        start: '2026-03-01',
        end: '2026-09-01',
      })
      for (const claim of claims.filter((one) => one.item === 'competition')) {
        const expected = facts[claim.proof as keyof typeof facts]
        expect(expected).toBeDefined()
        expect(claim.payload).toMatchObject(expected)
        seen.add(claim.proof)
      }
    }
    expect(seen).toEqual(new Set(Object.keys(facts)))
  })
})
