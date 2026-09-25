import { Effect } from 'effect'
import ExcelJS from 'exceljs'
import { sql } from 'kysely'
import type { Principal } from '@qualy/rbac-contract'
import { Assessment } from '@qualy/plugin-assessment/testkit'
import { runSql } from '@qualy/plugin-database/testkit'
import library from '../library.json' with { type: 'json' }
import { APPEAL_REASONS, CADRE_POSTS, REJECTIONS } from '../catalog.ts'
import type { FieldSpec, ItemSpec, Term } from '../rules.ts'
import { claimsOf, type Claim } from './claims.ts'
import { addMinutes, cst, principalOf, type Random, type Story } from './context.ts'
import { stageProof, stageWorkbook } from './files.ts'
import { buildTermItems, type Versions } from './items.ts'
import { EventQueue } from './queue.ts'
import type { Student, World } from './world.ts'

// One term, from the batch being set up to its archive.
//
//   D-3  the assessment lead sets the batch up: phases, score tree, questions
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

const ENTRY = [
  'assessment.entry.create',
  'assessment.entry.edit',
  'assessment.entry.submit',
  'assessment.entry.withdraw',
  'assessment.entry.abandon',
  'assessment.entry.proxy',
  'assessment.entry.record',
  'assessment.review.process',
  'assessment.review.escalate',
]
const REVIEW = [
  'assessment.review.process',
  'assessment.review.escalate',
  'assessment.entry.record',
]
const APPEAL = [
  'assessment.entry.appeal',
  'assessment.review.process',
  'assessment.review.escalate',
  'assessment.entry.record',
]

export const PHASES = [
  { phaseKey: 'entry', displayName: '材料填报', permissionProfile: ENTRY },
  { phaseKey: 'review', displayName: '审核整理', permissionProfile: REVIEW },
  { phaseKey: 'appeal', displayName: '结果申诉', permissionProfile: APPEAL },
  { phaseKey: 'appeal-review', displayName: '申诉处理', permissionProfile: REVIEW },
  { phaseKey: 'archive', displayName: '归档', permissionProfile: [] as string[] },
]

export const ESCALATE_REASONS = ['材料真实性存疑', '认定标准存在争议', '超出当前审核范围'] as const

interface Filed {
  readonly entryId: string
  readonly student: Student
  readonly claim: Claim
  instanceId: string | null
  status: 'draft' | 'in_review' | 'approved' | 'rejected' | 'needs_revision'
  revised: boolean
  appealed: boolean
}

export interface TermOutcome {
  readonly batchId: string
  readonly participants: ReadonlyMap<string, string>
  readonly counts: ReadonlyMap<string, number>
}

