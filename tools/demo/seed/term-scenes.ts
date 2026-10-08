import type { Effect } from 'effect'
import { CAMPUS_ACTIVITIES, COMPETITIONS } from '../catalog.ts'
import type { Claim } from './claims.ts'
import { activityIdentityOf } from './claim-identity.ts'
import type { Story } from './context.ts'
import { EventQueue } from './queue.ts'
import { randomStream } from './random-stream.ts'
import { APPEAL, FILING, type Moment, type Staging } from './stages.ts'
import type { Student } from './world.ts'

/** The live term stops before settling and keeps its unfinished work intact. */
export const LIVE_TERM_STOP: Moment = [10, '18:00']

export const LIVE_SERVICE = {
  activity: '图书馆志愿服务',
  date: '2026-05-17',
  hours: 'live-service-hours',
  confirmation: 'live-service-confirmation',
  duty: 'live-service-duty',
} as const

export const liveStagingOf = (staging: Staging): Staging => ({
  ...staging,
  stages: staging.stages.map((stage) =>
    stage.phaseKey !== 'appeal'
      ? stage
      : {
          ...stage,
          displayName: '材料补报与异议复核',
          description: '继续受理补报材料、补件和审核，对已形成的结论可提出申诉。',
          permissionProfile: [...new Set([...FILING, ...APPEAL])],
        },
  ),
})

/** Discards future events at scheduling time, including follow-ups queued by another event. */
export class TermQueue extends EventQueue {
  readonly #through: number

  constructor(story: Story, through?: Date) {
    super(story)
    this.#through = through?.getTime() ?? Number.POSITIVE_INFINITY
  }

  override at(at: Date, label: string, run: () => Effect.Effect<void, unknown, unknown>) {
    if (Math.max(at.getTime(), this.now.getTime() + 1000) > this.#through) return
    super.at(at, label, run)
  }
}

export const LIVE_SCENE_KINDS = [
  'draft',
  'fresh',
  'revised',
  'multiple-revisions',
  'supplement-waiting',
  'supplement-answered',
  'escalated',
  'appealed',
  'reopened',
  'returned',
] as const
export type LiveSceneKind = (typeof LIVE_SCENE_KINDS)[number]

export interface LiveTermScene {
  readonly student: Student
  readonly kind: LiveSceneKind
  readonly claim: Claim
  /** Background scenes wait for the counsellor; persona scenes also keep class work visible. */
  readonly counsellor: boolean
}

const claimFor = (student: Student, kind: LiveSceneKind, used: ReadonlySet<string>): Claim => {
  const random = randomStream('live-term-claim', student.number, kind)
  if (kind === 'revised' || kind === 'multiple-revisions') {
    return {
      item: 'practice',
      payload: { activity: LIVE_SERVICE.activity, type: 'volunteer', evidence: 'hours' },
      proof: LIVE_SERVICE.hours,
      filename: `${LIVE_SERVICE.activity}时长记录.jpg`,
    }
  }
  if (
    kind === 'draft' ||
    kind === 'fresh' ||
    kind === 'supplement-waiting' ||
    kind === 'returned'
  ) {
    const activity = random.pick(
      CAMPUS_ACTIVITIES.filter(
        (one) =>
          one.contest === 'none' &&
          !used.has(activityIdentityOf({ item: 'campus', payload: { activity: one.name } })!),
      ),
    )
    return {
      item: 'campus',
      payload: {
        activity: activity.name,
        participation: activity.participation,
        'award-level': 'none',
        'award-rank': 1,
      },
      proof: 'campus-1',
      filename: `${activity.name}参与证明.jpg`,
    }
  }
  const { name } = random.pick(
    COMPETITIONS.filter(
      (one) =>
        one.levels.includes('provincial') &&
        !used.has(activityIdentityOf({ item: 'competition', payload: { name: one.name } })!),
    ),
  )
  const team = random.chance(0.6)
  return {
    item: 'competition',
    payload: { name, level: 'provincial', rank: 1, team },
    proof: team ? 'competition-1' : 'competition-4',
    filename: `${name}获奖证书.jpg`,
  }
}

/** Stable anchor cases plus different classmates, each preserving a separate business history. */
export const liveTermScenes = (
  present: readonly Student[],
  student: Student,
  classLead: Student,
  reserved: ReadonlyMap<string, readonly Claim[]> = new Map(),
): readonly LiveTermScene[] => {
  const scenes: LiveTermScene[] = []
  const usedByStudent = new Map(
    [...reserved].map(([id, claims]) => [
      id,
      new Set(claims.map(activityIdentityOf).filter((key) => key !== null)),
    ]),
  )
  const add = (person: Student, kind: LiveSceneKind, counsellor: boolean) => {
    const used = usedByStudent.get(person.id) ?? new Set<string>()
    const claim = claimFor(person, kind, used)
    const key = activityIdentityOf(claim)
    if (key !== null) used.add(key)
    usedByStudent.set(person.id, used)
    scenes.push({ student: person, kind, claim, counsellor })
  }
  for (const kind of ['draft', 'fresh', 'supplement-waiting', 'appealed'] as const)
    add(student, kind, false)
  for (const kind of ['returned', 'multiple-revisions', 'supplement-answered', 'reopened'] as const)
    add(classLead, kind, false)
  const background = present
    .filter((one) => one.id !== student.id && one.id !== classLead.id)
    .map((one) => ({ student: one, draw: randomStream('live-term-person', one.number).next() }))
    .toSorted((a, b) => a.draw - b.draw)
  const classmates = background
    .filter((one) => one.student.classKey === classLead.classKey)
    .slice(0, 8)
  const picked = [...classmates, ...background.filter((one) => !classmates.includes(one))].slice(
    0,
    16,
  )
  const kinds = LIVE_SCENE_KINDS.filter((kind) => kind !== 'draft' && kind !== 'returned')
  for (let index = 0; index < picked.length; index++) {
    add(picked[index]!.student, kinds[index % kinds.length]!, true)
  }
  return scenes
}
