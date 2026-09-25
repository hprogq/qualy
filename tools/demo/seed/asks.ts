import { Effect } from 'effect'
import type { Principal } from '@qualy/rbac-contract'
import { Assessment } from '@qualy/plugin-assessment/testkit'
import { stageProof } from './files.ts'

// What a reviewer asks for beyond the filing, and what comes back.
//
// Every ask in the demonstration asks for a file, and every answer uploads
// one through the question's own upload door, the way a browser would: a
// visitor who opens an answered ask sees the picture it talks about. Text is
// only ever the note beside it.

export interface Ask {
  /** what the reviewer writes */
  readonly instructions: string
  /** the file asked for, as the ask names it */
  readonly file: string
  /** the picture the student uploads in answer, from tools/demo/assets */
  readonly asset: string
  readonly filename: string
  /** what the student writes beside it, when anything */
  readonly note?: string
}

/** an ask's pieces: the file, and room for a note */
export const requirementsOf = (ask: Ask) => [
  { label: ask.file, kind: 'file' as const, required: true },
  { label: '补充说明', kind: 'text' as const, required: false },
]

/** what a class lead or a counsellor asks for on a claim of this question */
export const askFor = (item: string): Ask => ASKS[item] ?? DEFAULT_ASK

const DEFAULT_ASK: Ask = {
  instructions: '请上传组织单位盖章的参与证明，写明活动日期',
  file: '盖章的参与证明',
  asset: 'campus-1',
  filename: '参与证明.jpg',
  note: '活动由学院学生会组织，时间为学期第十二周周六',
}

const ASKS: Readonly<Record<string, Ask>> = {
  competition: {
    instructions: '请上传获奖名单公示页截图，并标出本人所在行',
    file: '获奖名单公示页截图',
    asset: 'notice-1',
    filename: '获奖名单公示.jpg',
    note: '本人在名单第 17 行',
  },
  practice: {
    instructions: '请上传志愿服务平台的时长记录截图',
    file: '时长记录截图',
    asset: 'practice-2',
    filename: '志愿服务时长记录.jpg',
  },
  sport: {
    instructions: '证书为团体奖项，请上传赛事成绩册中本队所在页',
    file: '成绩册本队所在页',
    asset: 'roster-1',
    filename: '赛事成绩册.jpg',
  },
  research: {
    instructions: '请上传立项通知书或登记证书首页',
    file: '立项通知书或登记证书',
    asset: 'research-1',
    filename: '立项通知书.jpg',
  },
  transcript: {
    instructions: '成绩单缺少教务处盖章，请上传盖章页',
    file: '教务处盖章页',
    asset: 'transcript-1',
    filename: '成绩单盖章页.jpg',
  },
  cet4: {
    instructions: '成绩报告单截图不完整，请上传完整的成绩报告单',
    file: '成绩报告单',
    asset: 'certificate-1',
    filename: '四级成绩报告单.jpg',
  },
  conduct: {
    instructions: '考核表缺少班主任签字页，请上传',
    file: '班主任签字页',
    asset: 'signature-1',
    filename: '考核表签字页.jpg',
  },
  application: {
    instructions: '申请表缺少本人签字，请上传签字后的扫描件',
    file: '签字后的申请表',
    asset: 'application-1',
    filename: '推免生申请表.jpg',
  },
}

/** every ask the seeders make, for checking the pictures are there */
export const EVERY_ASK: readonly Ask[] = [DEFAULT_ASK, ...Object.values(ASKS)]

/** asks, as `as` at the round's step, for what `ask` names */
export const requestAsk = (tenantId: string, instanceId: string, ask: Ask, as: Principal) =>
  Effect.gen(function* () {
    const assessment = yield* Assessment
    yield* assessment.requestSupplement(
      tenantId,
      instanceId,
      { instructions: ask.instructions, requirements: requirementsOf(ask) },
      as,
    )
  })

/**
 * Answers the round's open ask as its student: each file piece gets the
 * ask's picture, uploaded for the claim's question; a note goes where one is
 * asked for. False when nothing is open.
 */
export const answerAsk = (input: {
  readonly tenantId: string
  readonly batchId: string
  readonly itemId: string
  readonly instanceId: string
  readonly ask: Ask
  readonly as: Principal
}) =>
  Effect.gen(function* () {
    const assessment = yield* Assessment
    const { tenantId, ask, as } = input
    const round = yield* assessment.getReviewInstance(tenantId, input.instanceId, as)
    const open = round.supplements.find((one) => one.status === 'open')
    if (open === undefined) return false
    const payload: Record<string, unknown> = {}
    for (const asked of open.requirements) {
      if (asked.kind === 'file') {
        payload[asked.key] = [
          yield* stageProof(tenantId, input.batchId, input.itemId, ask.asset, ask.filename, as),
        ]
      } else if (ask.note !== undefined) {
        payload[asked.key] = ask.note
      }
    }
    yield* assessment.answerSupplement(tenantId, open.id, { payload }, as)
    return true
  })
