import { Effect } from 'effect'
import ExcelJS from 'exceljs'
import { sql } from 'kysely'
import type { Principal } from '@qualy/rbac-contract'
import { Assessment } from '@qualy/plugin-assessment/testkit'
import { Access } from '@qualy/plugin-rbac/server'
import { Iam } from '@qualy/plugin-auth/server'
import { UserProvisioning } from '@qualy/auth-contract/provisioning'
import { runSql } from '@qualy/plugin-database/testkit'
import { transaction } from '@qualy/plugin-database/server'
import {
  COMPETITIONS,
  REJECTIONS,
  RESEARCH_KINDS,
  RESEARCH_ROLES,
  RESEARCH_SUBJECTS,
  RESEARCH_TREATMENTS,
} from '../catalog.ts'
import { addMinutes, principalOf, type Random, type Story } from './context.ts'
import { stageProof, stageWorkbook } from './files.ts'
import { scoringConfigOf, type Versions } from './items.ts'
import { EventQueue } from './queue.ts'
import { ESCALATE_REASONS } from './term.ts'
import type { FieldSpec, ItemSpec } from '../rules.ts'
import { MAJORS, type MajorKey, type Student, type World } from './world.ts'

// The selection for postgraduate recommendation, running now.
//
// Its own rules, simpler than the school's and computable per person:
//
//   推免综合  100
//   ├ 学业成绩   80   the grade point average times 0.8, imported
//   ├ 素质拓展   20
//   │ ├ 竞赛与科研 10   filed by the applicant, judged by a counsellor
//   │ └ 品德与文体 10   the six terms' averages, taken from the six batches
//   │                   this very system archived, times 0.4, imported
//   └ 资格材料    0   the application form and the rest, required, unscored
//
// Everything is dated against the moment the seeder runs, so the batch is
// really in the stage it says. What it holds is chosen for a demonstration:
// a review queue with work in it, claims sent back and waiting, an ask for
// more material, one applicant whose class changed since the roster was
// taken - and, unless the change is left for a live demonstration, the day
// the lead added a first review step for majors and moved everything under
// review onto the new route, which left the one major with nobody appointed
// to that step blocked.

export type SelectionStage = 'entry' | 'review' | 'appeal'

export interface SelectionOptions {
  readonly stage: SelectionStage
  /** leave the review-route change for the interviewer to watch */
  readonly migrationBefore: boolean
}

const DAY = 86_400_000

const proof = (label: string, maxCount = 2): FieldSpec => ({
  key: 'proof',
  type: 'attachment',
  label,
  required: true,
  maxCount,
})

const TERM_OPTIONS = [
  { value: '23-24-1', label: '2023-2024学年第一学期' },
  { value: '23-24-2', label: '2023-2024学年第二学期' },
  { value: '24-25-1', label: '2024-2025学年第一学期' },
  { value: '24-25-2', label: '2024-2025学年第二学期' },
  { value: '25-26-1', label: '2025-2026学年第一学期' },
  { value: '25-26-2', label: '2025-2026学年第二学期' },
]

