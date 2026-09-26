import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { OFFERED_PHASE_CODES } from '@qualy/plugin-assessment/permissions'
import { itemsOf } from '../rules.ts'
import { EPISODES, TRIAL_NOTICE } from '../seed/episodes.ts'
import { SELECTION_DESCRIPTION, SELECTION_PHASES } from '../seed/selection.ts'
import {
  STAGING,
  minutesOf,
  openingDescription,
  stageAt,
  stagesOf,
  voidedDescription,
  type Moment,
  type Stage,
  type Staging,
} from '../seed/stages.ts'
import { TERM_PLANS } from '../seed/term.ts'

// Every term's batch is staged its own way (seed/stages.ts), and the story
// played on it keeps the same moments whatever the plan. A plan that shuts a
// door the story walks through at one of them fails a full seeding run near
// its end; these find it in a second.

const ASSETS = path.resolve('tools/demo/assets')
const CREATE = ['assessment.entry.create', 'assessment.entry.submit']
const plans = TERM_PLANS.map((plan, index) => ({ ...plan, index, staging: STAGING[plan.term] }))
const opens = (stage: Stage | undefined, code: string) =>
  stage?.permissionProfile.includes(code) ?? false
/** the stage a moment falls in, by key */
const keyAt = (staging: Staging, moment: Moment) => stageAt(staging, moment)?.phaseKey
/** the longest run of characters two texts share */
const sharedRun = (a: string, b: string) => {
  let longest = ''
  for (let i = 0; i < a.length; i++) {
    for (let j = i + longest.length + 1; j <= a.length && b.includes(a.slice(i, j)); j++) {
      longest = a.slice(i, j)
    }
  }
  return longest
}
/** a phrase a batch description may share with its stages, a name in quotes or a date, at most */
const SHARED_AT_MOST = 10

describe('the plan of each term', () => {
  it('names its stages unlike any other term, so the plans read apart', () => {
    const names = plans.map(({ staging }) =>
      stagesOf(staging)
        .map((stage) => stage.displayName)
        .join(' → '),
    )
    expect(new Set(names).size, names.join('\n')).toBe(plans.length)
  })

  it('keeps the batch description to what the term has of its own, apart from its stages', () => {
    const batches = [
      ...plans.map(({ term, staging }) => ({
        name: term,
        description: openingDescription(staging, EPISODES[term]),
        stages: stagesOf(staging),
      })),
      { name: 'selection', description: SELECTION_DESCRIPTION, stages: SELECTION_PHASES },
    ]
    for (const { name, description, stages } of batches) {
      for (const stage of stages) {
        const shared = sharedRun(description, stage.description)
        expect(shared.length, `${name} ${stage.phaseKey}: ${shared}`).toBeLessThanOrEqual(
          SHARED_AT_MOST,
        )
      }
    }
  })

  it('says what every stage is for, within what a plan write takes', () => {
    for (const { term, staging } of plans) {
      const stages = stagesOf(staging)
      expect(new Set(stages.map((stage) => stage.phaseKey)).size, term).toBe(stages.length)
      for (const stage of stages) {
        expect(stage.phaseKey, term).toMatch(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/)
        expect(stage.displayName.trim(), term).not.toBe('')
        expect(stage.displayName.length, term).toBeLessThanOrEqual(100)
        expect(stage.description.trim(), `${term} ${stage.phaseKey}`).not.toBe('')
        expect(stage.description.length, `${term} ${stage.phaseKey}`).toBeLessThanOrEqual(500)
      }
      expect(staging.descriptionMd.trim(), term).not.toBe('')
    }
  })

  it('opens only what a stage editor offers', () => {
    const offered = new Set<string>(OFFERED_PHASE_CODES)
    for (const { term, staging } of plans) {
      for (const stage of stagesOf(staging)) {
        const unknown = stage.permissionProfile.filter((code) => !offered.has(code))
        expect(unknown, `${term} ${stage.phaseKey}`).toEqual([])
      }
    }
  })

  it('enters its stages in order and ends archived, with nothing open', () => {
    for (const { term, staging } of plans) {
      const stages = stagesOf(staging)
      const times = stages.map((stage) => minutesOf(stage.enters))
      expect(times, term).toEqual([...times].sort((a, b) => a - b))
      expect(new Set(times).size, term).toBe(times.length)
      expect(stages.at(-1), term).toMatchObject({ enters: [13, '10:00'], permissionProfile: [] })
    }
  })

  it('keeps the moments the story acts at', () => {
    for (const { term, index, staging } of plans) {
      // filing opens at D 08:00 and closes at D+5 00:00
      for (const moment of [
        [0, '08:00'],
        [2, '20:00'],
        [4, '23:59'],
      ] as const) {
        const stage = stageAt(staging, moment)
        expect(
          CREATE.every((code) => opens(stage, code)),
          `${term} files at ${moment.join(' ')}`,
        ).toBe(true)
      }
      expect(opens(stageAt(staging, [5, '00:00']), CREATE[0]!), term).toBe(false)
      expect(opens(stageAt(staging, [-1, '12:00']), CREATE[0]!), term).toBe(false)
      // what the offices send is imported and recorded in the first days
      for (const moment of [
        [1, '10:12'],
        [2, '15:40'],
        [2, '16:30'],
      ] as const) {
        expect(opens(stageAt(staging, moment), 'assessment.entry.record'), term).toBe(true)
      }
      // claims are judged from the first evening until the sweep before archiving
      for (let day = 0; day <= 12; day++) {
        const stage = stageAt(staging, [day, '20:00'])
        expect(opens(stage, 'assessment.review.process'), `${term} day ${day}`).toBe(true)
      }
      // appeals come in from D+9 10:00 until D+11 17:00
      for (const moment of [
        [9, '10:00'],
        [10, '12:00'],
        [11, '16:59'],
      ] as const) {
        expect(opens(stageAt(staging, moment), 'assessment.entry.appeal'), term).toBe(true)
      }
      // the episodes' own moments; every episode plays in the first term
      // when QUALY_DEMO_EPISODES=first asks it to
      const kinds = new Set(
        (index === 0 ? Object.values(EPISODES).flat() : EPISODES[term]).map((one) => one.kind),
      )
      if (kinds.has('record-void')) {
        expect(opens(stageAt(staging, [7, '10:00']), 'assessment.entry.record'), term).toBe(true)
      }
      if (kinds.has('reopen')) {
        expect(opens(stageAt(staging, [6, '10:20']), 'assessment.review.reopen'), term).toBe(true)
      }
    }
  })
})

