import { Effect } from 'effect'
import ExcelJS from 'exceljs'
import { sql } from 'kysely'
import type { Principal } from '@qualy/rbac-contract'
import { Assessment } from '@qualy/plugin-assessment/testkit'
import { runSql } from '@qualy/plugin-database/testkit'
import library from '../library.json' with { type: 'json' }
import {
  APPEAL_REASONS,
  CADRE_POSTS,
  REJECTIONS,
  SCRIPTED_APPEALS,
  type ScriptedAppeal,
} from '../catalog.ts'
import type { FieldSpec, ItemSpec, Term } from '../rules.ts'
import { claimsOf, type Claim } from './claims.ts'
import { SCRIPTED_ASKS, answerAsk, askFor, requestAsk, type Ask } from './asks.ts'
import { addMinutes, awake, cst, principalOf, type Random, type Story } from './context.ts'
import { episodesOf, TRIAL_ITEM, type Episode } from './episodes.ts'
import { stageProof, stageWorkbook } from './files.ts'
import { buildTermItems, reviewPolicyOf, scoringConfigOf, type Versions } from './items.ts'
import { EventQueue } from './queue.ts'
import { STAGING, openingDescription, voidedDescription, type Stage } from './stages.ts'
import type { Student, World } from './world.ts'

// One term, from the batch being set up to its archive.
//
//   D-3  the assessment lead sets the batch up: stages, score tree, questions
//   D    filing opens
//   D+1  a counsellor imports what the offices send: grades, youth study,
//        dormitory inspections, student posts
//   D+2  the other counsellor records the rest: study-hall absences,
//        reprimands and the odd commendation
//   D..D+4  students file in the evenings; class leads review as they come,
//        send some back, pass doubts up to the major leads
//   D+5  filing closes; review goes on
//   D+9  first results: appeals open for two and a half days
//   D+11 appeals close; the ones filed are settled
//   D+13 the term is archived
//
// Each term stages these moments its own way (stages.ts): review split in
// two, appeals open longer, rules published before filing, or filing
// reopened for one question while review goes on.
//
// Everything happens through the queue, in story order.

export interface TermPlan {
  readonly term: Term
  readonly name: string
  readonly material: { readonly start: string; readonly end: string }
  /** the day filing opens, Beijing time */
  readonly day: string
  /** appeals this term had, from the real counts, scaled to the cohort */
  readonly appeals: number
  /** students who took leave during the term */
  readonly onLeave: number
}

export const TERM_PLANS: readonly TermPlan[] = [
  {
    term: '23-24-1',
    name: '2023-2024学年第一学期综合素质测评',
    material: { start: '2023-09-01', end: '2024-03-01' },
    day: '2024-03-01',
    appeals: 36,
    onLeave: 6,
  },
  {
    term: '23-24-2',
    name: '2023-2024学年第二学期综合素质测评',
    material: { start: '2024-03-01', end: '2024-09-01' },
    day: '2024-09-02',
    appeals: 106,
    onLeave: 3,
  },
  {
    term: '24-25-1',
    name: '2024-2025学年第一学期综合素质测评',
    material: { start: '2024-09-01', end: '2025-03-01' },
    day: '2025-03-03',
    appeals: 80,
    onLeave: 0,
  },
  {
    term: '24-25-2',
    name: '2024-2025学年第二学期综合素质测评',
    material: { start: '2025-03-01', end: '2025-09-01' },
    day: '2025-09-01',
    appeals: 168,
    onLeave: 0,
  },
  {
    term: '25-26-1',
    name: '2025-2026学年第一学期综合素质测评',
    material: { start: '2025-09-01', end: '2026-03-01' },
    day: '2026-03-15',
    appeals: 154,
    onLeave: 0,
  },
  {
    term: '25-26-2',
    name: '2025-2026学年第二学期综合素质测评',
    material: { start: '2026-03-01', end: '2026-09-01' },
    day: '2026-09-01',
    appeals: 72,
    onLeave: 0,
  },
]

/** a moment `days` after the plan's day, at a Beijing wall-clock time */
export const dayAt = (day: string, days: number, time: string) => {
  const base = new Date(`${day}T00:00:00+08:00`)
  const shifted = new Date(base.getTime() + days * 86_400_000)
  const ymd = new Date(shifted.getTime() + 8 * 3_600_000).toISOString().slice(0, 10)
  return cst(`${ymd}T${time}:00`)
}

/** a stage as a plan write states it */
const specOf = (stage: Stage) => ({
  phaseKey: stage.phaseKey,
  displayName: stage.displayName,
  description: stage.description,
  permissionProfile: [...stage.permissionProfile],
})

export const ESCALATE_REASONS = ['材料真实性存疑', '认定标准存在争议', '超出当前审核范围'] as const

/**
 * Whether the random review scheduled when a claim was sent takes up the
 * round it finds. A claim moved onto a changed route is looked at both by
 * that review and by the one the move schedules, so one of them can find it
 * already passed up. The escalation route is walked by its own schedule
 * (`decideEscalated`): a refusal there is one step's opinion, the claim stays
 * under review, and judging it as a first-route refusal would queue it to be
 * filed again while it cannot be edited.
 */
export const takenUpAtRandom = (round: {
  readonly chain: { readonly route: 'normal' | 'escalation' }
}) => round.chain.route === 'normal'

/**
 * Whether a resubmission queued after a refusal goes ahead: only while the
 * claim still stands refused when its moment comes, whatever happened to it
 * in between.
 */
export const refilesNow = (status: string | undefined) => status === 'rejected'

interface Filed {
  readonly entryId: string
  readonly student: Student
  readonly claim: Claim
  instanceId: string | null
  status: 'draft' | 'in_review' | 'approved' | 'rejected' | 'needs_revision'
  revised: boolean
  appealed: boolean
  /** an episode's claim, which the random appeals and reviews leave alone */
  readonly scripted: boolean
  /** the last ask made on the claim, which the student answers with its picture */
  asked: Ask | null
  /** what the claim says now, and the pictures it cites, uploaded as `attachments` */
  payload: Readonly<Record<string, unknown>>
  pictures: readonly string[]
  attachments: readonly string[]
}

/** a picture a student uploads, under the name they give it */
interface Picture {
  readonly asset: string
  readonly filename: string
}

export interface TermOutcome {
  readonly batchId: string
  readonly participants: ReadonlyMap<string, string>
  readonly counts: ReadonlyMap<string, number>
}

