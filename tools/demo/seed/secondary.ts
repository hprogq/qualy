import { Effect } from 'effect'
import { sql } from 'kysely'
import { Assessment } from '@qualy/plugin-assessment/testkit'
import { runSql } from '@qualy/plugin-database/testkit'
import type { World } from './world.ts'
import { awake, cst, principalOf, type Story } from './context.ts'
import { publishFormula } from './formulas.ts'
import { scoringConfigOf } from './items.ts'
import { itemsOf } from '../rules.ts'
import { stageProof } from './files.ts'
import { answerAsk, requestAsk } from './asks.ts'
import { FILING, APPEAL } from './stages.ts'
import { randomStream } from './random-stream.ts'
import { drawSecondaryActivities, SECONDARY_ACTIVITIES } from './secondary-activities.ts'

export const SECONDARY_BATCHES = [
  {
    name: '2025-2026-1 英语学院本科生综合素质考核',
    day: '2026-03-16',
    active: false,
    material: { start: '2025-09-01', end: '2026-03-01' },
  },
  {
    name: '2025-2026-2 英语学院本科生综合素质考核',
    day: '2026-09-02',
    active: true,
    material: { start: '2026-03-01', end: '2026-09-01' },
  },
] as const

/** A second college with its own staff and records, never borrowing the main college's authority. */
export const runSecondaryCollege = (world: World, story: Story) =>
  Effect.gen(function* () {
    const assessment = yield* Assessment
    const t = world.tenantId
    const school = world.secondary
    const as = principalOf(t, school.staff.manager.id)
    const counsellor = principalOf(t, school.staff.counsellor.id)
    story.set(cst('2026-03-02T10:00:00'))
    const identity = yield* publishFormula(t, 'identity', as, story)
    const versions = new Map([['identity', identity.versionIds]])
    const academic = itemsOf('25-26-2').find((item) => item.key === 'academic-base')!
    for (const plan of SECONDARY_BATCHES) {
      story.set(cst(`${plan.day}T09:00:00`))
      const batch = yield* story.step(
        assessment.createBatch(
          t,
          {
            name: plan.name,
            descriptionMd:
              '面向英语与翻译专业，按班级完成材料初审，疑难事项交学院复核。学业成绩由教务工作人员认定，活动与竞赛材料由本人申报。',
            materialRange: plan.material,
            import: { orgNodeIds: [school.grade], userTypeIds: [world.userTypes.student] },
          },
          as,
        ),
      )
      yield* story.step(
        assessment.replacePlan(
          t,
          batch.id,
          {
            specs: [
              {
                phaseKey: 'entry',
                displayName: '申报与审核',
                permissionProfile: [...new Set([...FILING, ...APPEAL])],
              },
              { phaseKey: 'settle', displayName: '结果核对', permissionProfile: [...APPEAL] },
            ],
          },
          as,
        ),
      )
      const groups = yield* assessment.listScoreGroups(t, batch.id, as)
      const saved = yield* story.step(
        assessment.replaceScoreGroups(
          t,
          batch.id,
          {
            expectedVersion: groups.version,
            groups: [{ name: '综合素质考核', parentGroupId: null, cap: '100', floor: '0' }],
          },
          as,
        ),
      )
      const group = saved.groups[0]!.id
      const route = {
        normal: {
          stages: [
            {
              id: 'class',
              label: '班级初审',
              selector: {
                kind: 'roleAt',
                nodeTypeId: world.types.class,
                roleIds: [world.roles.classLead],
              },
              quorum: { type: 'any' },
            },
          ],
        },
        escalation: {
          stages: [
            {
              id: 'counsellor',
              label: '学院复核',
              selector: {
                kind: 'roleAt',
                nodeTypeId: world.types.grade,
                roleIds: [world.roles.counsellor],
              },
              quorum: { type: 'any' },
            },
          ],
        },
      }
      const marks = yield* story.step(
        assessment.createItem(
          t,
          batch.id,
          {
            itemType: 'evidence',
            title: academic.title,
            scoreGroupId: group,
            maxEntries: 1,
            config: {
              entryChannels: ['administrative'],
              formConfig: { fields: academic.fields },
              scoringConfig: scoringConfigOf(academic, versions),
              reviewPolicy: { mode: 'none' },
            },
          },
          as,
        ),
      )
      yield* story.step(assessment.setItemStatus(t, marks.id, { status: 'active' }, as))
      const activities: { id: string; spec: (typeof SECONDARY_ACTIVITIES)[number] }[] = []
      for (const [sortOrder, spec] of SECONDARY_ACTIVITIES.entries()) {
        const item = yield* story.step(
          assessment.createItem(
            t,
            batch.id,
            {
              itemType: 'evidence',
              title: spec.title,
              scoreGroupId: group,
              maxEntries: 6,
              sortOrder: sortOrder + 1,
              config: {
                entryChannels: ['participant'],
                formConfig: {
                  fields: [
                    {
                      key: 'activity',
                      type: 'text',
                      label: '活动名称',
                      required: true,
                      maxLength: 100,
                    },
                    {
                      key: 'description',
                      type: 'text',
                      label: '参与情况',
                      required: true,
                      maxLength: 500,
                    },
                    {
                      key: 'proof',
                      type: 'attachment',
                      label: '证明材料',
                      required: true,
                      maxCount: 3,
                    },
                  ],
                },
                scoringConfig: {
                  calculator: { ref: 'fixed@1', config: { value: spec.value } },
                  aggregator: { ref: 'sum@1', config: {} },
                },
                reviewPolicy: route,
              },
            },
            as,
          ),
        )
        yield* story.step(assessment.setItemStatus(t, item.id, { status: 'active' }, as))
        activities.push({ id: item.id, spec })
      }
      const phases = yield* assessment.getPlan(t, batch.id, as)
      yield* story.step(
        assessment.advancePhase(
          t,
          batch.id,
          { to: phases[0]!.id, force: true, reason: '按学院安排开放材料申报' },
          as,
        ),
      )
      const roster = (
        (yield* runSql(
          sql`select id, user_id from batch_participants where batch_id = ${batch.id}`,
        )) as { rows: { id: string; user_id: string }[] }
      ).rows
      const participants = new Map(roster.map((row) => [row.user_id, row.id]))
      const stored = (yield* assessment.getItem(t, marks.id, as)).currentRevision!
        .scoringConfig as { recognitions: Record<string, unknown> }
      const recognitionId = Object.keys(stored.recognitions)[0]!
      const step = <A, E, R>(action: Effect.Effect<A, E, R>) => {
        story.set(awake(story.at))
        return story.step(action, 53)
      }
      for (const person of school.students) {
        const random = randomStream('english', plan.day, person.number)
        const me = principalOf(t, person.id)
        const value = (54 + 19 * person.standing + random.next()).toFixed(2)
        const request = {
          itemId: marks.id,
          target: { kind: 'people' as const, participantIds: [participants.get(person.id)!] },
          payload: { average: (Number(value) / 0.75).toFixed(2), score: value },
          recognition: { values: { [recognitionId]: value } },
          basis: '学院教务核对的本学期平均学分绩，按 75% 折算',
        }
        const preview = yield* assessment.previewAdministrativeRecord(t, batch.id, request, as)
        yield* step(
          assessment.recordAdministrativeBatch(
            t,
            batch.id,
            {
              ...request,
              excludedParticipantIds: [],
              expectedTargetFingerprint: preview.targetFingerprint,
            },
            as,
          ),
        )
        const leadId = school.classLeads.get(person.classKey)!.find((id) => id !== person.id)!
        const reviewer = principalOf(t, leadId)
        const count = random.int(1, 4)
        for (const { spec, activity } of drawSecondaryActivities(random, count)) {
          const item = activities.find((item) => item.spec === spec)!
          const proof = yield* step(
            stageProof(t, batch.id, item.id, activity.proof, `${activity.name}证明.jpg`, me),
          )
          let payload = {
            activity: activity.name,
            description: `参加${activity.name}，证明材料附后。`,
            proof: [proof],
          }
          const entry = yield* step(
            assessment.createEntry(
              t,
              { itemId: item.id, participantId: participants.get(person.id)!, payload },
              me,
            ),
          )
          const path = random.int(0, 9)
          if (plan.active && path === 0) continue
          let submitted = yield* step(assessment.setEntryStatus(t, entry.id, 'in_review', me))
          let roundId = submitted.currentReviewInstanceId!
          if (plan.active && path === 1) continue
          if (path === 2 || path === 3) {
            yield* step(
              assessment.decideReview(
                t,
                roundId,
                {
                  decision: 'reject',
                  reason: '申报信息不完整',
                  comment: `请写明本人在${activity.name}中承担的具体工作，再提交复核`,
                },
                reviewer,
              ),
            )
            if (plan.active && path === 2) continue
            payload = {
              ...payload,
              description: `本人在${activity.name}中${activity.work}。`,
            }
            yield* step(
              assessment.appendEntryRevision(
                t,
                entry.id,
                { payload, note: '补充本人承担的工作后重新提交' },
                me,
              ),
            )
            submitted = yield* step(assessment.setEntryStatus(t, entry.id, 'in_review', me))
            roundId = submitted.currentReviewInstanceId!
            if (plan.active) continue
          }
          if (path === 4 || path === 5) {
            const ask = activity.ask
            yield* step(requestAsk(t, roundId, ask, reviewer))
            if (plan.active && path === 4) continue
            yield* step(
              answerAsk({
                tenantId: t,
                batchId: batch.id,
                itemId: item.id,
                instanceId: roundId,
                ask,
                as: me,
              }),
            )
            if (plan.active) continue
          }
          if (path === 6) {
            yield* step(
              assessment.decideReview(
                t,
                roundId,
                {
                  decision: 'escalate',
                  reason: '认定标准存在争议',
                  comment: `${activity.name}涉及学院认定范围，请辅导员核对活动安排与材料后作出结论`,
                },
                reviewer,
              ),
            )
            if (plan.active) continue
            yield* step(
              assessment.decideReview(
                t,
                roundId,
                { decision: 'approve', comment: '已核对学院活动记录，按参与情况认定' },
                counsellor,
              ),
            )
          } else {
            yield* step(
              assessment.decideReview(
                t,
                roundId,
                {
                  decision: 'approve',
                  comment: random.pick([
                    '证明与申报内容一致',
                    '已核对参与名单',
                    '材料齐全，同意认定',
                  ]),
                },
                reviewer,
              ),
            )
          }
        }
      }
      if (!plan.active) {
        yield* step(assessment.advancePhase(t, batch.id, { to: phases[1]!.id }, as))
        yield* step(assessment.setBatchStatus(t, batch.id, { status: 'archived' }, as))
      }
      console.log(
        `secondary college: ${plan.active ? 'active' : 'archived'}, ${participants.size} participants`,
      )
    }
  })