const SELECTION_ITEMS: readonly ItemSpec[] = [
  {
    key: 'application',
    title: '推免生申请表',
    group: 'papers',
    channel: 'participant',
    maxEntries: 1,
    fields: [proof('签字后的申请表扫描件', 1)],
    scoring: { kind: 'fixed', value: '0.00' },
    aggregator: 'sum',
  },
  {
    key: 'conduct',
    title: '推免生思想品德考核表',
    group: 'papers',
    channel: 'participant',
    maxEntries: 1,
    fields: [proof('考核表扫描件', 1)],
    scoring: { kind: 'fixed', value: '0.00' },
    aggregator: 'sum',
  },
  {
    key: 'transcript',
    title: '成绩单',
    group: 'papers',
    channel: 'participant',
    maxEntries: 1,
    fields: [proof('教务处盖章成绩单', 2)],
    scoring: { kind: 'fixed', value: '0.00' },
    aggregator: 'sum',
  },
  {
    key: 'cet4',
    title: '全国大学英语四级考试',
    group: 'papers',
    channel: 'participant',
    maxEntries: 1,
    fields: [
      { key: 'report-no', type: 'text', label: '成绩报告单编号', required: true, maxLength: 20 },
      { key: 'score', type: 'integer', label: '笔试成绩', required: true, min: 425, max: 710 },
      proof('成绩报告单', 1),
    ],
    scoring: { kind: 'fixed', value: '0.00' },
    aggregator: 'sum',
  },
  {
    key: 'grades',
    title: '学业成绩',
    group: 'academic',
    channel: 'administrative',
    maxEntries: 1,
    fields: [
      {
        key: 'average',
        type: 'decimal',
        label: '前三学年平均学分绩',
        required: true,
        maxScale: 2,
        min: '0',
        max: '100',
      },
      { key: 'rank', type: 'integer', label: '专业排名', required: true, min: 1, max: 400 },
      { key: 'size', type: 'integer', label: '专业人数', required: true, min: 1, max: 400 },
    ],
    scoring: {
      kind: 'formula',
      formula: 'scaled',
      version: 1,
      constants: { factor: '0.8' },
      recognitions: { value: { label: '平均学分绩', fromField: 'average' } },
    },
    aggregator: 'sum',
  },
  {
    key: 'conduct-sports',
    title: '品德与文体',
    group: 'conduct',
    channel: 'administrative',
    maxEntries: 1,
    fields: [
      {
        key: 'moral',
        type: 'decimal',
        label: '六学期品德行为表现均值',
        required: true,
        maxScale: 2,
        min: '0',
        max: '15',
      },
      {
        key: 'sports',
        type: 'decimal',
        label: '六学期文体表现均值',
        required: true,
        maxScale: 2,
        min: '0',
        max: '10',
      },
      {
        key: 'combined',
        type: 'decimal',
        label: '两项均值之和',
        required: true,
        maxScale: 2,
        min: '0',
        max: '25',
      },
    ],
    scoring: {
      kind: 'formula',
      formula: 'scaled',
      version: 1,
      constants: { factor: '0.4' },
      recognitions: { value: { label: '两项均值之和', fromField: 'combined' } },
    },
    aggregator: 'sum',
  },
  {
    key: 'competition',
    title: '学科竞赛',
    group: 'achievement',
    channel: 'participant',
    maxEntries: 8,
    fields: [
      { key: 'name', type: 'text', label: '竞赛名称', required: true, maxLength: 80 },
      { key: 'term', type: 'choice', label: '获奖学期', required: true, options: TERM_OPTIONS },
      {
        key: 'level',
        type: 'choice',
        label: '获奖等级',
        required: true,
        options: [
          { value: 'national', label: '国家级' },
          { value: 'provincial', label: '省部级' },
          { value: 'municipal', label: '市级' },
        ],
      },
      { key: 'rank', type: 'integer', label: '获奖序位', required: true, min: 1, max: 20 },
      { key: 'team', type: 'boolean', label: '团体项目', required: true },
      proof('获奖证书'),
    ],
    scoring: {
      kind: 'formula',
      formula: 'competition',
      version: 2,
      constants: {
        nationalFirst: '3',
        provincialFirst: '2',
        municipalFirst: '1',
        rankStep: '0.2',
        teamFactor: '0.5',
        teamRankStep: '0.1',
      },
      recognitions: {
        level: { label: '认定等级', fromField: 'level' },
        rank: { label: '认定序位', fromField: 'rank' },
        team: { label: '团体项目', fromField: 'team' },
      },
    },
    aggregator: 'sum',
  },
  {
    key: 'research',
    title: '科研成果',
    group: 'achievement',
    channel: 'participant',
    maxEntries: 5,
    fields: [
      { key: 'title', type: 'text', label: '成果名称', required: true, maxLength: 100 },
      { key: 'term', type: 'choice', label: '取得学期', required: true, options: TERM_OPTIONS },
      {
        key: 'kind',
        type: 'choice',
        label: '成果类别',
        required: true,
        options: RESEARCH_KINDS.map(({ value, label }) => ({ value, label })),
      },
      {
        key: 'role',
        type: 'choice',
        label: '参与身份',
        required: true,
        options: RESEARCH_ROLES.map(({ value, label }) => ({ value, label })),
      },
      { key: 'source', type: 'text', label: '发表至或登记号', required: true, maxLength: 100 },
      proof('成果证明'),
    ],
    scoring: {
      kind: 'formula',
      formula: 'research',
      version: 1,
      constants: { scoreUnit: '0.1' },
      recognitions: {
        kind: { label: '认定类别', fromField: 'kind' },
        role: { label: '认定身份', fromField: 'role' },
      },
    },
    aggregator: 'sum',
  },
]