export const runTerm = (input: {
  world: World
  plan: TermPlan
  /** which term of the six this is, from 0 */
  index: number
  versions: Versions
  story: Story
  random: Random
  /** people who go on leave during this term, chosen before it starts */
  onLeave: readonly Student[]
  /** the student a visitor signs in as, whose term is written out (episodes.ts) */
  persona: Student
}) =>
  Effect.gen(function* () {
    const { world, plan, versions, story, random, persona } = input
    const episodes = episodesOf(plan.term, input.index)
    const staging = STAGING[plan.term]
    const description = openingDescription(staging, episodes)
    const scoped = staging.scoped
    const assessment = yield* Assessment
    const t = world.tenantId
    const lead = principalOf(t, world.staff.manager.id)
    const counsellors = world.staff.counsellors.map((one) => principalOf(t, one.id))
    const at = (days: number, time: string) => dayAt(plan.day, days, time)
    const deadline = at(5, '00:00')

    // --- setting the batch up ---------------------------------------------

    story.set(at(-3, '14:20'))
    const batch = yield* story.step(
      assessment.createBatch(
        t,
        {
          name: plan.name,
          descriptionMd: description,
          materialRange: plan.material,
          import: { orgNodeIds: [world.grade], userTypeIds: [world.userTypes.student] },
        },
        lead,
      ),
      120,
    )
    yield* story.step(
      assessment.replacePlan(t, batch.id, { specs: staging.stages.map(specOf) }, lead),
      300,
    )
    const built = yield* buildTermItems(world, plan.term, batch.id, versions, story, lead)
    const items = new Map(built.items)
    if (episodes.some((episode) => episode.kind === 'item-void')) {
      // a question tried for this term, and voided a day into filing
      const trial = yield* story.step(
        assessment.createItem(
          t,
          batch.id,
          {
            itemType: 'evidence',
            title: TRIAL_ITEM.title,
            scoreGroupId: built.groups.get(TRIAL_ITEM.group)!,
            maxEntries: TRIAL_ITEM.maxEntries,
            sortOrder: items.size,
            config: {
              entryChannels: ['participant'],
              formConfig: { fields: TRIAL_ITEM.fields },
              scoringConfig: scoringConfigOf(TRIAL_ITEM, versions),
              reviewPolicy: reviewPolicyOf(world),
            },
          },
          lead,
        ),
        40,
      )
      yield* story.step(assessment.setItemStatus(t, trial.id, { status: 'active' }, lead), 20)
      items.set(TRIAL_ITEM.key, { id: trial.id, spec: TRIAL_ITEM })
    }
    const participants = new Map<string, string>()
    for (const row of (
      (yield* runSql(
        sql`select id, user_id from batch_participants where batch_id = ${batch.id}`,
      )) as { rows: { id: string; user_id: string }[] }
    ).rows) {
      participants.set(row.user_id, row.id)
    }
    const present = world.students.filter((student) => participants.has(student.id))

    const queue = new EventQueue(story)
    const itemOf = (key: string) => items.get(key)!
    const asStudent = (student: Student) => principalOf(t, student.id)
    /** the round a claim stands on now, whoever opened it */
    const currentRoundOf = (entryId: string) =>
      Effect.map(
        runSql(sql`select current_review_instance_id as id from entries where id = ${entryId}`),
        (found) => (found as { rows: { id: string | null }[] }).rows[0]?.id ?? null,
      )

    // --- the stages, on their dates ---------------------------------------

    // by key rather than by place: a stage added once the term is under way
    // moves every later one down
    const enter = (stage: Stage, first: boolean) =>
      queue.at(at(...stage.enters), 'phase', () =>
        Effect.gen(function* () {
          const to = (yield* assessment.getPlan(t, batch.id, lead)).find(
            (phase) => phase.phaseKey === stage.phaseKey,
          )!.id
          yield* assessment.advancePhase(
            t,
            batch.id,
            first ? { to, force: true, reason: '按学院通知启动本学期综合素质测评' } : { to },
            lead,
          )
        }),
      )
    staging.stages.forEach((stage, order) => enter(stage, order === 0))
    if (scoped !== undefined) {
      // filing reopened for some questions, in after the stage current then
      queue.at(at(...scoped.added), 'phase', () =>
        Effect.gen(function* () {
          const current = yield* assessment.getPlan(t, batch.id, lead)
          const itemScope = scoped.items.map((key) => itemOf(key).id)
          const specs = current.flatMap((phase) => {
            const kept = { id: phase.id, phaseKey: phase.phaseKey, displayName: phase.displayName }
            return phase.phaseKey === scoped.after
              ? [kept, { ...specOf(scoped.stage), itemScope }]
              : [kept]
          })
          yield* assessment.replacePlan(t, batch.id, { specs }, lead)
        }),
      )
      enter(scoped.stage, false)
    }

    // --- who can decide a round now ---------------------------------------

    const candidatesFor = (stageId: string, student: Student): string[] => {
      switch (stageId) {
        case 'class':
          return (world.classLeads.get(student.classKey) ?? []).filter((id) => id !== student.id)
        case 'majors':
          return world.majorLeads.filter((id) => id !== student.id)
        case 'grade':
          return [world.gradeLead]
        default:
          return counsellors.map((one) => one.userId)
      }
    }

    /** the first person at the round's current step who may decide it, with the round as they see it */
    const judgeOf = (instanceId: string, student: Student) =>
      Effect.gen(function* () {
        const any = yield* assessment.getReviewInstance(t, instanceId, lead)
        if (any.state !== 'active') return null
        for (const userId of candidatesFor(any.chain.stageId, student)) {
          const as = principalOf(t, userId)
          const seen = yield* Effect.result(assessment.getReviewInstance(t, instanceId, as))
          if (seen._tag === 'Success' && seen.success.capabilities.canDecide) {
            return { as, round: seen.success }
          }
        }
        return null
      })

    // --- filing ------------------------------------------------------------

    const filed: Filed[] = []

    // reviewers decide in the day, whenever the claim came in
    const review = (entry: Filed, when: Date) =>
      queue.at(awake(when), 'review', () => decideNormal(entry))

    /** sends a claim in; `review` false leaves its judging to whoever scheduled it */
    const submit = (entry: Filed, review_ = true) =>
      Effect.gen(function* () {
        const sent = yield* assessment.setEntryStatus(
          t,
          entry.entryId,
          'in_review',
          asStudent(entry.student),
        )
        entry.status = 'in_review'
        entry.instanceId = sent.currentReviewInstanceId ?? null
        if (!review_) return
        const delay = random.int(3 * 60, 3 * 24 * 60)
        const when = addMinutes(queue.now, delay)
        review(entry, when < at(1, '19:00') ? addMinutes(at(1, '19:00'), random.int(0, 180)) : when)
      })

    /**
     * Files a claim. Left alone, a few stay drafts and the rest are sent and
     * reviewed as they come; an episode sends its own and judges it itself.
     */
    const file = (student: Student, claim: Claim, scripted = false) =>
      Effect.gen(function* () {
        const item = itemOf(claim.item)
        const me = asStudent(student)
        const proof = yield* stageProof(t, batch.id, item.id, claim.proof, claim.filename, me)
        const entry = yield* assessment.createEntry(
          t,
          {
            itemId: item.id,
            participantId: participants.get(student.id)!,
            payload: { ...claim.payload, proof: [proof] },
          },
          me,
        )
        const state: Filed = {
          entryId: entry.id,
          student,
          claim,
          instanceId: null,
          status: 'draft',
          revised: false,
          appealed: false,
          scripted,
          asked: null,
          payload: claim.payload,
          pictures: [claim.proof],
          attachments: [proof],
        }
        filed.push(state)
        if (scripted) {
          yield* submit(state, false)
          return state
        }
        // a few are left as drafts and never sent
        if (random.chance(0.025)) return state
        yield* submit(state)
        return state
      })

    /** the claims each question still has room for, beside what `taken` counts */
    const allowed = (claims: readonly Claim[], taken: Map<string, number>) => {
      const kept: Claim[] = []
      for (const claim of claims) {
        const most = items.get(claim.item)?.spec.maxEntries ?? null
        const used = taken.get(claim.item) ?? 0
        if (most !== null && used >= most) continue
        taken.set(claim.item, used + 1)
        kept.push(claim)
      }
      return kept
    }

    // the persona's own claims leave room for what their episodes file, and
    // for the one they file once filing reopens for its question
    const roomLeft = (student: Student, claims: Claim[]) => {
      if (student.id !== persona.id) return claims
      const taken = new Map<string, number>()
      for (const episode of episodes) {
        for (const claim of [episode.first, episode.claim, episode.refiled]) {
          if (claim !== undefined) taken.set(claim.item, (taken.get(claim.item) ?? 0) + 1)
        }
      }
      if (scoped !== undefined) taken.set(scoped.persona.claim.item, 1)
      return allowed(
        claims.filter((claim) => !(scoped?.items.includes(claim.item) ?? false)),
        taken,
      )
    }

    /**
     * The class lead a visitor signs in as files like the busy cadre they
     * are: three claims at least, on two kinds of question or more, one per
     * activity, within what each question allows.
     */
    const cadreClaims = (student: Student) => {
      const busy: Student = { ...student, activity: Math.max(student.activity, 0.85) }
      const drawn: Claim[] = []
      const named = new Set<string>()
      for (let draw = 0; draw < 6; draw++) {
        for (const claim of claimsOf(busy, plan.term, random, plan.material)) {
          const what = claim.payload['activity'] ?? claim.payload['name']
          if (typeof what === 'string') {
            if (named.has(`${claim.item}:${what}`)) continue
            named.add(`${claim.item}:${what}`)
          }
          drawn.push(claim)
        }
        const kept = allowed(drawn, new Map())
        if (kept.length >= 3 && new Set(kept.map((claim) => claim.item)).size >= 2) return kept
      }
      return allowed(drawn, new Map())
    }

    /** a claim on a reopened question that waited for its papers */
    const waited = (claim: Claim) =>
      scoped !== undefined &&
      scoped.items.includes(claim.item) &&
      scoped.awaited.includes(String(claim.payload['kind'])) &&
      random.chance(scoped.late)

    for (const student of present) {
      if (input.onLeave.some((one) => one.id === student.id)) continue
      const claims = roomLeft(
        student,
        student.id === world.cast.classLead.id
          ? cadreClaims(student)
          : claimsOf(student, plan.term, random, plan.material),
      )
      for (const claim of claims) {
        if (scoped !== undefined && waited(claim)) {
          // in the evenings once the stage reopening its question is in
          const day = random.int(...scoped.filedOn)
          const hour = random.chance(0.75) ? random.int(19, 22) : random.int(12, 17)
          queue.at(
            addMinutes(at(day, `${String(hour).padStart(2, '0')}:00`), random.int(0, 59)),
            'file',
            () => Effect.asVoid(file(student, claim)),
          )
          continue
        }
        // evenings mostly, over the four filing days; a last-minute rush on the last one
        const dayOffset = random.weighted([
          { day: 0, weight: 18 },
          { day: 1, weight: 22 },
          { day: 2, weight: 20 },
          { day: 3, weight: 18 },
          { day: 4, weight: 22 },
        ]).day
        const hour = random.chance(0.75) ? random.int(19, 23) : random.int(9, 17)
        const when = addMinutes(
          at(dayOffset, `${String(hour).padStart(2, '0')}:00`),
          random.int(0, 59),
        )
        queue.at(when < at(0, '08:05') ? at(0, '08:30') : when, 'file', () =>
          Effect.asVoid(file(student, claim)),
        )
      }
    }

    // --- reviewing ---------------------------------------------------------

    const decideNormal = (entry: Filed): Effect.Effect<void, unknown, unknown> =>
      Effect.gen(function* () {
        if (entry.instanceId === null) return
        const judge = yield* judgeOf(entry.instanceId, entry.student)
        if (judge === null || !takenUpAtRandom(judge.round)) return
        const roll = random.next()
        const beforeDeadline = queue.now.getTime() < deadline.getTime() - 6 * 3_600_000
        if (roll < 0.07) {
          const rejection = random.weighted(REJECTIONS)
          yield* assessment.decideReview(
            t,
            entry.instanceId,
            { decision: 'reject', reason: rejection.reason, comment: rejection.comment },
            judge.as,
          )
          entry.status = 'rejected'
          if (beforeDeadline && random.chance(0.65)) {
            const when = addMinutes(queue.now, random.int(120, 26 * 60))
            if (when < deadline) {
              queue.at(when, 'revise', () =>
                Effect.gen(function* () {
                  const standing = (yield* runSql(
                    sql`select status from entries where id = ${entry.entryId}`,
                  )) as { rows: { status: string }[] }
                  if (refilesNow(standing.rows[0]?.status)) yield* revise(entry)
                }),
              )
            }
          }
          return
        }
        if (roll < 0.095 && judge.round.actions.escalate.state === 'available') {
          yield* assessment.decideReview(
            t,
            entry.instanceId,
            {
              decision: 'escalate',
              reason: random.pick(ESCALATE_REASONS),
              comment: '请专业负责人核定',
            },
            judge.as,
          )
          queue.at(awake(addMinutes(queue.now, random.int(8 * 60, 40 * 60))), 'escalated', () =>
            decideEscalated(entry, 'claim'),
          )
          return
        }
        // only where the question has an ask of its own that fits the claim
        const ask = askFor({
          item: entry.claim.item,
          payload: entry.payload,
          proof: entry.pictures[0]!,
        })
        if (
          roll < 0.105 &&
          ask !== undefined &&
          judge.round.actions.supplement.state === 'available'
        ) {
          yield* askOn(entry, ask, judge.as)
          queue.at(addMinutes(queue.now, random.int(3 * 60, 20 * 60)), 'supplement-answer', () =>
            answer(entry),
          )
          return
        }
        yield* approve(entry, judge, 0.04)
        // a route with more than one step: the next one looks at it later
        const after = yield* assessment.getReviewInstance(t, entry.instanceId, lead)
        if (after.state === 'active')
          review(entry, addMinutes(queue.now, random.int(2 * 60, 20 * 60)))
      })

    /** approves, now and then correcting what the student filed */
    const approve = (
      entry: Filed,
      judge: { as: Principal; round: { recognitionForm: unknown } },
      correctRate: number,
      /** what the judge says when approving what was already determined */
      note?: string,
    ) =>
      Effect.gen(function* () {
        const form = judge.round.recognitionForm as {
          fields: readonly { id: string }[]
          seed: Readonly<Record<string, unknown>>
          locked: { values: Readonly<Record<string, unknown>> } | null
        } | null
        // a panel's determination is fixed by its first approving seat; the
        // others agree to that one or not at all
        const locked = form?.locked ?? null
        const correction =
          form !== null && form.fields.length > 0 && locked === null && random.chance(correctRate)
            ? corrected(entry, form.seed)
            : null
        const asks = form !== null && form.fields.length > 0
        const said = note === undefined ? {} : { comment: note }
        yield* assessment
          .decideReview(
            t,
            entry.instanceId!,
            !asks
              ? { decision: 'approve', ...said }
              : correction === null
                ? {
                    decision: 'approve',
                    ...said,
                    recognition: { values: { ...(locked?.values ?? form.seed) } },
                  }
                : {
                    decision: 'approve',
                    comment: correction.comment,
                    recognition: { values: correction.values, reason: correction.comment },
                  },
            judge.as,
          )
          .pipe(
            Effect.tapError(() =>
              Effect.sync(() =>
                console.error(
                  'approve refused',
                  entry.claim.item,
                  JSON.stringify(form),
                  JSON.stringify(entry.claim.payload),
                ),
              ),
            ),
          )
        entry.status = 'approved'
      })

    /** a reviewer's correction of one determined value, where the question has one worth correcting */
    const corrected = (entry: Filed, seed: Readonly<Record<string, unknown>>) => {
      const values = { ...seed }
      const keys = Object.keys(values)
      const find = (predicate: (value: unknown) => boolean) =>
        keys.find((key) => predicate(values[key]))
      switch (entry.claim.item) {
        case 'campus': {
          const key = find(
            (value) =>
              typeof value === 'string' && /^[01](\.\d+)?$/.test(value) && Number(value) > 0.2,
          )
          if (key === undefined) return null
          values[key] = '0.2'
          return { values, comment: '经核对，该活动公布的参与分为 0.2 分' }
        }
        case 'competition': {
          const key = find((value) => typeof value === 'number')
          if (key === undefined) return null
          values[key] = Math.min((values[key] as number) + 1, 20)
          return { values, comment: '证书所载名次与申报不符，按证书认定' }
        }
        case 'sport': {
          const key = find((value) => typeof value === 'boolean')
          if (key === undefined || values[key] === true) return null
          values[key] = true
          return { values, comment: '该项目为集体项目，按集体项目认定' }
        }
        default:
          return null
      }
    }

    /** asks for what `ask` names at the step judging the claim now, and remembers it */
    const askOn = (entry: Filed, ask: Ask, as: Principal) =>
      Effect.tap(requestAsk(t, entry.instanceId!, ask, as), () =>
        Effect.sync(() => {
          entry.asked = ask
        }),
      )

    /** the student answers the open ask with what it names; looked at again later unless `review_` is false */
    const answer = (entry: Filed, review_ = true) =>
      Effect.gen(function* () {
        const ask = entry.asked
        if (ask === null) {
          return yield* Effect.die(new Error(`no ask recorded on ${entry.claim.item}`))
        }
        const answered = yield* answerAsk({
          tenantId: t,
          batchId: batch.id,
          itemId: itemOf(entry.claim.item).id,
          instanceId: entry.instanceId!,
          ask,
          as: asStudent(entry.student),
        })
        if (!answered || !review_) return
        review(entry, addMinutes(queue.now, random.int(4 * 60, 30 * 60)))
      })

    /**
     * Files the claim again. The files it already cites stay unless a new
     * picture replaces them or is added beside them; the note says what
     * changed, and by default claims nothing new was supplied.
     */
    const revise = (
      entry: Filed,
      options: {
        readonly payload?: Readonly<Record<string, unknown>>
        readonly note?: string
        readonly review?: boolean
        /** a picture taken again, in place of what the claim cited */
        readonly replace?: Picture
        /** a picture added beside what the claim cites */
        readonly add?: Picture
      } = {},
    ) =>
      Effect.gen(function* () {
        const me = asStudent(entry.student)
        const item = itemOf(entry.claim.item)
        const upload = (picture: Picture) =>
          stageProof(t, batch.id, item.id, picture.asset, picture.filename, me)
        if (options.replace !== undefined) {
          entry.attachments = [yield* upload(options.replace)]
          entry.pictures = [options.replace.asset]
        }
        if (options.add !== undefined) {
          entry.attachments = [...entry.attachments, yield* upload(options.add)]
          entry.pictures = [...entry.pictures, options.add.asset]
        }
        entry.payload = { ...entry.payload, ...options.payload }
        yield* assessment.appendEntryRevision(
          t,
          entry.entryId,
          {
            payload: { ...entry.payload, proof: [...entry.attachments] },
            note: options.note ?? '已核对材料，请重新审核',
          },
          me,
        )
        entry.revised = true
        yield* submit(entry, options.review ?? true)
      })

    /**
     * The escalation ladder: the major leads together, then the grade lead,
     * then a counsellor. `missing` is an appeal against a refusal, `wrong`
     * one against what an approval determined.
     */
    const decideEscalated = (
      entry: Filed,
      why: 'claim' | 'missing' | 'wrong',
      accept = true,
    ): Effect.Effect<void, unknown, unknown> =>
      Effect.gen(function* () {
        for (let step = 0; step < 8; step++) {
          const judge = yield* judgeOf(entry.instanceId!, entry.student)
          if (judge === null) return
          const stage = judge.round.chain.stageId
          const last = stage === 'counsellor'
          if (!accept && !last && judge.round.actions.escalate.state === 'available') {
            yield* assessment.decideReview(
              t,
              entry.instanceId!,
              {
                decision: 'escalate',
                reason: '认定标准存在争议',
                comment: '意见不一致，提交上级复核',
              },
              judge.as,
            )
            continue
          }
          if (!accept && last && why === 'wrong') {
            // Not granting an appeal against an approval upholds it: the
            // approval stands on what it determined. A refusal here would
            // revoke it instead, taking the approval away.
            yield* approve(entry, judge, 0, '经复核，原认定无误，予以维持')
            return
          }
          if (!accept && last) {
            yield* assessment.decideReview(
              t,
              entry.instanceId!,
              {
                decision: 'reject',
                reason: '现有材料不足以支持申报内容',
                comment:
                  why === 'missing'
                    ? '经复核，所附材料仍不能证明该项符合加分条件，维持原决定'
                    : '经复核，材料不足以支持申报内容',
              },
              judge.as,
            )
            entry.status = 'rejected'
            return
          }
          yield* approve(entry, judge, why === 'claim' ? 0.1 : 0)
          // a panel approves seat by seat; the round moves on only when all have
          const after = yield* assessment.getReviewInstance(t, entry.instanceId!, lead)
          if (after.state !== 'active') return
        }
      })

    // --- what the offices send ---------------------------------------------

    const summary = library.terms[plan.term] as unknown as {
      students: number
      weightedByMajor: Record<string, number[]>
      numbers: Record<string, { frequencies?: Record<string, number>; quantiles?: number[] }>
      selfStudyAbsences: Record<string, number>
      moralOther: Record<string, number>
    }

    const importRows = (
      key: string,
      rows: readonly { student: Student; values: Record<string, string | number> }[],
      basis: string,
      as: Principal,
    ) =>
      Effect.gen(function* () {
        if (rows.length === 0) return
        const item = itemOf(key)
        const template = yield* assessment.administrativeImportTemplate(t, item.id, 'zh-CN', as)
        const book = new ExcelJS.Workbook()
        yield* Effect.promise(() => book.xlsx.load(template.bytes as unknown as ArrayBuffer))
        const sheet = book.getWorksheet('行政认定')!
        const headers = (sheet.getRow(1).values as unknown[])
          .slice(1)
          .map((cell) => String(cell ?? ''))
        const columnOf = (field: FieldSpec) => headers.findIndex((header) => header === field.label)
        for (const row of rows) {
          const cells = headers.map((): string | number => '')
          cells[0] = row.student.number
          cells[1] = row.student.name
          for (const field of item.spec.fields) {
            const value = row.values[field.key]
            if (value === undefined) continue
            const column = columnOf(field)
            if (column < 0) continue
            cells[column] =
              field.type === 'choice'
                ? (field.options.find((option) => option.value === value)?.label ?? String(value))
                : value
          }
          // an import is the office's own determination, so every determined
          // value is written out, from the field that would have pre-filled it
          const scoring = item.spec.scoring
          if (scoring.kind === 'formula') {
            const determined = headers
              .map((header, column) => ({ header, column }))
              .filter(({ header }) => header.startsWith('认定：'))
            Object.entries(scoring.recognitions).forEach(([, recognition], order) => {
              const column =
                determined.find(({ header }) => header === `认定：${recognition.label}`)?.column ??
                determined[order]?.column
              if (column === undefined || recognition.fromField === undefined) return
              const field = item.spec.fields.find((one) => one.key === recognition.fromField)
              if (field === undefined) return
              const value = row.values[field.key]
              if (value === undefined) return
              cells[column] =
                field.type === 'choice'
                  ? (field.options.find((option) => option.value === value)?.label ?? String(value))
                  : value
            })
          }
          cells[headers.length - 1] = basis
          sheet.addRow(cells)
        }
        const bytes = Buffer.from(yield* Effect.promise(() => book.xlsx.writeBuffer()))
        const attachmentId = yield* stageWorkbook(t, bytes, `${item.spec.title}.xlsx`, as)
        const revision = (yield* assessment.getItem(t, item.id, as)).currentRevision!.id
        yield* assessment.commitAdministrativeImport(
          t,
          batch.id,
          {
            attachmentId,
            itemId: item.id,
            expectedItemRevisionId: revision,
            defaultBasis: basis,
            confirmWarnings: true,
          },
          as,
        )
      })

    const recordFor = (
      key: string,
      people: readonly Student[],
      payload: Record<string, unknown>,
      basis: string,
      as: Principal,
    ) =>
      Effect.gen(function* () {
        if (people.length === 0) return
        const item = itemOf(key)
        // a record is the office's determination: each determined value is
        // written out, from the field that would have pre-filled it
        const stored = (yield* assessment.getItem(t, item.id, as)).currentRevision!
          .scoringConfig as {
          recognitions?: Record<string, { defaultFromFieldId: string | null }>
        }
        const values = Object.fromEntries(
          Object.entries(stored.recognitions ?? {}).flatMap(([id, recognition]) =>
            recognition.defaultFromFieldId === null
              ? []
              : [[id, payload[recognition.defaultFromFieldId]]],
          ),
        )
        const request = {
          itemId: item.id,
          target: {
            kind: 'people' as const,
            participantIds: people.map((one) => participants.get(one.id)!),
          },
          payload,
          ...(Object.keys(values).length === 0 ? {} : { recognition: { values } }),
          basis,
        }
        const seen = yield* assessment.previewAdministrativeRecord(t, batch.id, request, as)
        yield* assessment.recordAdministrativeBatch(
          t,
          batch.id,
          {
            ...request,
            excludedParticipantIds: [],
            expectedTargetFingerprint: seen.targetFingerprint,
          },
          as,
        )
      })

    const byStanding = [...present].sort((a, b) => b.standing - a.standing)
    const frequencies = (name: string) => summary.numbers[name]?.frequencies ?? {}

    queue.at(at(1, '10:12'), 'import', () =>
      Effect.gen(function* () {
        const importer = counsellors[0]!
        // grades, as the dean's office exported them
        yield* importRows(
          'academic-base',
          present.map((student) => {
            const quantiles =
              summary.weightedByMajor[student.major] ?? summary.weightedByMajor['se']!
            const u = Math.min(0.999, 0.8 * student.standing + 0.2 * random.next())
            const score = Math.round(interpolate(quantiles, u) * 100) / 100
            return {
              student,
              values: {
                average: (Math.round((score / 0.75) * 100) / 100).toFixed(2),
                score: score.toFixed(2),
              },
            }
          }),
          '教务处本学期成绩导出',
          importer,
        )
        const allRound = frequencies('allRound')
        const excellent = byStanding.slice(0, allRound['2'] ?? 0)
        const good = byStanding.slice(excellent.length, excellent.length + (allRound['1'] ?? 0))
        yield* importRows(
          'all-round',
          [
            ...excellent.map((student) => ({ student, values: { tier: 'excellent' } })),
            ...good.map((student) => ({ student, values: { tier: 'good' } })),
          ],
          '教务处本学期成绩导出',
          importer,
        )
        const failingRows: { student: Student; values: Record<string, number> }[] = []
        const lowest = [...byStanding].reverse()
        let at_ = 0
        for (const [count, n] of Object.entries(frequencies('failing')).sort(
          (a, b) => Number(a[0]) - Number(b[0]),
        )) {
          for (let i = 0; i < n && at_ < lowest.length; i++) {
            failingRows.push({ student: lowest[at_++]!, values: { courses: -Number(count) } })
          }
        }
        yield* importRows('failing', failingRows, '教务处本学期成绩导出', importer)
        if (items.has('youth-study')) {
          const youth = Object.entries(frequencies('youthStudy'))
          const total = youth.reduce((sum, [, n]) => sum + n, 0)
          yield* importRows(
            'youth-study',
            present.map((student) => {
              let pickAt = random.next() * total
              let value = '1'
              for (const [score, n] of youth) {
                pickAt -= n
                if (pickAt < 0) {
                  value = score
                  break
                }
              }
              return { student, values: { score: Number(value).toFixed(2) } }
            }),
            '团委青年大学习完成情况',
            importer,
          )
        }
        // the dormitory office's list: whole rooms, the leader and three others
        const dorm = frequencies('dorm')
        const rooms = Math.min(dorm['1'] ?? 0, Math.floor(present.length / 4))
        const shuffled = [...present].sort(() => random.next() - 0.5)
        const dormRows: { student: Student; values: Record<string, string> }[] = []
        for (let room = 0; room < rooms; room++) {
          const members = shuffled.slice(room * 4, room * 4 + 4)
          const number = `${random.int(1, 12)}号楼${random.int(1, 6)}${String(random.int(1, 30)).padStart(2, '0')}`
          const average = (90 + random.next() * 8).toFixed(1)
          members.forEach((student, index) =>
            dormRows.push({
              student,
              values: { room: number, role: index === 0 ? 'leader' : 'member', average },
            }),
          )
        }
        yield* importRows('dorm', dormRows, '学生公寓管理中心卫生检查汇总', importer)
        // student posts, from the class committees and the student unions
        const cadreRows: { student: Student; values: Record<string, string> }[] = []
        const cadreCount = Object.values(
          (library.terms[plan.term] as unknown as { cadres: Record<string, { n: number }> }).cadres,
        ).reduce((sum, one) => sum + one.n, 0)
        const leading = new Set([...world.classLeads.values()].flat())
        const posted = [...present]
          .sort(
            (a, b) =>
              b.activity + (leading.has(b.id) ? 1 : 0) - (a.activity + (leading.has(a.id) ? 1 : 0)),
          )
          .slice(0, Math.max(cadreCount, 120))
        for (const student of posted) {
          const post = random.weighted(CADRE_POSTS)
          cadreRows.push({ student, values: { post: post.post, tier: post.tier } })
        }
        yield* importRows('cadre', cadreRows, '学院团委学生干部名单', importer)
      }),
    )

    queue.at(at(2, '15:40'), 'record', () =>
      Effect.gen(function* () {
        const recorder = counsellors[1]!
        const absences = Object.entries(summary.selfStudyAbsences)
        const pool = [...present].sort(() => random.next() - 0.5)
        let taken = 0
        for (const [count, n] of absences) {
          const people = pool.slice(taken, taken + Math.min(n, 40))
          taken += people.length
          yield* recordFor(
            'self-study',
            people,
            { absences: Number(count) },
            '年级早晚自习考勤统计',
            recorder,
          )
        }
        const reprimands = summary.moralOther['减分'] ?? 0
        if (reprimands > 0) {
          const people = pool.slice(taken, taken + Math.min(reprimands, 40))
          taken += people.length
          yield* recordFor(
            'moral-other',
            people,
            { value: '-0.5', basis: '早晚自习缺席五次以上，年级通报批评' },
            '年级通报（示例）',
            recorder,
          )
        }
        const praised = pool.slice(taken, taken + 1)
        yield* recordFor(
          'moral-other',
          praised,
          { value: '1', basis: '及时发现并上报同学心理危机，经辅导员核实' },
          '心理健康教育中心反馈',
          recorder,
        )
      }),
    )

    // --- leave taken during the term ---------------------------------------

    for (const student of input.onLeave) {
      if (!participants.has(student.id)) continue
      queue.at(at(6, '10:30'), 'leave', () =>
        Effect.asVoid(
          assessment.setParticipantStatus(
            t,
            batch.id,
            participants.get(student.id)!,
            'excluded',
            '本学期办理休学',
            lead,
          ),
        ),
      )
    }

    // --- the persona's own term, written out (episodes.ts) -------------------

    type Judge = NonNullable<Effect.Success<ReturnType<typeof judgeOf>>>
    type Verdict =
      | {
          readonly kind: 'approve'
          /** filed values the judge determines differently, by field */
          readonly override?: Readonly<Record<string, unknown>>
          readonly comment?: string
        }
      | { readonly kind: 'reject'; readonly reason: string; readonly comment: string }
    // the counsellor a visitor signs in as keeps the records these episodes make
    const recorder = counsellors[0]!

    /** approves, with the listed filed fields determined as given */
    const approveWith = (
      entry: Filed,
      judge: Judge,
      override: Readonly<Record<string, unknown>> | undefined,
      comment: string | undefined,
    ) =>
      Effect.gen(function* () {
        const form = judge.round.recognitionForm
        const said = comment === undefined ? {} : { comment }
        if (form === null || form.fields.length === 0) {
          yield* assessment.decideReview(
            t,
            entry.instanceId!,
            { decision: 'approve', ...said },
            judge.as,
          )
          return
        }
        const values: Record<string, unknown> = { ...(form.locked?.values ?? form.seed) }
        let changed = false
        if (override !== undefined && form.locked === null) {
          for (const [id, key] of Object.entries(form.sources)) {
            if (Object.hasOwn(override, key) && values[id] !== override[key]) {
              values[id] = override[key]
              changed = true
            }
          }
        }
        yield* assessment.decideReview(
          t,
          entry.instanceId!,
          {
            decision: 'approve',
            ...said,
            recognition:
              changed && comment !== undefined ? { values, reason: comment } : { values },
          },
          judge.as,
        )
      })

    /**
     * One decision at the step judging the claim now; the next step, if the
     * round goes on, a few hours later. Every step says the same thing: a
     * contested claim that is granted is agreed with on the way up.
     */
    const walk = (
      entry: Filed,
      verdict: Verdict,
      gapMinutes: number,
    ): Effect.Effect<void, unknown, unknown> =>
      Effect.gen(function* () {
        const judge = yield* judgeOf(entry.instanceId!, entry.student)
        if (judge === null) {
          console.warn(`WARNING: nobody can decide the persona's ${entry.claim.item} claim now`)
          return
        }
        if (verdict.kind === 'approve') {
          yield* approveWith(entry, judge, verdict.override, verdict.comment)
        } else {
          yield* assessment.decideReview(
            t,
            entry.instanceId!,
            { decision: 'reject', reason: verdict.reason, comment: verdict.comment },
            judge.as,
          )
        }
        const after = yield* assessment.getReviewInstance(t, entry.instanceId!, lead)
        if (after.state === 'active') {
          queue.at(awake(addMinutes(queue.now, gapMinutes)), 'episode', () =>
            walk(entry, verdict, gapMinutes),
          )
          return
        }
        entry.status = after.outcome === 'approved' ? 'approved' : 'rejected'
      })

    /** the values a claim stands determined on, with the listed filed fields changed */
    const determinedWith = (entry: Filed, override: Readonly<Record<string, unknown>>) =>
      Effect.gen(function* () {
        const view = yield* assessment.getEntry(t, entry.entryId, lead)
        const values: Record<string, unknown> = { ...view.recognition?.values }
        const stored = (yield* assessment.getItem(t, itemOf(entry.claim.item).id, lead))
          .currentRevision!.scoringConfig as {
          recognitions?: Record<string, { defaultFromFieldId: string | null }>
        }
        for (const [id, recognition] of Object.entries(stored.recognitions ?? {})) {
          const key = recognition.defaultFromFieldId
          if (key !== null && Object.hasOwn(override, key)) values[id] = override[key]
        }
        return values
      })

    const materialDay = (days: number) =>
      new Date(new Date(`${plan.material.start}T00:00:00Z`).getTime() + days * 86_400_000)
        .toISOString()
        .slice(0, 10)
    /** a competition claim carries its award day inside the term's window */
    const dated = (claim: Claim): Claim =>
      claim.item === 'competition' && claim.payload['awarded-on'] === undefined
        ? { ...claim, payload: { ...claim.payload, 'awarded-on': materialDay(47) } }
        : claim

    const play = (episode: Episode, order: number) => {
      const held: { entry?: Filed } = {}
      // episodes of one term keep a few minutes apart
      const on = (
        days: number,
        time: string,
        run: (entry: Filed) => Effect.Effect<void, unknown, unknown>,
      ) => queue.at(addMinutes(at(days, time), order * 7), 'episode', () => run(held.entry!))
      const fileAt = (days: number, time: string, claim: Claim) =>
        queue.at(addMinutes(at(days, time), order * 7), 'episode', () =>
          Effect.map(file(persona, dated(claim), true), (entry) => {
            held.entry = entry
          }),
        )
      /** the step judging now, as whoever sits there sees it */
      const judged = (
        entry: Filed,
        act: (judge: Judge) => Effect.Effect<unknown, unknown, unknown>,
      ) =>
        Effect.gen(function* () {
          const judge = yield* judgeOf(entry.instanceId!, entry.student)
          if (judge === null)
            return yield* Effect.die(new Error(`episode ${episode.kind}: no judge`))
          yield* act(judge)
        })
      const approveNow =
        (comment?: string, override?: Readonly<Record<string, unknown>>) => (entry: Filed) =>
          judged(entry, (judge) =>
            Effect.tap(approveWith(entry, judge, override, comment), () =>
              Effect.sync(() => {
                entry.status = 'approved'
              }),
            ),
          )
      const rejectNow = (reason: string, comment: string) => (entry: Filed) =>
        judged(entry, (judge) =>
          Effect.tap(
            assessment.decideReview(
              t,
              entry.instanceId!,
              { decision: 'reject', reason, comment },
              judge.as,
            ),
            () =>
              Effect.sync(() => {
                entry.status = 'rejected'
              }),
          ),
        )
      const appeal = (reason: ScriptedAppeal) => (entry: Filed) =>
        Effect.gen(function* () {
          const round = yield* assessment.appealEntry(
            t,
            entry.entryId,
            { reason: SCRIPTED_APPEALS[reason] },
            asStudent(entry.student),
          )
          entry.appealed = true
          entry.instanceId = round.id
        })

      switch (episode.kind) {
        case 'supplement': {
          const { ask } = SCRIPTED_ASKS.placeInList
          fileAt(0, '20:30', episode.claim!)
          on(1, '19:30', (entry) => judged(entry, (judge) => askOn(entry, ask, judge.as)))
          on(2, '12:10', (entry) => answer(entry, false))
          on(2, '20:40', approveNow())
          return
        }
        case 'revise':
          fileAt(0, '21:00', episode.claim!)
          on(
            1,
            '19:50',
            rejectNow(
              '现有材料不足以支持申报内容',
              '仅有志愿服务平台的时长截图，请补充服务单位盖章的服务证明',
            ),
          )
          on(2, '13:00', (entry) =>
            revise(entry, {
              payload: { evidence: 'certificate' },
              note: '已补充服务单位盖章的志愿服务证明',
              add: { asset: 'service-1', filename: '志愿服务证明.jpg' },
              review: false,
            }),
          )
          on(3, '19:30', approveNow())
          return
        case 'rounds':
          fileAt(0, '21:10', episode.claim!)
          on(1, '20:05', rejectNow('证明材料无法清晰辨识', '证书照片模糊，请重新上传清晰的证书'))
          on(2, '12:30', (entry) =>
            revise(entry, {
              note: '已重新拍摄证书',
              replace: { asset: 'campus-2', filename: '荣誉证书.jpg' },
              review: false,
            }),
          )
          on(
            2,
            '20:15',
            rejectNow(
              '申报内容与证明材料不一致',
              '证书上为第二名，与申报的第一名不一致，请核对后修改',
            ),
          )
          on(3, '12:40', (entry) =>
            revise(entry, {
              payload: episode.corrected ?? {},
              note: '已按证书改为第二名',
              review: false,
            }),
          )
          on(3, '20:10', approveNow())
          return
        case 'return':
          fileAt(0, '21:30', episode.claim!)
          on(1, '10:30', (entry) =>
            Effect.gen(function* () {
              yield* assessment.interveneOnEntry(
                t,
                entry.entryId,
                {
                  kind: 'return-for-revision',
                  reason: '证书为团体奖项，请补充赛事成绩册中本队所在页，证明本人为参赛队员',
                },
                lead,
              )
              entry.status = 'needs_revision'
            }),
          )
          on(1, '20:30', (entry) =>
            revise(entry, {
              note: '已上传赛事成绩册中本队所在页',
              add: { asset: 'roster-1', filename: '赛事成绩册.jpg' },
              review: false,
            }),
          )
          on(2, '19:40', approveNow())
          return
        case 'panel':
          fileAt(1, '20:00', episode.claim!)
          on(2, '19:30', (entry) =>
            judged(entry, (judge) =>
              assessment.decideReview(
                t,
                entry.instanceId!,
                {
                  decision: 'escalate',
                  reason: '认定标准存在争议',
                  comment: '证书只写参赛队获奖、未列队员，能否按该生获奖认定请专业负责人核定',
                },
                judge.as,
              ),
            ),
          )
          on(3, '10:00', (entry) => walk(entry, { kind: 'approve' }, 4 * 60))
          return
        case 'appeal-corrected': {
          // filed with the wrong certificate; the right one comes in answer
          // to an ask made inside the appeal
          const { ask } = SCRIPTED_ASKS.rightCertificate
          fileAt(0, '22:00', episode.claim!)
          on(
            1,
            '20:20',
            rejectNow('申报内容与证明材料不一致', '所附证书为市级程序设计竞赛，与申报的竞赛不符'),
          )
          on(9, '10:40', appeal('wrongCertificate'))
          on(9, '15:00', (entry) => judged(entry, (judge) => askOn(entry, ask, judge.as)))
          on(9, '20:10', (entry) => answer(entry, false))
          on(10, '10:00', (entry) =>
            walk(entry, { kind: 'approve', comment: '补充的获奖证书真实有效，予以认定' }, 5 * 60),
          )
          return
        }
        case 'appeal-upheld':
          fileAt(1, '21:00', episode.claim!)
          on(
            2,
            '20:00',
            rejectNow(
              '相关时间不在有效范围内',
              '证书写明活动在 2024 年 5 月举办，不在本学期材料范围内',
            ),
          )
          on(9, '11:10', appeal('issuedThisTerm'))
          on(9, '18:00', (entry) =>
            walk(
              entry,
              {
                kind: 'reject',
                reason: '相关时间不在有效范围内',
                comment: '经复核，该活动于 2024 年 5 月举办，属上一学期，维持原决定',
              },
              5 * 60,
            ),
          )
          return
        case 'reopen': {
          const { ask } = SCRIPTED_ASKS.correctedList
          fileAt(0, '20:50', episode.claim!)
          on(1, '20:30', approveNow('官网公示名单中该生为二等奖，按公示名单认定', { rank: 2 }))
          on(6, '10:20', (entry) =>
            Effect.gen(function* () {
              const round = yield* assessment.reopenEntry(
                t,
                entry.entryId,
                { reason: '组委会已发布获奖名单更正公告，该生奖项与原认定不符，请复核' },
                recorder,
              )
              entry.instanceId = round.id
            }),
          )
          on(6, '14:30', (entry) => judged(entry, (judge) => askOn(entry, ask, judge.as)))
          on(6, '20:40', (entry) => answer(entry, false))
          on(7, '10:00', (entry) =>
            walk(
              entry,
              {
                kind: 'approve',
                override: { rank: 1 },
                comment: '按组委会更正后的获奖名单认定为一等奖',
              },
              4 * 60,
            ),
          )
          return
        }
        case 'raise':
          fileAt(1, '20:40', episode.claim!)
          on(2, '19:50', approveNow())
          on(12, '10:00', (entry) =>
            Effect.gen(function* () {
              const values = yield* determinedWith(entry, { participation: '0.5' })
              yield* assessment.redetermineEntry(
                t,
                entry.entryId,
                {
                  decision: 'approve',
                  recognition: { values },
                  reason: '经核对活动通知，工作人员参与分为 0.5 分，原认定按观众计算',
                },
                lead,
              )
            }),
          )
          return
        case 'revoke': {
          // the same afternoon filed twice, and both approved; the second
          // is the one the inspection office revokes
          const earlier: { entry?: Filed } = {}
          queue.at(addMinutes(at(0, '21:10'), order * 7), 'episode', () =>
            Effect.map(file(persona, episode.first!, true), (entry) => {
              earlier.entry = entry
            }),
          )
          queue.at(addMinutes(at(1, '20:10'), order * 7), 'episode', () =>
            approveNow()(earlier.entry!),
          )
          fileAt(2, '21:40', episode.claim!)
          on(3, '21:00', approveNow())
          on(12, '10:20', (entry) =>
            Effect.gen(function* () {
              yield* assessment.redetermineEntry(
                t,
                entry.entryId,
                {
                  decision: 'reject',
                  reason: '与本学期另一条「图书馆志愿服务」申报为同一次活动，按重复申报处理',
                },
                lead,
              )
              entry.status = 'rejected'
            }),
          )
          return
        }
        case 'record-void': {
          const recorded: { entryId?: string } = {}
          queue.at(addMinutes(at(2, '16:30'), order * 7), 'episode', () =>
            Effect.gen(function* () {
              yield* recordFor(
                'moral-other',
                [persona],
                { value: '-0.5', basis: '寝室违规使用大功率电器，宿管中心通报' },
                '学生公寓管理中心通报',
                recorder,
              )
              const row = (
                (yield* runSql(sql`
                  select e.id from entries e
                   where e.participant_id = ${participants.get(persona.id)!}
                     and e.item_id = ${itemOf('moral-other').id}
                     and e.source = 'record'
                   order by e.created_at desc, e.id desc limit 1`)) as { rows: { id: string }[] }
              ).rows[0]!
              recorded.entryId = row.id
            }),
          )
          queue.at(addMinutes(at(7, '10:00'), order * 7), 'episode', () =>
            Effect.asVoid(
              assessment.interveneOnEntry(
                t,
                recorded.entryId!,
                {
                  kind: 'void',
                  reason: '经宿管中心复核，违规电器属同寝室他人，撤销对该生的扣分',
                },
                recorder,
              ),
            ),
          )
          return
        }
        case 'item-void': {
          fileAt(0, '20:10', episode.claim!)
          // a few classmates tried the new question too
          const others = present
            .filter(
              (one) =>
                one.id !== persona.id &&
                !world.personas.has(one.id) &&
                !input.onLeave.some((away) => away.id === one.id),
            )
            .sort((a, b) => b.activity - a.activity)
            .slice(0, 5)
          others.forEach((student, index) =>
            queue.at(addMinutes(at(0, '21:00'), index * 23), 'episode', () =>
              Effect.asVoid(
                // with the platform's record of their own, the one shared picture
                file(
                  student,
                  {
                    ...episode.claim!,
                    payload: { ...episode.claim!.payload, hours: 8 },
                    proof: 'practice-2',
                  },
                  true,
                ),
              ),
            ),
          )
          // the lead voids it, and says so where the batch announced it
          queue.at(addMinutes(at(1, '11:00'), order * 7), 'episode', () =>
            Effect.gen(function* () {
              yield* assessment.setItemStatus(
                t,
                itemOf(TRIAL_ITEM.key).id,
                {
                  status: 'voided',
                  reason: '本题与「社会实践与志愿服务」重复，已停用，请在该题申报',
                },
                lead,
              )
              yield* assessment.updateBatch(
                t,
                batch.id,
                {
                  descriptionMd: voidedDescription(description),
                  reason: '试行题目已停用，同步更新批次说明',
                },
                lead,
              )
            }),
          )
          const refiled: { entry?: Filed } = {}
          queue.at(addMinutes(at(1, '20:40'), order * 7), 'episode', () =>
            Effect.map(file(persona, episode.refiled!, true), (entry) => {
              refiled.entry = entry
            }),
          )
          queue.at(addMinutes(at(2, '20:00'), order * 7), 'episode', () =>
            approveNow()(refiled.entry!),
          )
          return
        }
        case 'reroute':
          fileAt(1, '21:00', episode.claim!)
          queue.at(addMinutes(at(3, '10:30'), order * 7), 'route-change', () =>
            rerouteCompetition(held),
          )
          return
      }
    }

    /**
     * The lead adds a counsellor's confirmation after the class lead's step
     * on competitions, and moves every competition under review onto the new
     * route from its start. What was moved is judged again from there; the
     * persona's own claim by its episode, the rest as they come.
     */
    const rerouteCompetition = (held: { entry?: Filed }) =>
      Effect.gen(function* () {
        const item = itemOf('competition')
        const current = (yield* assessment.getItem(t, item.id, lead)).currentRevision!
        const base = reviewPolicyOf(world)
        const config = {
          entryChannels: [...current.entryChannels],
          formConfig: current.formConfig,
          scoringConfig: current.scoringConfig,
          displayConfig: current.displayConfig,
          reviewPolicy: {
            ...base,
            normal: {
              stages: [
                ...base.normal.stages,
                {
                  id: 'counsellor-confirm',
                  label: '辅导员确认',
                  selector: {
                    kind: 'roleAt',
                    nodeTypeId: world.types.grade,
                    roleIds: [world.roles.counsellor],
                  },
                  quorum: { type: 'any' },
                },
              ],
            },
          },
        }
        const asked = yield* Effect.result(assessment.updateItem(t, item.id, { config }, lead))
        if (asked._tag === 'Failure') {
          const report = asked.failure as unknown as { impactToken?: string }
          if (report.impactToken === undefined) return yield* Effect.die(asked.failure)
          yield* assessment.updateItem(
            t,
            item.id,
            {
              config,
              reason: '竞赛类加分改为班级审核后由辅导员确认',
              effects: {
                impactToken: report.impactToken,
                review: {
                  open: 'reroute-all',
                  missingCurrentStage: 'restart-route',
                  landing: 'route-start',
                },
              },
            },
            lead,
          )
        }
        for (const entry of filed) {
          if (entry.claim.item !== 'competition') continue
          const round = yield* currentRoundOf(entry.entryId)
          if (round === null) continue
          const seen = yield* assessment.getReviewInstance(t, round, lead)
          if (seen.state === 'completed') continue
          const moved = round !== entry.instanceId
          entry.instanceId = round
          if (entry === held.entry) {
            queue.at(at(3, '20:00'), 'episode', () => walk(entry, { kind: 'approve' }, 15 * 60))
          } else if (moved && !entry.scripted) {
            review(entry, addMinutes(queue.now, random.int(4 * 60, 30 * 60)))
          }
        }
      })

    episodes.forEach((episode, order) => play(episode, order))

    // the persona's certificate, filed once filing reopens for its question
    if (scoped !== undefined) {
      const held: { entry?: Filed } = {}
      queue.at(at(...scoped.persona.files), 'episode', () =>
        Effect.map(file(persona, scoped.persona.claim, true), (entry) => {
          held.entry = entry
        }),
      )
      queue.at(at(...scoped.persona.approved), 'episode', () =>
        Effect.gen(function* () {
          const entry = held.entry!
          const judge = yield* judgeOf(entry.instanceId!, entry.student)
          if (judge === null) {
            return yield* Effect.die(new Error("nobody can decide the persona's late certificate"))
          }
          yield* approveWith(entry, judge, undefined, undefined)
          entry.status = 'approved'
        }),
      )
    }

    // --- appeals -----------------------------------------------------------

    queue.at(at(9, '09:30'), 'appeals', () =>
      Effect.sync(() => {
        const rejected = filed.filter(
          (one) => one.status === 'rejected' && !one.revised && !one.scripted,
        )
        const approved = filed.filter(
          (one) =>
            one.status === 'approved' &&
            !one.scripted &&
            ['campus', 'competition', 'sport'].includes(one.claim.item),
        )
        const wanted = Math.min(plan.appeals, rejected.length + approved.length)
        const missing = Math.min(rejected.length, Math.round(wanted * 0.8))
        const picks = [
          ...[...rejected]
            .sort(() => random.next() - 0.5)
            .slice(0, missing)
            .map((entry) => ({ entry, kind: 'missing' as const })),
          ...[...approved]
            .sort(() => random.next() - 0.5)
            .slice(0, wanted - missing)
            .map((entry) => ({ entry, kind: 'wrong' as const })),
        ]
        for (const { entry, kind } of picks) {
          const filedAt = addMinutes(at(9, '10:00'), random.int(0, 55 * 60))
          queue.at(filedAt, 'appeal', () =>
            Effect.gen(function* () {
              if (entry.appealed) return
              const round = yield* Effect.result(
                assessment.appealEntry(
                  t,
                  entry.entryId,
                  { reason: random.pick(APPEAL_REASONS[kind]) },
                  asStudent(entry.student),
                ),
              )
              if (round._tag === 'Failure') return
              entry.appealed = true
              entry.instanceId = round.success.id
              const accept = random.chance(kind === 'missing' ? 0.72 : 0.6)
              queue.at(
                awake(addMinutes(queue.now, random.int(6 * 60, 30 * 60))),
                'appeal-review',
                () => decideEscalated(entry, kind, accept),
              )
            }),
          )
        }
      }),
    )

    // --- whatever is still open at the end is settled before archiving ------

    queue.at(at(12, '20:00'), 'sweep', () =>
      Effect.gen(function* () {
        for (const entry of filed) {
          // whatever round the claim stands on now: an episode or a route
          // change may have opened one this list never heard of
          const current = yield* currentRoundOf(entry.entryId)
          if (current === null) continue
          entry.instanceId = current
          const round = yield* assessment.getReviewInstance(t, entry.instanceId, lead)
          if (round.state === 'completed') continue
          if (round.state === 'awaiting_supplement') yield* answer(entry, false)
          for (let step = 0; step < 6; step++) {
            const judge = yield* judgeOf(entry.instanceId, entry.student)
            if (judge === null) break
            yield* approve(entry, judge, 0)
            const after = yield* assessment.getReviewInstance(t, entry.instanceId, lead)
            if (after.state !== 'active') break
          }
        }
      }),
    )
    queue.at(at(13, '10:06'), 'archive', () =>
      Effect.asVoid(assessment.setBatchStatus(t, batch.id, { status: 'archived' }, lead)),
    )

    yield* queue.drain()
    return { batchId: batch.id, participants, counts: queue.counts } satisfies TermOutcome
  })

/** a value along a distribution given as evenly spaced quantiles */
const interpolate = (quantiles: readonly number[], u: number) => {
  const position = u * (quantiles.length - 1)
  const low = Math.floor(position)
  const high = Math.min(low + 1, quantiles.length - 1)
  return quantiles[low]! + (quantiles[high]! - quantiles[low]!) * (position - low)
}

export type { ItemSpec }
