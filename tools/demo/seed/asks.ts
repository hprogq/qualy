import { Effect } from 'effect'
import type { Principal } from '@qualy/rbac-contract'
import { Assessment } from '@qualy/plugin-assessment/testkit'
import { stageProof } from './files.ts'
import { CET4_REPORTS, PAPERS, cet4ReportFor } from './papers.ts'

// What a reviewer asks for beyond the filing, and what comes back.
//
// Every ask in the demonstration asks for a file, and every answer uploads
// one through the question's own upload door, the way a browser would: a
// visitor who opens an answered ask sees the picture it talks about, and it
// is never the picture the claim was filed with. Text is only ever the note
// beside it.
//
// The chance flows ask only where a question has an ask of its own, and
// only on a claim the ask fits: a team's roster for a team award, a missing
// stamp on the transcript that lacks one (papers.ts). Anything else is
// approved or refused, not asked about.

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

/** a claim as it stands: its question, what it says, and the picture it cites */
export interface Filing {
  readonly item: string
  readonly payload: Readonly<Record<string, unknown>>
  readonly proof: string
}

/** an ask's pieces: the file, and room for a note */
export const requirementsOf = (ask: Ask) => [
  { label: ask.file, kind: 'file' as const, required: true },
  { label: '补充说明', kind: 'text' as const, required: false },
]

/** the ask each question with one makes, whatever the claim */
const ASKS: Readonly<Record<string, Ask>> = {
  campus: {
    instructions: '请上传活动通知中公布参与分值的页面截图',
    file: '活动通知截图',
    asset: 'campus-5',
    filename: '活动通知.jpg',
  },
  practice: {
    instructions: '请上传实践或服务单位盖章的鉴定意见',
    file: '盖章的鉴定意见',
    asset: 'practice-4',
    filename: '实践鉴定意见.jpg',
  },
  competition: {
    instructions: '请上传竞赛组委会公示的获奖名单截图',
    file: '获奖名单截图',
    asset: 'notice-1',
    filename: '获奖名单公示.jpg',
  },
  research: {
    instructions: '请上传能证明本人参与身份的材料，如项目任务书的成员分工页',
    file: '成员分工页',
    asset: 'research-4',
    filename: '成员分工页.jpg',
  },
}

/** a team award's ask: the page of the results book the team is on */
const ROSTER: Ask = {
  instructions: '证书为团体奖项，请上传赛事成绩册中本队所在页',
  file: '成绩册本队所在页',
  asset: 'roster-1',
  filename: '赛事成绩册.jpg',
}

/** what a class lead or a counsellor asks for on this claim, or nothing when it leaves nothing to ask */
export const askFor = (claim: Filing): Ask | undefined => {
  const paper = PAPERS[claim.item]
  if (paper !== undefined) {
    if (claim.proof !== paper.flawed) return undefined
    if (claim.item !== 'cet4') return paper.ask
    const report = cet4ReportFor(claim.payload['score'])
    return report === undefined ? undefined : { ...paper.ask, asset: report }
  }
  if (claim.item === 'sport') return claim.payload['team'] === true ? ROSTER : undefined
  return ASKS[claim.item]
}

/** every ask the chance flows can make, for checking the pictures are there */
export const EVERY_ASK: readonly Ask[] = [
  ...Object.values(ASKS),
  ROSTER,
  ...Object.values(PAPERS).map((paper) => paper.ask),
  ...CET4_REPORTS.map((report) => ({ ...PAPERS['cet4']!.ask, asset: report.asset })),
]

/**
 * The asks the persona's episodes and the selection's scenes make, each with
 * the picture the claim it is made on was filed with (`on`): the claim is
 * filed with that picture, and what comes back is another one.
 */
export const SCRIPTED_ASKS = {
  // 23-24-1: a prize claimed on a participation note, which names no place
  placeInList: {
    on: 'campus-1',
    ask: {
      instructions:
        '所附为参与证明，没有获奖名次，请上传获奖名单公示页截图，并在说明里写明本人所在行',
      file: '获奖名单公示页截图',
      asset: 'notice-1',
      filename: '获奖名单公示.jpg',
      note: '本人在二等奖名单第 17 行',
    },
  },
  // 23-24-2: filed with another contest's certificate; the right one comes in the appeal
  rightCertificate: {
    on: 'competition-3',
    ask: {
      instructions: '请上传该竞赛的获奖证书',
      file: '获奖证书',
      asset: 'competition-4',
      filename: '获奖证书.jpg',
    },
  },
  // 24-25-2: the organisers corrected their list after the claim was determined
  correctedList: {
    on: 'competition-4',
    ask: {
      instructions: '请上传组委会发布的获奖名单更正公告截图',
      file: '获奖名单更正公告',
      asset: 'notice-3',
      filename: '获奖名单更正公告.jpg',
      note: '本人参赛编号为 DEMO-0415',
    },
  },
  // the selection: a university project claimed as a provincial one
  provincialProject: {
    on: 'research-1',
    ask: {
      instructions:
        '立项通知书显示为校级立项，与申报的省部级不一致；如已升为省级项目，请上传省级立项通知书',
      file: '省级立项通知书',
      asset: 'research-3',
      filename: '省级立项通知书.jpg',
      note: '项目已于 2025 年 11 月升为省级立项',
    },
  },
  // the selection: a zone's award, appealed as the province's
  zoneNotice: {
    on: 'competition-5',
    ask: {
      instructions: '请上传省赛组委会关于赛区获奖认定的通知',
      file: '组委会获奖通知',
      asset: 'notice-2',
      filename: '组委会获奖通知.jpg',
      note: '通知写明赛区获奖按省级认定',
    },
  },
  // the selection: an award the published list does not show; still out
  officialList: {
    on: 'competition-4',
    ask: {
      instructions: '请提供竞赛官网获奖名单截图，并在说明里写明本人所在行',
      file: '获奖名单截图',
      asset: 'notice-1',
      filename: '获奖名单截图.jpg',
    },
  },
} as const satisfies Readonly<Record<string, { readonly on: string; readonly ask: Ask }>>

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