describe('the batch description', () => {
  const trying = plans.filter(({ term }) =>
    EPISODES[term].some((episode) => episode.kind === 'item-void'),
  )

  it('never names the question a term tries on its own', () => {
    for (const { term, staging } of plans) {
      expect(staging.descriptionMd, term).not.toContain('志愿服务时长认定')
    }
  })

  it('announces the tried question where it is tried, and says it stopped once voided', () => {
    expect(trying.map(({ term }) => term)).toEqual(['25-26-1'])
    for (const { term, staging } of plans) {
      const opening = openingDescription(staging, EPISODES[term])
      if (!trying.some((one) => one.term === term)) {
        expect(opening, term).toBe(staging.descriptionMd)
        continue
      }
      expect(opening.split('\n')[0], term).toBe(TRIAL_NOTICE.tried)
      const voided = voidedDescription(opening)
      expect(voided, term).not.toContain(TRIAL_NOTICE.tried)
      expect(voided.split('\n')[0], term).toBe(TRIAL_NOTICE.voided)
      expect(voided.split('\n').slice(1), term).toEqual(staging.descriptionMd.split('\n'))
    }
  })
})

describe('re-examination', () => {
  const reopening = (
    phases: readonly { phaseKey: string; permissionProfile: readonly string[] }[],
  ) =>
    phases
      .filter((phase) => phase.permissionProfile.includes('assessment.review.reopen'))
      .map((phase) => phase.phaseKey)

  it('opens once filing has closed, while claims are reviewed or appealed, never while appeals are settled', () => {
    for (const { term, staging } of plans) {
      for (const stage of stagesOf(staging)) {
        const reviewing =
          minutesOf(stage.enters) >= minutesOf([5, '00:00']) &&
          opens(stage, 'assessment.review.process') &&
          stage.phaseKey !== 'appeal-review'
        expect(opens(stage, 'assessment.review.reopen'), `${term} ${stage.phaseKey}`).toBe(
          reviewing,
        )
      }
    }
  })

  it('opens in the same windows in the selection', () => {
    expect(reopening(SELECTION_PHASES)).toEqual(['review', 'appeal'])
  })
})

