import { PAPERS } from './papers.ts'

/** Papers reserved for different current situations on the counsellor's desk. */
export const COUNSELLOR_PAPER_STORIES = [
  { kind: 'initial', item: 'application', flawed: false },
  { kind: 'revised', item: 'transcript', flawed: true },
  { kind: 'multiple-rounds', item: 'cet4', flawed: true },
  { kind: 'awaiting-supplement', item: 'application', flawed: true },
  { kind: 'answered-supplement', item: 'transcript', flawed: true },
  { kind: 'appeal', item: 'conduct', flawed: true },
  { kind: 'reopen', item: 'conduct', flawed: false },
  { kind: 'escalated', item: 'conduct', flawed: false },
] as const

export type CounsellorPaperStory = (typeof COUNSELLOR_PAPER_STORIES)[number]

/** Both revisions fix a visible problem: first the missing page, then the wrong score. */
export const CORRECTED_REPORT = {
  original: { score: 562, asset: PAPERS['cet4']!.flawed },
  complete: { score: 562, asset: 'certificate-1' },
  corrected: { score: 531, asset: 'certificate-1' },
} as const

/** The award parameters and its certificate are drawn as one event. */
export const SELECTION_AWARD_PROOFS = [
  { proof: 'competition-1', level: 'provincial', rank: 1, team: true },
  { proof: 'competition-2', level: 'national', rank: 3, team: false },
  { proof: 'competition-3', level: 'municipal', rank: 2, team: false },
  { proof: 'competition-4', level: 'provincial', rank: 1, team: false },
] as const

export interface SelectionHistory {
  readonly batchId: string
  readonly term: string
  readonly status: 'active' | 'archived'
}

/** An administrative import records what was read then; it never follows later scoring changes. */
export const historyBasis = (history: readonly SelectionHistory[], asOf: Date) => {
  const day = new Date(asOf.getTime() + 8 * 3_600_000).toISOString().slice(0, 10)
  const open = history.filter((batch) => batch.status === 'active').map((batch) => batch.term)
  const source = `本系统 ${history.map((batch) => batch.term).join('、')} 学期成绩，截至 ${day}`
  return open.length === 0
    ? source
    : `${source}；${open.join('、')} 为未结束批次的阶段性成绩，后续变化由工作人员核对后更正`
}
