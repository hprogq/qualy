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
import { SCRIPTED_ASKS, answerAsk, askFor, requestAsk, type Ask } from './asks.ts'
import { addMinutes, awake, principalOf, type Random, type Story } from './context.ts'
import { PROOF_ASSETS, stageProof, stageWorkbook } from './files.ts'
import { scoringConfigOf, type Versions } from './items.ts'
import { CET4_REPORTS, PAPERS } from './papers.ts'
import { EventQueue } from './queue.ts'
import { ESCALATE_REASONS } from './term.ts'
import type { SeedOptions } from '../options.ts'
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

/**
 * The selection's phases. Re-examination opens while material is reviewed
 * and while results may be appealed, as in the school's own assessments
 * (term.ts); settling what was appealed opens nothing new.
 */
export const SELECTION_PHASES = [
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
    // a result reached while material is still being reviewed may
    // be contested at once, and staff may re-examine one
    phaseKey: 'review',
    displayName: '材料审核',
    permissionProfile: [
      'assessment.review.process',
      'assessment.review.escalate',
      'assessment.review.reopen',
      'assessment.entry.appeal',
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
      'assessment.review.reopen',
    ],
  },
  {
    phaseKey: 'appeal-review',
    displayName: '申诉处理',
    permissionProfile: ['assessment.review.process', 'assessment.review.escalate'],
  },
  { phaseKey: 'archive', displayName: '归档', permissionProfile: [] },
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
  options: SeedOptions
  /** the real moment the story treats as now */
  now: Date
  /** who the demonstration signs in as, by account */
  personas: Readonly<Record<'student' | 'class-lead' | 'counsellor' | 'lead', string>>
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
        { specs: SELECTION_PHASES.map((phase) => ({ ...phase })) },
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

    const oneStage = (
      id: string,
      label: string,
      nodeTypeId: string,
      roleId: string,
      quorum: 'any' | 'all' = 'any',
    ) => ({
      id,
      label,
      selector: { kind: 'roleAt', nodeTypeId, roleIds: [roleId] },
      quorum: { type: quorum },
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
    // The conduct form climbs the school's own ladder: a class lead checks
    // it; a doubt about it, an appeal against that check or a
    // re-examination goes up rung by rung - the class's two leads sitting
    // together, then a counsellor, then the working group, which concludes.
    // Nobody hands a form down to the people below them.
    const conductPolicy = {
      normal: {
        stages: [oneStage('class', '班级综测负责人审核', world.types.class, world.roles.classLead)],
      },
      escalation: {
        stages: [
          oneStage(
            'class-panel',
            '班级综测小组评议',
            world.types.class,
            world.roles.classLead,
            'all',
          ),
          oneStage('counsellor', '辅导员复核', world.types.grade, world.roles.counsellor),
          oneStage('lead', '学院推免工作组', world.types.college, world.roles.manager),
        ],
      },
    }

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
              reviewPolicy: spec.key === 'conduct' ? conductPolicy : policy(false),
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
    const persona = present.find((student) => student.id === input.personas.student)
    const leading = new Set([...world.classLeads.values()].flat().concat(world.majorLeads))
    // the student a visitor signs in as always applies, and so do five of
    // their classmates, whose conduct forms their class leads sit on
    const classmates =
      persona === undefined
        ? []
        : present
            .filter(
              (student) =>
                student.classKey === persona.classKey &&
                student.id !== persona.id &&
                !leading.has(student.id) &&
                !world.personas.has(student.id),
            )
            .sort((a, b) => b.standing - a.standing)
            .slice(0, 5)
    // and one big data student, whose award the route change leaves with
    // nobody appointed to review it
    const bigData = present
      .filter(
        (student) =>
          student.major === 'bd' && !leading.has(student.id) && !world.personas.has(student.id),
      )
      .sort((a, b) => b.standing - a.standing)[0]
    const first = new Set([
      ...(persona === undefined ? [] : [persona.id]),
      ...classmates.map((one) => one.id),
      ...(bigData === undefined ? [] : [bigData.id]),
    ])
    const byStanding = [...present].sort(
      (a, b) => Number(first.has(b.id)) - Number(first.has(a.id)) || b.standing - a.standing,
    )
    const applicants = byStanding.slice(0, 72)
    // the applicants the working group's desk is made of, from other classes;
    // none from big data, whose awards stall at the step nobody holds
    const others =
      persona === undefined
        ? []
        : applicants
            .filter(
              (student) =>
                student.classKey !== persona.classKey &&
                student.major !== 'bd' &&
                !leading.has(student.id) &&
                !world.personas.has(student.id),
            )
            .slice(0, 6)
    const cast = new Set([...first, ...others.map((one) => one.id)])

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
      /** judged by the scene that filed it, never by chance */
      scripted: boolean
      /** the last ask made on the claim, which the student answers with its picture */
      asked: Ask | null
      /** the uploads the claim cites now */
      attachments: readonly string[]
    }
    const filed: Filed[] = []
    const judgeFor = (instanceId: string) =>
      Effect.gen(function* () {
        const seen = yield* assessment.getReviewInstance(t, instanceId, lead)
        if (seen.state !== 'active') return null
        const subject = filed.find((one) => one.instanceId === instanceId)?.student
        const pool =
          seen.chain.stageId === 'counsellor'
            ? counsellors
            : seen.chain.stageId === 'lead'
              ? [lead]
              : seen.chain.stageId === 'class' || seen.chain.stageId === 'class-panel'
                ? (world.classLeads.get(subject?.classKey ?? '') ?? []).map((id) =>
                    principalOf(t, id),
                  )
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

    /**
     * Asks for what `ask` names. Most answer within a day or two and are
     * looked at again; the rest are still out when the story stops.
     */
    const askAndWait = (entry: Filed, ask: Ask, as: Principal) =>
      Effect.gen(function* () {
        yield* requestAsk(t, entry.instanceId!, ask, as)
        entry.asked = ask
        const answered = addMinutes(queue.now, random.int(4 * 60, 36 * 60))
        if (random.chance(0.65) && answered.getTime() < now.getTime() - 1.5 * DAY) {
          queue.at(answered, 'supplement-answer', () =>
            Effect.gen(function* () {
              const sent = yield* answerAsk({
                tenantId: t,
                batchId: batch.id,
                itemId: items.get(entry.item)!.id,
                instanceId: entry.instanceId!,
                ask,
                as: principalOf(t, entry.student.id),
              })
              if (!sent) return
              const again = awake(addMinutes(queue.now, random.int(3 * 60, 20 * 60)))
              if (again.getTime() < now.getTime() - DAY)
                queue.at(again, 'review', () => decide(entry))
            }),
          )
        }
      })

    const decide = (entry: Filed): Effect.Effect<void, unknown, unknown> =>
      Effect.gen(function* () {
        if (entry.instanceId === null) return
        const judge = yield* judgeFor(entry.instanceId)
        if (judge === null) return
        const roll = random.next()
        const form = judge.round.recognitionForm as Form
        // A qualifying paper is judged for being whole: the whole one passes,
        // and the one lacking something is asked for it or refused for it.
        // Once an ask in the round is answered, what it lacked has come in.
        const paper = PAPERS[entry.item]
        if (paper !== undefined) {
          const ask = askFor(entry)
          const answered = judge.round.supplements.some((one) => one.status === 'answered')
          if (ask === undefined || answered) {
            yield* assessment.decideReview(t, entry.instanceId, approval(form), judge.as)
            return
          }
          const canAsk = judge.round.actions.supplement.state === 'available'
          if (canAsk && (paper.refusal === undefined || roll < 0.65)) {
            yield* askAndWait(entry, ask, judge.as)
            return
          }
          if (paper.refusal === undefined) return
          yield* assessment.decideReview(
            t,
            entry.instanceId,
            { decision: 'reject', ...paper.refusal },
            judge.as,
          )
          return
        }
        if (roll < 0.08) {
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
          const settled = awake(addMinutes(queue.now, random.int(6 * 60, 48 * 60)))
          if (random.chance(0.5) && settled.getTime() < now.getTime() - DAY)
            queue.at(settled, 'review', () => decide(entry))
          return
        }
        const ask = askFor(entry)
        if (
          roll < 0.21 &&
          ask !== undefined &&
          judge.round.actions.supplement.state === 'available'
        ) {
          yield* askAndWait(entry, ask, judge.as)
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
          scripted: waiting,
          asked: null,
          attachments: [attachment],
        }
        filed.push(state)
        if (!submit) return state
        const sent = yield* assessment.setEntryStatus(t, entry.id, 'in_review', me)
        state.instanceId = sent.currentReviewInstanceId ?? null
        // reviewed in the day, within a few days - unless it came in during
        // the last few, where the queue is still working through it now
        const when = awake(addMinutes(queue.now, random.int(8 * 60, 4 * 24 * 60)))
        if (!waiting && when.getTime() < now.getTime() - 2.5 * DAY)
          queue.at(when, 'review', () => decide(state))
        return state
      })

    const fileVoid = (...args: Parameters<typeof file>) => Effect.asVoid(file(...args))

    for (const student of applicants) {
      // the persona's claims are written out below
      if (student.id === persona?.id) continue
      // the students the scenes follow file within the first two days
      const start =
        ago(16, '10:00').getTime() + random.next() * (cast.has(student.id) ? 2 : 8) * DAY
      const at = (offsetHours: number) =>
        new Date(Math.min(start + offsetHours * 3_600_000, entryEnds.getTime() - 3_600_000))
      // the students the scenes below follow send their papers in
      const lateStarter = random.chance(0.06) && !cast.has(student.id)
      // the forms the scenes below follow are left for them to judge
      const onDesk = (item: string) =>
        (item === 'conduct' && classmates.some((one) => one.id === student.id)) ||
        (item === 'transcript' && student === others[4])
      // Some papers come in lacking something (papers.ts). The scenes' own
      // lack exactly what they are asked for or refused for: two classmates'
      // conduct forms their head teacher's page, one transcript its stamp.
      const flawedOnDesk = (item: string) =>
        item === 'conduct' ? student === classmates[1] || student === classmates[2] : true
      const report = random.pick(CET4_REPORTS)
      const papers = [
        ['application', {}],
        ['conduct', {}],
        ['transcript', {}],
        [
          'cet4',
          { 'report-no': `2024${random.int(10000000000, 99999999999)}`, score: report.score },
        ],
      ] as const
      for (const [index, [item, payload]] of papers.entries()) {
        const paper = PAPERS[item]!
        const flawed = onDesk(item) ? flawedOnDesk(item) : random.chance(0.2)
        const whole = item === 'cet4' ? report.asset : paper.whole
        queue.at(at(index * 0.3), 'file', () =>
          Effect.asVoid(
            file(
              student,
              item,
              { ...payload },
              flawed ? paper.flawed : whole,
              paper.filename,
              !lateStarter,
              onDesk(item),
            ),
          ),
        )
      }
      const competitions = Math.min(random.int(0, 6), Math.round(student.activity * 6))
      for (let i = 0; i < competitions; i++) {
        const competition = random.weighted(COMPETITIONS)
        const level = competition.levels[random.int(0, competition.levels.length - 1)]!
        queue.at(at(2 + i), 'file', () =>
          fileVoid(
            student,
            'competition',
            {
              name: competition.name,
              term: random.pick(['23-24-2', '24-25-1', '24-25-2', '25-26-1', '25-26-2']),
              level,
              rank: random.int(1, 5),
              team: random.chance(0.6),
            },
            random.pick(PROOF_ASSETS.competition),
            '获奖证书.jpg',
            !random.chance(0.05),
          ),
        )
      }
      const research = random.chance(0.45) ? random.int(1, 2) : 0
      for (let i = 0; i < research; i++) {
        const kind = random.weighted(RESEARCH_KINDS)
        queue.at(at(10 + i), 'file', () =>
          fileVoid(
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
            kind.value === 'software' ? PROOF_ASSETS.software[0] : PROOF_ASSETS.project[0],
            '成果证明.jpg',
            true,
          ),
        )
      }
    }

    // the student a visitor signs in as sent one award in on the last
    // evening; the major's step passed it on the same night, and it waits
    // on the desk of the counsellor a visitor signs in as
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
              "WARNING: the persona student's last award is not waiting for the counsellor persona",
            )
        }),
      )
      queue.at(sentAt, 'file', () =>
        fileVoid(
          persona,
          'competition',
          {
            name: '中国大学生计算机设计大赛',
            term: '25-26-2',
            level: 'provincial',
            rank: 1,
            team: true,
          },
          'competition-1',
          '获奖证书.jpg',
          true,
          true,
        ),
      )
    }

    // --- what the demonstration accounts open onto ---------------------------
    //
    // The student's own claims in every state a claim can be in, an ask
    // answered with the file it named and a determination corrected; the
    // class leads' desk of their class's conduct forms, with appeals sitting
    // before the two of them; the counsellor's desk with refusals, asks, a
    // re-examination and records made by hand; and the working group's desk
    // with an appeal, a claim on its third round, a re-examination, a split
    // class panel and an ask of its own still out.
    //
    // Whatever a text says was supplied was supplied: an ask names a file
    // and its answer uploads one (asks.ts). An appeal only argues; when it
    // needs new material, the step judging it asks for that inside the
    // appeal.

    const desk = principalOf(t, input.personas.counsellor)
    const scene = (at: Date, run: () => Effect.Effect<unknown, unknown, unknown>) =>
      queue.at(at, 'scene', () => Effect.asVoid(run()))
    const reviewing = options.stage !== 'entry'
    const pointerOf = (entry: Filed) =>
      Effect.gen(function* () {
        const found = (yield* runSql(
          sql`select current_review_instance_id as id from entries where id = ${entry.entryId}`,
        )) as { rows: { id: string | null }[] }
        entry.instanceId = found.rows[0]?.id ?? null
        return entry.instanceId
      })
    /** a decision by one named person, who must be able to make it now */
    const decideAs = (
      entry: Filed,
      as: Principal,
      said:
        | { decision: 'approve'; comment?: string }
        | { decision: 'reject' | 'escalate'; reason: string; comment: string },
    ) =>
      Effect.gen(function* () {
        const round = yield* pointerOf(entry)
        const view = yield* assessment.getReviewInstance(t, round!, as)
        if (!view.capabilities.canDecide) {
          return yield* Effect.die(
            new Error(`scene: ${entry.item} is not ${as.userId}'s to decide`),
          )
        }
        const input_ =
          said.decision === 'approve' ? { ...approval(view.recognitionForm), ...said } : said
        yield* assessment.decideReview(t, round!, input_, as)
      })
    /** the step judging now approves, unless it is `stop` */
    const passStep = (entry: Filed, stop?: string) =>
      Effect.gen(function* () {
        const round = yield* pointerOf(entry)
        if (round === null) return
        const judge = yield* judgeFor(round)
        if (judge === null || judge.round.chain.stageId === stop) return
        yield* assessment.decideReview(t, round, approval(judge.round.recognitionForm), judge.as)
      })
    /** asks for `ask`, or for what the claim's own question asks of it */
    const askAs = (entry: Filed, as: Principal, ask: Ask | undefined = askFor(entry)) =>
      Effect.gen(function* () {
        if (ask === undefined) {
          return yield* Effect.die(new Error(`scene: nothing to ask of ${entry.item}`))
        }
        const round = yield* pointerOf(entry)
        yield* requestAsk(t, round!, ask, as)
        entry.asked = ask
      })
    /** the student answers the last ask with the picture it names */
    const answerAs = (entry: Filed) =>
      Effect.gen(function* () {
        const ask = entry.asked
        if (ask === null) return yield* Effect.die(new Error('scene: no ask made'))
        const round = yield* pointerOf(entry)
        const sent = yield* answerAsk({
          tenantId: t,
          batchId: batch.id,
          itemId: items.get(entry.item)!.id,
          instanceId: round!,
          ask,
          as: principalOf(t, entry.student.id),
        })
        if (!sent) return yield* Effect.die(new Error('scene: no ask to answer'))
      })
    const appealAs = (entry: Filed, reason: string) =>
      Effect.asVoid(
        assessment.appealEntry(t, entry.entryId, { reason }, principalOf(t, entry.student.id)),
      )
    /**
     * Files the claim again, as the note says: with what it says changed,
     * or with a picture taken again in place of the one it cited. What is
     * not changed stays as it was, the files included.
     */
    const reviseAs = (
      entry: Filed,
      note: string,
      change: { readonly payload?: Record<string, unknown>; readonly replace?: string },
    ) =>
      Effect.gen(function* () {
        const me = principalOf(t, entry.student.id)
        const target = items.get(entry.item)!
        if (change.replace !== undefined) {
          const attachment = yield* stageProof(
            t,
            batch.id,
            target.id,
            change.replace,
            '重新拍摄-证明材料.jpg',
            me,
          )
          entry.attachments = [attachment]
          entry.proof = change.replace
        }
        entry.payload = { ...entry.payload, ...change.payload }
        yield* assessment.appendEntryRevision(
          t,
          entry.entryId,
          { payload: { ...entry.payload, proof: [...entry.attachments] }, note },
          me,
        )
        yield* assessment.setEntryStatus(t, entry.entryId, 'in_review', me)
        yield* pointerOf(entry)
      })
    /** files a claim a scene then follows, sent in unless `draft` */
    const fileFor = (
      held: Map<string, Filed>,
      key: string,
      student: Student,
      item: string,
      payload: Record<string, unknown>,
      proofAsset: string,
      filename: string,
      draft = false,
    ) =>
      Effect.map(file(student, item, payload, proofAsset, filename, !draft, true), (entry) => {
        held.set(key, entry)
      })
    /** one administrative fact about one applicant, recorded by hand */
    const recordOne = (
      key: string,
      student: Student,
      payload: Record<string, unknown>,
      basis: string,
      as: Principal,
    ) =>
      Effect.gen(function* () {
        const target = items.get(key)!
        const values = yield* determinationOf(target.id, payload, as)
        const request = {
          itemId: target.id,
          target: { kind: 'people' as const, participantIds: [participants.get(student.id)!] },
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
    /** each determined value of a question, from the filed field that would pre-fill it */
    const determinationOf = (itemId: string, filed: Record<string, unknown>, as: Principal) =>
      Effect.gen(function* () {
        const stored = (yield* assessment.getItem(t, itemId, as)).currentRevision!
          .scoringConfig as {
          recognitions?: Record<string, { defaultFromFieldId: string | null }>
        }
        return Object.fromEntries(
          Object.entries(stored.recognitions ?? {}).flatMap(([id, recognition]) =>
            recognition.defaultFromFieldId === null
              ? []
              : [[id, filed[recognition.defaultFromFieldId]]],
          ),
        )
      })
    const papersOf = (student: Student, item: string) =>
      filed.find((one) => one.student.id === student.id && one.item === item)!

    const held = new Map<string, Filed>()
    const one = (key: string) => held.get(key)!

    if (persona !== undefined) {
      const seat = principalOf(t, input.personas['class-lead'])
      const partner = principalOf(
        t,
        (world.classLeads.get(persona.classKey) ?? []).find(
          (id) => id !== input.personas['class-lead'],
        )!,
      )

      // the student: every paper in, two awards, two results, one draft;
      // the transcript came without the registry's stamp
      const report = CET4_REPORTS[0]
      const papers = [
        ['application', {}, PAPERS['application']!.whole],
        ['conduct', {}, PAPERS['conduct']!.whole],
        ['transcript', {}, PAPERS['transcript']!.flawed],
        ['cet4', { 'report-no': '202406118800417', score: report.score }, report.asset],
      ] as const
      papers.forEach(([item, payload, asset], index) =>
        scene(addMinutes(ago(15, '20:10'), index * 3), () =>
          fileFor(held, item, persona, item, { ...payload }, asset, PAPERS[item]!.filename),
        ),
      )
      const awardA = {
        name: '蓝桥杯全国软件和信息技术专业人才大赛',
        term: '25-26-1',
        level: 'provincial',
        rank: 1,
        team: false,
      }
      scene(ago(14, '21:00'), () =>
        fileFor(held, 'award-a', persona, 'competition', awardA, 'competition-1', '获奖证书.jpg'),
      )
      scene(ago(14, '21:20'), () =>
        fileFor(
          held,
          'award-b',
          persona,
          'competition',
          {
            name: '省大学生大数据挑战赛',
            term: '25-26-2',
            level: 'provincial',
            rank: 2,
            team: true,
          },
          SCRIPTED_ASKS.zoneNotice.on,
          '获奖证书.jpg',
        ),
      )
      scene(ago(13, '22:00'), () =>
        fileFor(
          held,
          'research-a',
          persona,
          'research',
          {
            title: '面向课堂考勤的轻量级推荐算法研究',
            term: '25-26-1',
            kind: 'project-provincial',
            role: 'lead',
            source: '大学生创新创业训练计划',
          },
          SCRIPTED_ASKS.provincialProject.on,
          '立项通知书.jpg',
        ),
      )
      scene(ago(12, '21:30'), () =>
        fileFor(
          held,
          'research-b',
          persona,
          'research',
          {
            title: '图书馆座位预约小程序的开发与应用',
            term: '25-26-2',
            kind: 'software',
            role: 'first',
            source: '登记号 DEMO-SR-40817',
          },
          'research-2',
          '成果证明.jpg',
        ),
      )
      scene(ago(9, '22:40'), () =>
        fileFor(
          held,
          'award-d',
          persona,
          'competition',
          {
            name: '全国大学生数学建模竞赛',
            term: '25-26-1',
            level: 'provincial',
            rank: 1,
            team: true,
          },
          'competition-1',
          '获奖证书.jpg',
          true,
        ),
      )
      scene(ago(13, '10:20'), () => decideAs(one('application'), desk, { decision: 'approve' }))
      scene(ago(13, '10:40'), () => decideAs(one('cet4'), desk, { decision: 'approve' }))
      scene(ago(12, '15:00'), () => decideAs(one('award-a'), desk, { decision: 'approve' }))
      scene(ago(12, '15:20'), () =>
        decideAs(one('award-b'), desk, {
          decision: 'reject',
          reason: '申报内容与证明材料不一致',
          comment: '证书为滨海赛区选拔赛的奖项，与申报的省部级不符',
        }),
      )
      // the project certificate says the university's level; the provincial
      // one comes in answer, and the claim goes on to be approved
      scene(ago(12, '16:00'), () =>
        askAs(one('research-a'), desk, SCRIPTED_ASKS.provincialProject.ask),
      )
      scene(ago(11, '20:30'), () => answerAs(one('research-a')))
      scene(ago(11, '16:00'), () =>
        assessment.interveneOnEntry(
          t,
          one('research-b').entryId,
          {
            kind: 'return-for-revision',
            reason: '成果名称与登记号和所附登记证书不一致，请按登记证书填写后重新提交',
          },
          lead,
        ),
      )
      scene(ago(10, '21:00'), () =>
        reviseAs(one('research-b'), '已按登记证书改正成果名称与登记号', {
          payload: { title: '校园服务数据可视化平台 V1.0', source: '登记号 2025SR000000' },
        }),
      )
      scene(ago(9, '10:00'), () => passStep(one('research-b')))
      scene(ago(8, '11:00'), () => passStep(one('research-b')))
      scene(ago(9, '11:00'), () => passStep(one('research-a')))
      scene(ago(7, '15:00'), () => passStep(one('research-a')))
      // the inspection office finds the award was a team's, and says so
      // outside any round
      scene(ago(5, '10:40'), () =>
        Effect.gen(function* () {
          const target = items.get('competition')!
          const values = yield* determinationOf(target.id, { ...awardA, team: true }, lead)
          yield* assessment.redetermineEntry(
            t,
            one('award-a').entryId,
            {
              decision: 'approve',
              recognition: { values },
              reason: '经核对省赛组委会公示名单，该奖项为团队获奖，按团体项目认定',
            },
            lead,
          )
        }),
      )
      scene(ago(8, '21:00'), () =>
        decideAs(one('conduct'), partner, {
          decision: 'reject',
          reason: '不符合本项认定条件',
          comment: '考核表为往年模板，请使用学院今年下发的模板',
        }),
      )
      scene(ago(2, '16:00'), () => askAs(one('transcript'), desk))
      if (reviewing) {
        // the working group asks, inside the appeal, for the notice the
        // student's reason rests on
        scene(ago(4, '20:30'), () =>
          appealAs(
            one('award-b'),
            '赛区选拔赛是省赛的初赛，赛区获奖名单由省组委会统一公布，应按省级认定，请复核',
          ),
        )
        scene(ago(3, '10:00'), () => askAs(one('award-b'), lead, SCRIPTED_ASKS.zoneNotice.ask))
        scene(ago(2, '19:30'), () => answerAs(one('award-b')))
        // the class's two leads sit on the student's appeal; one has voted
        scene(ago(5, '12:10'), () =>
          appealAs(one('conduct'), '学院通知允许沿用往年模板，只要求内容完整，请班级综测小组复核'),
        )
        scene(ago(3, '21:30'), () => decideAs(one('conduct'), partner, { decision: 'approve' }))
      }

      // the class leads' desk: five classmates' conduct forms, the first of
      // them still waiting for either lead
      const [, y, z, w, v] = classmates
      if (y !== undefined) {
        scene(ago(6, '20:00'), () => askAs(papersOf(y, 'conduct'), partner))
        scene(ago(5, '12:30'), () => answerAs(papersOf(y, 'conduct')))
      }
      if (z !== undefined) {
        scene(ago(9, '20:30'), () =>
          decideAs(papersOf(z, 'conduct'), seat, {
            decision: 'reject',
            reason: '申报信息不完整',
            comment: '考核表缺少班主任签字页',
          }),
        )
        if (reviewing) {
          // the page comes in answer to the panel's ask, and the panel sits again
          scene(ago(5, '19:40'), () =>
            appealAs(papersOf(z, 'conduct'), '班主任已在考核表上签字，请复核'),
          )
          scene(ago(4, '21:00'), () => askAs(papersOf(z, 'conduct'), partner))
          scene(ago(3, '12:30'), () => answerAs(papersOf(z, 'conduct')))
        }
      }
      if (w !== undefined) {
        scene(ago(10, '21:15'), () =>
          decideAs(papersOf(w, 'conduct'), partner, {
            decision: 'reject',
            reason: '申报内容与证明材料不一致',
            comment: '考核表所列志愿服务情况与班级记录不一致',
          }),
        )
        if (reviewing) {
          // the two leads disagree; the counsellor gives an opinion and the
          // working group concludes
          scene(ago(5, '10:00'), () =>
            appealAs(papersOf(w, 'conduct'), '志愿服务情况以志愿服务平台的记录为准，请复核'),
          )
          scene(ago(4, '20:00'), () =>
            decideAs(papersOf(w, 'conduct'), seat, { decision: 'approve' }),
          )
          scene(ago(4, '21:30'), () =>
            decideAs(papersOf(w, 'conduct'), partner, {
              decision: 'reject',
              reason: '申报内容与证明材料不一致',
              comment: '平台记录与考核表所列仍有出入',
            }),
          )
          scene(ago(3, '10:30'), () =>
            decideAs(papersOf(w, 'conduct'), desk, {
              decision: 'approve',
              comment: '志愿服务平台记录可查，考核表所列属实',
            }),
          )
        }
      }
      if (v !== undefined) {
        scene(ago(11, '20:00'), () =>
          decideAs(papersOf(v, 'conduct'), seat, { decision: 'approve' }),
        )
      }
    }

    // the working group's desk
    const [a1, a2, a3, a4, a5] = others
    if (a1 !== undefined) {
      scene(ago(15, '21:00'), () =>
        fileFor(
          held,
          'a1',
          a1,
          'competition',
          {
            name: '中国国际大学生创新大赛',
            term: '25-26-1',
            level: 'provincial',
            rank: 1,
            team: true,
          },
          'competition-6',
          '获奖证书.jpg',
        ),
      )
      scene(ago(14, '10:00'), () =>
        decideAs(one('a1'), desk, {
          decision: 'reject',
          reason: '证明材料无法清晰辨识',
          comment: '证书照片反光，获奖等级看不清，请重新上传',
        }),
      )
      scene(ago(13, '20:00'), () =>
        reviseAs(one('a1'), '已重新拍摄证书', { replace: 'competition-1' }),
      )
      scene(ago(9, '14:00'), () => passStep(one('a1'), 'counsellor'))
      scene(ago(8, '10:00'), () => askAs(one('a1'), desk))
      scene(ago(7, '20:00'), () => answerAs(one('a1')))
      scene(ago(6, '11:00'), () =>
        decideAs(one('a1'), desk, {
          decision: 'escalate',
          reason: '材料真实性存疑',
          comment: '补充的获奖名单只列队伍编号，无法确认该生为队员，请工作组核实',
        }),
      )
    }
    if (a2 !== undefined) {
      scene(ago(15, '20:30'), () =>
        fileFor(
          held,
          'a2',
          a2,
          'research',
          {
            title: '基于知识图谱的古籍文字识别分析方法',
            term: '25-26-1',
            kind: 'project-university',
            role: 'lead',
            source: '大学生创新创业训练计划',
          },
          'research-1',
          '立项通知书.jpg',
        ),
      )
      scene(ago(13, '15:00'), () => decideAs(one('a2'), desk, { decision: 'approve' }))
      if (reviewing) {
        scene(ago(3, '10:00'), () =>
          assessment.reopenEntry(
            t,
            one('a2').entryId,
            {
              reason:
                '核查发现该成果与该生上一学期推免材料中的项目为同一课题，请工作组核定是否重复计分',
            },
            desk,
          ),
        )
      }
    }
    if (a3 !== undefined) {
      scene(ago(14, '21:00'), () =>
        fileFor(
          held,
          'a3',
          a3,
          'competition',
          {
            name: '省大学生人工智能挑战赛',
            term: '25-26-2',
            level: 'provincial',
            rank: 1,
            team: false,
          },
          SCRIPTED_ASKS.officialList.on,
          '获奖证书.jpg',
        ),
      )
      scene(ago(9, '09:30'), () => passStep(one('a3'), 'counsellor'))
      scene(ago(8, '11:00'), () =>
        decideAs(one('a3'), desk, {
          decision: 'escalate',
          reason: '材料真实性存疑',
          comment: '竞赛官网公示的获奖名单里查不到该生，请工作组核实',
        }),
      )
      scene(ago(5, '15:00'), () => askAs(one('a3'), lead, SCRIPTED_ASKS.officialList.ask))
    }
    if (a4 !== undefined) {
      scene(ago(14, '21:40'), () =>
        fileFor(
          held,
          'a4',
          a4,
          'competition',
          {
            name: '全国大学生电子商务“创新、创意及创业”挑战赛',
            term: '25-26-2',
            level: 'provincial',
            rank: 1,
            team: true,
          },
          'competition-1',
          '获奖证书.jpg',
        ),
      )
      scene(ago(9, '10:00'), () => passStep(one('a4'), 'counsellor'))
      scene(ago(8, '15:00'), () =>
        decideAs(one('a4'), desk, {
          decision: 'escalate',
          reason: '认定标准存在争议',
          comment: '团体项目的名次折算方式不明确，请工作组核定',
        }),
      )
      scene(ago(7, '10:00'), () => decideAs(one('a4'), lead, { decision: 'approve' }))
    }
    // the counsellor's desk: a transcript back with the stamped page it lacked
    if (a5 !== undefined) {
      scene(ago(4, '11:00'), () => askAs(papersOf(a5, 'transcript'), desk))
      scene(ago(3, '20:00'), () => answerAs(papersOf(a5, 'transcript')))
    }
    // The lead's alert panel: a big data award sent in before the route
    // change, still with the counsellor when it came. The step the change
    // puts first asks for a major reviewer big data never had, so the round
    // stops there and waits for an appointment.
    if (bigData !== undefined) {
      scene(ago(12, '21:10'), () =>
        fileFor(
          held,
          'big-data',
          bigData,
          'competition',
          {
            name: '省大学生大数据挑战赛',
            term: '25-26-1',
            level: 'provincial',
            rank: 1,
            team: true,
          },
          'competition-1',
          '获奖证书.jpg',
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
        const gradesOf = (student: Student) => {
          const rank = (ranked.get(student.major) ?? []).indexOf(student) + 1
          const average = (84 + student.standing * 13 + random.next() * 1.5).toFixed(2)
          return { average, rank, size: bySize.get(student.major) ?? 1 }
        }
        // the registry's export dropped one applicant's row; the counsellor
        // records theirs by hand from the certificate the registry sends
        // three days on (the same applicant whose transcript lacks its stamp)
        const lateGrades = others[4]
        yield* importInto(
          assessment,
          t,
          batch.id,
          items.get('grades')!,
          applicants
            .filter((student) => student !== lateGrades)
            .map((student) => ({ student, values: gradesOf(student) })),
          '教务处前三学年成绩导出',
          importer,
        )
        if (lateGrades !== undefined) {
          const values = gradesOf(lateGrades)
          scene(ago(12, '10:00'), () =>
            recordOne('grades', lateGrades, values, '教务处补发成绩证明（导出时漏行）', desk),
          )
        }

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
        // one row goes in with last year's averages: taken back four days
        // on, and the right ones recorded by hand
        const mistaken = others[5]
        const right = rows.find((row) => row.student === mistaken)
        const shifted = (values: Record<string, string>) => {
          const moral = Number(values['moral']) + 0.6
          const sports = Math.max(0, Number(values['sports']) - 0.35)
          return {
            moral: moral.toFixed(2),
            sports: sports.toFixed(2),
            combined: (moral + sports).toFixed(2),
          }
        }
        yield* importInto(
          assessment,
          t,
          batch.id,
          items.get('conduct-sports')!,
          rows.map((row) => (row === right ? { ...row, values: shifted(row.values) } : row)),
          '本系统六学期综合素质测评结果',
          importer,
        )
        if (mistaken !== undefined && right !== undefined) {
          scene(ago(11, '15:00'), () =>
            Effect.gen(function* () {
              const entry = (
                (yield* runSql(sql`
                  select e.id from entries e
                   where e.participant_id = ${participants.get(mistaken.id)!}
                     and e.item_id = ${items.get('conduct-sports')!.id}
                     and e.status <> 'voided'`)) as { rows: { id: string }[] }
              ).rows[0]!
              yield* assessment.interveneOnEntry(
                t,
                entry.id,
                { kind: 'void', reason: '导入时误用了上一学年的品德与文体均值' },
                desk,
              )
            }),
          )
          scene(ago(11, '15:10'), () =>
            recordOne(
              'conduct-sports',
              mistaken,
              right.values,
              '本系统六学期综合素质测评结果（更正）',
              desk,
            ),
          )
        }
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
              entry.scripted ||
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
            queue.at(awake(addMinutes(queue.now, random.int(6 * 60, 3 * 24 * 60))), 'review', () =>
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
            student.major === 'se' &&
            !world.personas.has(student.id) &&
            !leads.has(student.id) &&
            !cast.has(student.id),
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