const GROUPS = [
  { key: 'root', name: '推免综合测评', parent: null, cap: '100.00', floor: '0.00' },
  { key: 'academic', name: '学业成绩', parent: 'root', cap: '80.00', floor: '0.00' },
  { key: 'extension', name: '素质拓展', parent: 'root', cap: '20.00', floor: '0.00' },
  { key: 'papers', name: '资格材料', parent: 'root', cap: '0.00', floor: null },
  { key: 'achievement', name: '竞赛与科研', parent: 'extension', cap: '10.00', floor: null },
  { key: 'conduct', name: '品德与文体', parent: 'extension', cap: '10.00', floor: null },
] as const

export const runSelection = (input: {
  world: World
  versions: Versions
  story: Story
  random: Random
  /** the six archived batches, oldest first, to take the conduct averages from */
  history: readonly string[]
  options: SelectionOptions
  /** the real moment the story treats as now */
  now: Date
}) =>
  Effect.gen(function* () {
    const { world, versions, story, random, options, now } = input
    const assessment = yield* Assessment
    const access = yield* Access
    const t = world.tenantId
    const lead = principalOf(t, world.staff.manager.id)
    const counsellors = world.staff.counsellors.map((one) => principalOf(t, one.id))
    const ago = (days: number, time: string) => {
      const day = new Date(now.getTime() - days * DAY + 8 * 3_600_000).toISOString().slice(0, 10)
      return new Date(`${day}T${time}:00+08:00`)
    }

    // --- the major reviewers the route change will ask for ------------------

    story.set(ago(24, '10:00'))
    const majorReviewer = yield* majorReviewerRole(world, story)
    const provisioning = yield* UserProvisioning
    const teachers = yield* story.step(
      transaction(
        provisioning.createUsers(
          t,
          (['cs', 'se', 'ne', 'is'] as const).map((major, index) => ({
            displayName: world.nextName(),
            businessNo: `T20${18 + index}0${index + 5}`,
            userTypeId: world.userTypes.faculty,
            primaryOrgNodeId: world.grade,
          })),
          world.admin,
        ),
      ),
    )
    // big data has nobody: the major with one class has no teacher appointed
    for (const [index, major] of (['cs', 'se', 'ne', 'is'] as const).entries()) {
      yield* story.step(
        access.grants.grant(
          t,
          {
            userId: teachers[index]!.id,
            roleId: majorReviewer,
            target: { kind: 'org-node', orgNodeId: world.majors.get(major)!, coverage: 'self' },
          },
          world.admin,
        ),
      )
    }

    // --- the batch ---------------------------------------------------------

    story.set(ago(20, '14:30'))
    const batch = yield* story.step(
      assessment.createBatch(
        t,
        {
          name: '2027届推荐优秀应届本科毕业生免试攻读硕士学位研究生综合评价',
          descriptionMd:
            '申请人须前三学年无补考重修、平均学分绩位列本专业前 20%、通过大学英语四级。请在材料提交期内上传申请表、思想品德考核表、成绩单与四级成绩，并申报学科竞赛与科研成果。学业成绩与品德文体由学院统一导入。',
          materialRange: { start: '2023-09-01', end: '2026-09-01' },
          import: { orgNodeIds: [world.grade], userTypeIds: [world.userTypes.student] },
        },
        lead,
      ),
      300,
    )
    yield* story.step(
      assessment.replacePlan(
        t,
        batch.id,
        {
          specs: [
            {
              phaseKey: 'entry',
              displayName: '报名与材料提交',
              permissionProfile: [
                'assessment.entry.create',
                'assessment.entry.edit',
                'assessment.entry.submit',
                'assessment.entry.withdraw',
                'assessment.entry.abandon',
                'assessment.entry.record',
                'assessment.review.process',
                'assessment.review.escalate',
              ],
            },
            {
              phaseKey: 'review',
              displayName: '材料审核',
              permissionProfile: [
                'assessment.review.process',
                'assessment.review.escalate',
                'assessment.entry.record',
              ],
            },
            {
              phaseKey: 'appeal',
              displayName: '结果公示与申诉',
              permissionProfile: [
                'assessment.entry.appeal',
                'assessment.review.process',
                'assessment.review.escalate',
              ],
            },
            {
              phaseKey: 'appeal-review',
              displayName: '申诉处理',
              permissionProfile: ['assessment.review.process', 'assessment.review.escalate'],
            },
            { phaseKey: 'archive', displayName: '归档', permissionProfile: [] },
          ],
        },
        lead,
      ),
      300,
    )

    // the score tree, a level at a time
    const groupIds = new Map<string, string>()
    for (const depth of [0, 1, 2]) {
      const current = yield* assessment.listScoreGroups(t, batch.id, lead)
      const kept = current.groups.map((group) => ({
        id: group.id,
        name: group.name,
        parentGroupId: group.parentGroupId,
        cap: group.cap,
        floor: group.floor,
      }))
      const depthOf = (key: string): number => {
        const group = GROUPS.find((one) => one.key === key)!
        return group.parent === null ? 0 : 1 + depthOf(group.parent)
      }
      const adding = GROUPS.filter((group) => depthOf(group.key) === depth).map((group) => ({
        name: group.name,
        parentGroupId: group.parent === null ? null : groupIds.get(group.parent)!,
        cap: group.cap,
        floor: group.floor,
      }))
      const saved = yield* story.step(
        assessment.replaceScoreGroups(
          t,
          batch.id,
          { groups: [...kept, ...adding], expectedVersion: current.version },
          lead,
        ),
      )
      for (const row of saved.groups) {
        const group = GROUPS.find((one) => one.name === row.name)
        if (group !== undefined) groupIds.set(group.key, row.id)
      }
    }

    const oneStage = (id: string, label: string, nodeTypeId: string, roleId: string) => ({
      id,
      label,
      selector: { kind: 'roleAt', nodeTypeId, roleIds: [roleId] },
      quorum: { type: 'any' },
    })
    const policy = (withMajors: boolean) => ({
      normal: {
        stages: [
          ...(withMajors
            ? [oneStage('majors', '专业负责人初审', world.types.major, majorReviewer)]
            : []),
          oneStage('counsellor', '辅导员审核', world.types.grade, world.roles.counsellor),
        ],
      },
      escalation: {
        stages: [oneStage('lead', '学院推免工作组', world.types.college, world.roles.manager)],
      },
    })

    const items = new Map<string, { id: string; spec: ItemSpec }>()
    for (const [order, spec] of SELECTION_ITEMS.entries()) {
      const created = yield* story.step(
        assessment.createItem(
          t,
          batch.id,
          {
            itemType: 'evidence',
            title: spec.title,
            scoreGroupId: groupIds.get(spec.group)!,
            maxEntries: spec.maxEntries,
            sortOrder: order,
            config: {
              entryChannels: [spec.channel as 'participant' | 'administrative'],
              formConfig: { fields: spec.fields },
              scoringConfig: scoringConfigOf(spec, versions),
              reviewPolicy: policy(false),
            },
          },
          lead,
        ),
        40,
      )
      yield* story.step(assessment.setItemStatus(t, created.id, { status: 'active' }, lead), 20)
      items.set(spec.key, { id: created.id, spec })
    }
    const phases = yield* assessment.getPlan(t, batch.id, lead)
    const participants = new Map<string, string>()
    for (const row of (
      (yield* runSql(
        sql`select id, user_id from batch_participants where batch_id = ${batch.id}`,
      )) as {
        rows: { id: string; user_id: string }[]
      }
    ).rows) {
      participants.set(row.user_id, row.id)
    }

    // the applicants: the strongest students, as far as grades go, with the
    // cohort's major shares
    const present = world.students.filter((student) => participants.has(student.id))
    // the student a visitor signs in as always applies
    const byStanding = [...present].sort(
      (a, b) =>
        Number(world.personas.has(b.id)) - Number(world.personas.has(a.id)) ||
        b.standing - a.standing,
    )
    const applicants = byStanding.slice(0, 72)

    const queue = new EventQueue(story)
    queue.at(ago(16, '09:00'), 'phase', () =>
      Effect.asVoid(
        assessment.advancePhase(
          t,
          batch.id,
          { to: phases[0]!.id, force: true, reason: '按学院通知开始推免报名' },
          lead,
        ),
      ),
    )
    const entryEnds = options.stage === 'entry' ? now : ago(6, '00:00')
    if (options.stage !== 'entry') {
      queue.at(entryEnds, 'phase', () =>
        Effect.asVoid(assessment.advancePhase(t, batch.id, { to: phases[1]!.id }, lead)),
      )
    }
    if (options.stage === 'appeal') {
      queue.at(ago(1, '09:00'), 'phase', () =>
        Effect.asVoid(assessment.advancePhase(t, batch.id, { to: phases[2]!.id }, lead)),
      )
    }

    // --- filings -------------------------------------------------------------

    interface Filed {
      entryId: string
      student: Student
      item: string
      payload: Record<string, unknown>
      proof: string
      instanceId: string | null
    }
    const filed: Filed[] = []
    const judgeFor = (instanceId: string) =>
      Effect.gen(function* () {
        const seen = yield* assessment.getReviewInstance(t, instanceId, lead)
        if (seen.state !== 'active') return null
        const pool =
          seen.chain.stageId === 'counsellor'
            ? counsellors
            : seen.chain.stageId === 'lead'
              ? [lead]
              : teachers.map((one) => principalOf(t, one.id))
        for (const as of pool) {
          const view = yield* Effect.result(assessment.getReviewInstance(t, instanceId, as))
          if (view._tag === 'Success' && view.success.capabilities.canDecide)
            return { as, round: view.success }
        }
        return null
      })

    type Form = {
      fields: readonly { id: string }[]
      seed: Record<string, unknown>
      locked: { values: Record<string, unknown> } | null
    } | null
    const approval = (form: Form) =>
      form === null || form.fields.length === 0
        ? { decision: 'approve' as const }
        : {
            decision: 'approve' as const,
            recognition: { values: { ...(form.locked?.values ?? form.seed) } },
          }

    const decide = (entry: Filed): Effect.Effect<void, unknown, unknown> =>
      Effect.gen(function* () {
        if (entry.instanceId === null) return
        const judge = yield* judgeFor(entry.instanceId)
        if (judge === null) return
        const roll = random.next()
        const form = judge.round.recognitionForm as Form
        if (roll < 0.08 && entry.item !== 'application') {
          const rejection = random.weighted(REJECTIONS)
          yield* assessment.decideReview(
            t,
            entry.instanceId,
            { decision: 'reject', reason: rejection.reason, comment: rejection.comment },
            judge.as,
          )
          return
        }
        // a few contested awards go up to the college working group; the
        // lead settles most of them, the latest are still waiting
        if (
          roll < 0.16 &&
          (entry.item === 'competition' || entry.item === 'research') &&
          judge.round.chain.stageId === 'counsellor' &&
          judge.round.actions.escalate.state === 'available'
        ) {
          yield* assessment.decideReview(
            t,
            entry.instanceId,
            {
              decision: 'escalate',
              reason: random.pick(ESCALATE_REASONS),
              comment: '请学院推免工作组核定',
            },
            judge.as,
          )
          const settled = addMinutes(queue.now, random.int(6 * 60, 48 * 60))
          if (random.chance(0.5) && settled.getTime() < now.getTime() - DAY)
            queue.at(settled, 'review', () => decide(entry))
          return
        }
        if (roll < 0.21 && judge.round.actions.supplement.state === 'available') {
          yield* assessment.requestSupplement(
            t,
            entry.instanceId,
            {
              instructions: '请补充证书原件照片，以及获奖名单公示页面截图',
              requirements: [{ label: '补充说明', kind: 'text', required: true }],
            },
            judge.as,
          )
          // most answer within a day or two and are looked at again; the
          // rest are still out when the story stops
          const answered = addMinutes(queue.now, random.int(4 * 60, 36 * 60))
          if (random.chance(0.65) && answered.getTime() < now.getTime() - 1.5 * DAY) {
            queue.at(answered, 'supplement-answer', () =>
              Effect.gen(function* () {
                const me = principalOf(t, entry.student.id)
                const round = yield* assessment.getReviewInstance(t, entry.instanceId!, me)
                const ask = round.supplements.find((one) => one.status === 'open')
                if (ask === undefined) return
                yield* assessment.answerSupplement(
                  t,
                  ask.id,
                  { payload: { f1: '已补充证书原件照片与公示名单截图，名单中第 12 行为本人。' } },
                  me,
                )
                const again = addMinutes(queue.now, random.int(3 * 60, 20 * 60))
                if (again.getTime() < now.getTime() - DAY)
                  queue.at(again, 'review', () => decide(entry))
              }),
            )
          }
          return
        }
        yield* assessment.decideReview(t, entry.instanceId, approval(form), judge.as)
      })

    const file = (
      student: Student,
      item: string,
      payload: Record<string, unknown>,
      proofAsset: string,
      filename: string,
      submit: boolean,
      waiting = false,
    ) =>
      Effect.gen(function* () {
        const target = items.get(item)!
        const me = principalOf(t, student.id)
        const attachment = yield* stageProof(t, batch.id, target.id, proofAsset, filename, me)
        const entry = yield* assessment.createEntry(
          t,
          {
            itemId: target.id,
            participantId: participants.get(student.id)!,
            payload: { ...payload, proof: [attachment] },
          },
          me,
        )
        const state: Filed = {
          entryId: entry.id,
          student,
          item,
          payload,
          proof: proofAsset,
          instanceId: null,
        }
        filed.push(state)
        if (!submit) return
        const sent = yield* assessment.setEntryStatus(t, entry.id, 'in_review', me)
        state.instanceId = sent.currentReviewInstanceId ?? null
        // reviewed within a few days - unless it came in during the last few,
        // where the queue is still working through it now
        const when = addMinutes(queue.now, random.int(8 * 60, 4 * 24 * 60))
        if (!waiting && when.getTime() < now.getTime() - 2.5 * DAY)
          queue.at(when, 'review', () => decide(state))
      })

    for (const student of applicants) {
      const start = ago(16, '10:00').getTime() + random.next() * 8 * DAY
      const at = (offsetHours: number) =>
        new Date(Math.min(start + offsetHours * 3_600_000, entryEnds.getTime() - 3_600_000))
      const lateStarter = random.chance(0.06)
      const papers = [
        ['application', {}, 'campus-1', '推免生申请表.jpg'],
        ['conduct', {}, 'campus-1', '思想品德考核表.jpg'],
        ['transcript', {}, 'certificate-3', '成绩单.jpg'],
        [
          'cet4',
          {
            'report-no': `2024${random.int(10000000000, 99999999999)}`,
            score: random.int(440, 640),
          },
          'certificate-1',
          '四级成绩报告单.jpg',
        ],
      ] as const
      for (const [index, [item, payload, asset, name]] of papers.entries()) {
        queue.at(at(index * 0.3), 'file', () =>
          file(student, item, { ...payload }, asset, name, !lateStarter),
        )
      }
      const competitions = Math.min(random.int(0, 6), Math.round(student.activity * 6))
      for (let i = 0; i < competitions; i++) {
        const competition = random.weighted(COMPETITIONS)
        const level = competition.levels[random.int(0, competition.levels.length - 1)]!
        queue.at(at(2 + i), 'file', () =>
          file(
            student,
            'competition',
            {
              name: competition.name,
              term: random.pick(['23-24-2', '24-25-1', '24-25-2', '25-26-1', '25-26-2']),
              level,
              rank: random.int(1, 5),
              team: random.chance(0.6),
            },
            random.pick(['competition-1', 'competition-2', 'competition-3']),
            '获奖证书.jpg',
            !random.chance(0.05),
          ),
        )
      }
      const research = random.chance(0.45) ? random.int(1, 2) : 0
      for (let i = 0; i < research; i++) {
        const kind = random.weighted(RESEARCH_KINDS)
        queue.at(at(10 + i), 'file', () =>
          file(
            student,
            'research',
            {
              title: random
                .pick(RESEARCH_TREATMENTS)
                .replace('{subject}', random.pick(RESEARCH_SUBJECTS)),
              term: random.pick(['24-25-1', '24-25-2', '25-26-1', '25-26-2']),
              kind: kind.value,
              role: random.weighted(RESEARCH_ROLES).value,
              source:
                kind.value === 'software'
                  ? `登记号 DEMO-SR-${random.int(10000, 99999)}`
                  : '大学生创新创业训练计划',
            },
            kind.value === 'software' ? 'research-2' : 'research-1',
            '成果证明.jpg',
            true,
          ),
        )
      }
    }

    // the student a visitor signs in as sent one award in on the last
    // evening; the major's step passed it on the same night, and it waits
    // on the desk of the counsellor a visitor signs in as
    const persona = applicants.find((student) => world.personas.has(student.id))
    if (persona !== undefined) {
      const sentAt = new Date(entryEnds.getTime() - 5 * 3_600_000)
      queue.at(addMinutes(sentAt, 50), 'review', () =>
        Effect.gen(function* () {
          const entry = [...filed]
            .reverse()
            .find((one) => one.student.id === persona.id && one.item === 'competition')
          if (entry?.instanceId == null) return
          for (let step = 0; step < 3; step++) {
            const round = yield* assessment.getReviewInstance(t, entry.instanceId, lead)
            if (round.state !== 'active' || round.chain.stageId === 'counsellor') break
            const judge = yield* judgeFor(entry.instanceId)
            if (judge === null) break
            const form = judge.round.recognitionForm as Form
            yield* assessment.decideReview(t, entry.instanceId, approval(form), judge.as)
          }
          const desk = principalOf(t, world.staff.counsellors[0]!.id)
          const seen = yield* Effect.result(assessment.getReviewInstance(t, entry.instanceId, desk))
          if (seen._tag !== 'Success' || !seen.success.capabilities.canDecide)
            console.warn(
              'WARNING: the persona student\'s last award is not waiting for the counsellor persona',
            )
        }),
      )
      queue.at(sentAt, 'file', () =>
        file(
          persona,
          'competition',
          {
            name: '中国大学生计算机设计大赛',
            term: '25-26-2',
            level: 'provincial',
            rank: 2,
            team: true,
          },
          'competition-1',
          '获奖证书.jpg',
          true,
          true,
        ),
      )
    }

    // --- what the college imports -------------------------------------------

    queue.at(ago(15, '16:20'), 'import', () =>
      Effect.gen(function* () {
        const importer = counsellors[0]!
        const bySize = new Map<MajorKey, number>()
        for (const student of present)
          bySize.set(student.major, (bySize.get(student.major) ?? 0) + 1)
        const ranked = new Map<MajorKey, Student[]>()
        for (const student of [...present].sort((a, b) => b.standing - a.standing)) {
          const list = ranked.get(student.major) ?? []
          list.push(student)
          ranked.set(student.major, list)
        }
        yield* importInto(
          assessment,
          t,
          batch.id,
          items.get('grades')!,
          applicants.map((student) => {
            const rank = (ranked.get(student.major) ?? []).indexOf(student) + 1
            const average = (84 + student.standing * 13 + random.next() * 1.5).toFixed(2)
            return { student, values: { average, rank, size: bySize.get(student.major) ?? 1 } }
          }),
          '教务处前三学年成绩导出',
          importer,
        )

        // the conduct averages, read from the six batches this system archived
        const rows: { student: Student; values: Record<string, string> }[] = []
        for (const student of applicants) {
          let moral = 0
          let sports = 0
          let terms = 0
          for (const batchId of input.history) {
            const participant = (
              (yield* runSql(
                sql`select id from batch_participants where batch_id = ${batchId} and user_id = ${student.id}`,
              )) as {
                rows: { id: string }[]
              }
            ).rows[0]
            if (participant === undefined) continue
            const result = yield* assessment.getParticipantResult(t, batchId, participant.id, lead)
            const section = (name: string) =>
              Number(result.groups.find((group) => group.name === name)?.final ?? 0)
            moral += section('品德行为表现')
            sports += section('文体表现')
            terms += 1
          }
          if (terms === 0) continue
          const m = Math.round((moral / terms) * 100) / 100
          const s = Math.round((sports / terms) * 100) / 100
          rows.push({
            student,
            values: { moral: m.toFixed(2), sports: s.toFixed(2), combined: (m + s).toFixed(2) },
          })
        }
        yield* importInto(
          assessment,
          t,
          batch.id,
          items.get('conduct-sports')!,
          rows,
          '本系统六学期综合素质测评结果',
          importer,
        )
      }),
    )

    // --- the route change, ten days in ---------------------------------------

    if (!options.migrationBefore && options.stage !== 'entry') {
      queue.at(ago(10, '11:15'), 'route-change', () =>
        Effect.gen(function* () {
          for (const key of ['competition', 'research']) {
            const item = items.get(key)!
            const current = yield* assessment.getItem(t, item.id, lead)
            const config = {
              entryChannels: ['participant' as const],
              formConfig: { fields: item.spec.fields },
              scoringConfig: current.currentRevision!.scoringConfig,
              reviewPolicy: policy(true),
            }
            const asked = yield* Effect.result(assessment.updateItem(t, item.id, { config }, lead))
            // nothing under way: the change simply took effect
            if (asked._tag === 'Success') continue
            const report = asked.failure as unknown as { impactToken?: string }
            if (report.impactToken === undefined) return yield* Effect.die(asked.failure)
            yield* assessment.updateItem(
              t,
              item.id,
              {
                config,
                reason: '推免工作组要求：竞赛与科研材料先由专业负责人初审，再交辅导员审核',
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
          // what was moved is now at a new first step; it is decided again from there
          for (const entry of filed) {
            if (
              entry.instanceId === null ||
              (entry.item !== 'competition' && entry.item !== 'research')
            )
              continue
            const round = (
              (yield* runSql(sql`
                select id from review_instances
                 where entry_id = ${entry.entryId} and state in ('active', 'blocked', 'awaiting_supplement')
                 order by round_no desc limit 1`)) as { rows: { id: string }[] }
            ).rows[0]
            if (round === undefined) continue
            entry.instanceId = round.id
            queue.at(addMinutes(queue.now, random.int(6 * 60, 3 * 24 * 60)), 'review', () =>
              Effect.gen(function* () {
                // the major step, then the counsellor's
                for (let step = 0; step < 2; step++) {
                  const before = yield* assessment.getReviewInstance(t, entry.instanceId!, lead)
                  if (before.state !== 'active') return
                  yield* decide(entry)
                  const after = yield* assessment.getReviewInstance(t, entry.instanceId!, lead)
                  if (after.state !== 'active' || after.chain.stageId === before.chain.stageId)
                    return
                }
              }),
            )
          }
        }),
      )
    }

    // --- somebody moved class after the roster was taken ----------------------

    queue.at(ago(8, '15:05'), 'transfer', () =>
      Effect.gen(function* () {
        const iam = yield* Iam
        // never somebody a visitor signs in as, nor a class's lead: the
        // demonstration needs them where they are
        const leads = new Set([...world.classLeads.values()].flat())
        const mover = applicants.find(
          (student) =>
            student.major === 'se' && !world.personas.has(student.id) && !leads.has(student.id),
        )!
        const target = [...world.classes.values()].find(
          (unit) =>
            unit.major === 'se' && unit.key !== mover.classKey && unit.key.startsWith('2023-'),
        )!
        const row = (yield* iam.users.get(world.admin, mover.id)) as { version: number }
        yield* iam.users.setPlacement(t, mover.id, target.nodeId, row.version, world.admin)
        mover.classKey = target.key
      }),
    )

    yield* queue.drain()
    return {
      batchId: batch.id,
      applicants,
      counts: queue.counts,
      teachers: teachers.map((one) => one.id),
    }
  })

/** the role the route change asks for, held by a teacher at a major */
const majorReviewerRole = (world: World, story: Story) =>
  Effect.gen(function* () {
    const access = yield* Access
    const t = world.tenantId
    const id = yield* story.step(
      access.roles.create(
        t,
        { code: 'major-reviewer', name: '推免专业负责人', kind: 'org' },
        world.admin,
      ),
    )
    let version = (yield* access.roles.get(t, id, world.admin)).role.version
    version = yield* story.step(
      access.roles.setPermissions(t, id, ['assessment.review.process'], version, world.admin),
    )
    version = yield* story.step(
      access.roles.setEligibility(
        t,
        id,
        {
          holderPolicy: { mode: 'allow-list', userTypeIds: [world.userTypes.faculty] },
          anchorPolicy: { mode: 'allow-list', orgTypeIds: [world.types.major] },
        },
        version,
        world.admin,
      ),
    )
    yield* story.step(access.roles.setStatus(t, id, 'active', version, world.admin))
    return id
  })

/** rows into an administrative question through its own template, determinations filled in */
const importInto = (
  assessment: Effect.Success<typeof Assessment>,
  t: string,
  batchId: string,
  item: { id: string; spec: ItemSpec },
  rows: readonly { student: Student; values: Record<string, string | number> }[],
  basis: string,
  as: Principal,
) =>
  Effect.gen(function* () {
    const template = yield* assessment.administrativeImportTemplate(t, item.id, 'zh-CN', as)
    const book = new ExcelJS.Workbook()
    yield* Effect.promise(() => book.xlsx.load(template.bytes as unknown as ArrayBuffer))
    const sheet = book.getWorksheet('行政认定')!
    const headers = (sheet.getRow(1).values as unknown[]).slice(1).map((cell) => String(cell ?? ''))
    const scoring = item.spec.scoring
    for (const row of rows) {
      const cells = headers.map((): string | number => '')
      cells[0] = row.student.number
      cells[1] = row.student.name
      for (const field of item.spec.fields) {
        const column = headers.indexOf(field.label)
        const value = row.values[field.key]
        if (column >= 0 && value !== undefined) cells[column] = value
      }
      if (scoring.kind === 'formula') {
        // a determination's column is headed by the formula's own title in the
        // sheet's language; the label is tried first, the declared order after
        const determined = headers
          .map((header, column) => ({ header, column }))
          .filter(({ header }) => header.startsWith('认定：'))
        Object.values(scoring.recognitions).forEach((recognition, order) => {
          const column =
            determined.find(({ header }) => header === `认定：${recognition.label}`)?.column ??
            determined[order]?.column
          const value =
            recognition.fromField === undefined ? undefined : row.values[recognition.fromField]
          if (column !== undefined && value !== undefined) cells[column] = value
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
      batchId,
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

export const MAJOR_NAMES = MAJORS
