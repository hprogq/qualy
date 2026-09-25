import type { Ask } from './asks.ts'

// The selection's qualifying papers, as an applicant sends them and as a
// reviewer finds them wanting.
//
// Each paper has a whole picture and one with the single thing missing that
// an ask or a refusal names: an application nobody signed, a conduct form
// without the head teacher's page, a transcript without the registry's
// stamp, a score report cut off above its scores. A reviewer asks for that
// thing, or refuses the paper for it, only on the picture that lacks it; the
// whole one is approved. What comes back in answer is the picture that has
// it, never the one that was filed.

export interface Paper {
  /** the paper as it should be */
  readonly whole: string
  /** the same paper, lacking what the ask and the refusal name */
  readonly flawed: string
  readonly filename: string
  /** what a reviewer asks for when it is missing */
  readonly ask: Ask
  /** what a reviewer says when refusing the paper for it; none where a refusal would end the application */
  readonly refusal?: { readonly reason: string; readonly comment: string }
}

/** the CET-4 reports applicants file, each with the score it shows */
export const CET4_REPORTS = [
  { asset: 'certificate-1', score: 531 },
  { asset: 'certificate-5', score: 562 },
  { asset: 'certificate-6', score: 598 },
] as const

export const PAPERS: Readonly<Record<string, Paper>> = {
  application: {
    whole: 'application-1',
    flawed: 'application-2',
    filename: '推免生申请表.jpg',
    ask: {
      instructions: '申请表缺少本人签字，请上传签字后的扫描件',
      file: '签字后的申请表',
      asset: 'application-1',
      filename: '推免生申请表（已签字）.jpg',
    },
  },
  conduct: {
    whole: 'conduct-1',
    flawed: 'conduct-2',
    filename: '思想品德考核表.jpg',
    ask: {
      instructions: '考核表缺少班主任签字页，请上传',
      file: '班主任签字页',
      asset: 'signature-1',
      filename: '考核表签字页.jpg',
    },
    refusal: { reason: '申报信息不完整', comment: '考核表缺少班主任签字页' },
  },
  transcript: {
    whole: 'transcript-1',
    flawed: 'transcript-2',
    filename: '成绩单.jpg',
    ask: {
      instructions: '成绩单缺少教务处盖章，请上传盖章页',
      file: '教务处盖章页',
      asset: 'transcript-1',
      filename: '成绩单盖章页.jpg',
    },
    refusal: { reason: '申报信息不完整', comment: '成绩单未加盖教务处公章，请提交盖章的成绩单' },
  },
  cet4: {
    whole: 'certificate-1',
    flawed: 'certificate-4',
    filename: '四级成绩报告单.jpg',
    // the report that comes back is the one showing the score filed (asks.ts)
    ask: {
      instructions: '成绩报告单截图不完整，请上传完整的成绩报告单',
      file: '成绩报告单',
      asset: 'certificate-1',
      filename: '四级成绩报告单.jpg',
    },
    refusal: { reason: '申报信息不完整', comment: '成绩报告单截图不完整，看不到成绩' },
  },
}

/** the CET-4 report showing a score, when one of them does */
export const cet4ReportFor = (score: unknown) =>
  CET4_REPORTS.find((report) => report.score === score)?.asset