export const runTerm = (input: {
  world: World
  plan: TermPlan
  versions: Versions
  story: Story
  random: Random
  /** people who go on leave during this term, chosen before it starts */
  onLeave: readonly Student[]
}) =>
  Effect.gen(function* () {
    const { world, plan, versions, story, random } = input
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
          descriptionMd:
            '请在填报期内提交本学期的加分材料，每项须附证明。学业成绩、寝室、学生干部等由辅导员统一导入，无需申报。',
          materialRange: plan.material,
          import: { orgNodeIds: [world.grade], userTypeIds: [world.userTypes.student] },
        },
        lead,
      ),
      120,
    )
    yield* story.step(
      assessment.replacePlan(t, batch.id, { specs: PHASES.map((phase) => ({ ...phase })) }, lead),
      300,
    )
    const { items } = yield* buildTermItems(world, plan.term, batch.id, versions, story, lead)
    const phases = yield* assessment.getPlan(t, batch.id, lead)
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

    // --- the phases, on their dates ---------------------------------------

    const advance = (index: number, time: Date) =>
      queue.at(time, 'phase', () =>
        Effect.asVoid(
          assessment.advancePhase(
            t,
            batch.id,
            index === 0
              ? { to: phases[index]!.id, force: true, reason: '按学院通知开始本学期综测填报' }
              : { to: phases[index]!.id },
            lead,
          ),
        ),
      )
    advance(0, at(0, '08:00'))
    advance(1, deadline)
    advance(2, at(9, '09:00'))
    advance(3, at(11, '17:00'))

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

    const review = (entry: Filed, when: Date) => queue.at(when, 'review', () => decideNormal(entry))

    const submit = (entry: Filed) =>
      Effect.gen(function* () {
        const sent = yield* assessment.setEntryStatus(
          t,
          entry.entryId,
          'in_review',
          asStudent(entry.student),
        )
        entry.status = 'in_review'
        entry.instanceId = sent.currentReviewInstanceId ?? null
        const delay = random.int(3 * 60, 3 * 24 * 60)
        const when = addMinutes(queue.now, delay)
        review(entry, when < at(1, '19:00') ? addMinutes(at(1, '19:00'), random.int(0, 180)) : when)
      })

    const file = (student: Student, claim: Claim) =>
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
        }
        filed.push(state)
        // a few are left as drafts and never sent
        if (random.chance(0.025)) return
        yield* submit(state)
      })

    for (const student of present) {
      if (input.onLeave.some((one) => one.id === student.id)) continue
      const claims = claimsOf(student, plan.term, random, plan.material)
      for (const claim of claims) {
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
        queue.at(when < at(0, '08:05') ? at(0, '08:30') : when, 'file', () => file(student, claim))
      }
    }

    // --- reviewing ---------------------------------------------------------

    const decideNormal = (entry: Filed): Effect.Effect<void, unknown, unknown> =>
      Effect.gen(function* () {
        if (entry.instanceId === null) return
        const judge = yield* judgeOf(entry.instanceId, entry.student)
        if (judge === null) return
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
            if (when < deadline) queue.at(when, 'revise', () => revise(entry))
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
          queue.at(addMinutes(queue.now, random.int(8 * 60, 40 * 60)), 'escalated', () =>
            decideEscalated(entry, 'claim'),
          )
          return
        }
        if (roll < 0.105 && judge.round.actions.supplement.state === 'available') {
          yield* assessment.requestSupplement(
            t,
            entry.instanceId,
            {
              instructions: '请补充说明活动的组织单位与具体日期',
              requirements: [{ label: '补充说明', kind: 'text', required: true }],
            },
            judge.as,
          )
          queue.at(addMinutes(queue.now, random.int(3 * 60, 20 * 60)), 'supplement-answer', () =>
            answer(entry),
          )
          return
        }
        yield* approve(entry, judge, 0.04)
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

    const answer = (entry: Filed) =>
      Effect.gen(function* () {
        const me = asStudent(entry.student)
        const round = yield* assessment.getReviewInstance(t, entry.instanceId!, me)
        const ask = round.supplements.find((one) => one.status === 'open')
        if (ask === undefined) return
        yield* assessment.answerSupplement(
          t,
          ask.id,
          {
            payload: { f1: '活动由学院学生会组织，时间为学期第十二周周六，已补充组织方盖章证明。' },
          },
          me,
        )
        queue.at(addMinutes(queue.now, random.int(4 * 60, 30 * 60)), 'review', () =>
          decideNormal(entry),
        )
      })

    const revise = (entry: Filed) =>
      Effect.gen(function* () {
        const me = asStudent(entry.student)
        const item = itemOf(entry.claim.item)
        const proof = yield* stageProof(
          t,
          batch.id,
          item.id,
          entry.claim.proof,
          `补充-${entry.claim.filename}`,
          me,
        )
        yield* assessment.appendEntryRevision(
          t,
          entry.entryId,
          { payload: { ...entry.claim.payload, proof: [proof] }, note: '已按意见补充证明材料' },
          me,
        )
        entry.revised = true
        yield* submit(entry)
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

    // --- appeals -----------------------------------------------------------

    queue.at(at(9, '09:30'), 'appeals', () =>
      Effect.sync(() => {
        const rejected = filed.filter((one) => one.status === 'rejected' && !one.revised)
        const approved = filed.filter(
          (one) =>
            one.status === 'approved' &&
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
              queue.at(addMinutes(queue.now, random.int(6 * 60, 30 * 60)), 'appeal-review', () =>
                decideEscalated(entry, kind, accept),
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
          if (entry.instanceId === null) continue
          const round = yield* assessment.getReviewInstance(t, entry.instanceId, lead)
          if (round.state === 'completed') continue
          if (round.state === 'awaiting_supplement') {
            yield* answer(entry)
          }
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
    advance(4, at(13, '10:00'))
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