describe('the stage that reopens filing for some questions', () => {
  const reopened = plans.filter((plan) => plan.staging.scoped !== undefined)

  it('is staged in one term', () => {
    expect(reopened.map((plan) => plan.term)).toEqual(['25-26-2'])
  })

  it('never falls where staff record, which its question scope would refuse', () => {
    for (const { term, index, staging } of reopened) {
      const scoped = staging.scoped!
      expect(opens(scoped.stage, 'assessment.entry.record'), term).toBe(false)
      expect(
        CREATE.every((code) => opens(scoped.stage, code)),
        term,
      ).toBe(true)
      // QUALY_DEMO_EPISODES=first plays a record taken back in the first term
      expect(index, term).toBeGreaterThan(0)
      expect(
        EPISODES[term].filter((episode) => episode.kind === 'record-void'),
        term,
      ).toEqual([])
    }
  })

  it('is added while the stage it follows is current, and entered later', () => {
    for (const { term, staging } of reopened) {
      const scoped = staging.scoped!
      expect(keyAt(staging, scoped.added), term).toBe(scoped.after)
      expect(minutesOf(scoped.added), term).toBeLessThan(minutesOf(scoped.stage.enters))
      expect(stagesOf(staging).indexOf(scoped.stage), term).toBe(
        stagesOf(staging).findIndex((stage) => stage.phaseKey === scoped.after) + 1,
      )
    }
  })

  it('opens questions the term asks, to the kinds of claim that waited', () => {
    for (const { term, staging } of reopened) {
      const scoped = staging.scoped!
      for (const key of scoped.items) {
        const question = itemsOf(term).find((one) => one.key === key)
        expect(question, `${term} ${key}`).toBeDefined()
        const kind = question!.fields.find((field) => field.key === 'kind')
        const values = kind?.type === 'choice' ? kind.options.map((option) => option.value) : []
        for (const awaited of scoped.awaited) expect(values, term).toContain(awaited)
      }
    }
  })

  it('takes late claims and the persona’s certificate inside itself, judged in the day', () => {
    for (const { term, staging } of reopened) {
      const scoped = staging.scoped!
      const [first, last] = scoped.filedOn
      expect(keyAt(staging, [first, '12:00']), term).toBe(scoped.stage.phaseKey)
      expect(keyAt(staging, [last, '22:59']), term).toBe(scoped.stage.phaseKey)
      expect(keyAt(staging, scoped.persona.files), term).toBe(scoped.stage.phaseKey)
      expect(minutesOf(scoped.persona.approved), term).toBeGreaterThan(
        minutesOf(scoped.persona.files),
      )
      const hour = Number(scoped.persona.approved[1].slice(0, 2))
      expect(hour >= 8 && hour < 23, term).toBe(true)

      const claim = scoped.persona.claim
      expect(scoped.items, term).toContain(claim.item)
      const question = itemsOf(term).find((one) => one.key === claim.item)!
      const fields = new Set(question.fields.map((field) => field.key))
      expect(
        Object.keys(claim.payload).filter((key) => !fields.has(key)),
        term,
      ).toEqual([])
      expect(fs.existsSync(path.join(ASSETS, `${claim.proof}.jpg`)), claim.proof).toBe(true)
    }
  })
})

describe('the selection', () => {
  it('says what each phase is for, and what the ones still ahead wait for', () => {
    for (const phase of SELECTION_PHASES) {
      expect(phase.description.trim(), phase.phaseKey).not.toBe('')
      expect(phase.description.length, phase.phaseKey).toBeLessThanOrEqual(500)
    }
    // the story enters the first two; a restored instance must not move on by itself
    for (const phase of SELECTION_PHASES.slice(2)) {
      const note = ('entryNote' in phase ? phase.entryNote : undefined) ?? ''
      expect(note.trim(), phase.phaseKey).not.toBe('')
      expect(note.length, phase.phaseKey).toBeLessThanOrEqual(200)
    }
  })
})
