import { OFFERED_PHASE_CODES, type PhaseGatedCode } from '../../permission-codes.ts'
import * as m from '#messages'

// each action a stage may open, by its code: what it is called, and what it lets somebody do
export const PERMISSION_WORDS: Record<
  PhaseGatedCode,
  { readonly label: () => string; readonly hint: () => string }
> = {
  'assessment.entry.create': {
    label: m.permission_entryCreate,
    hint: m.permissionHint_entryCreate,
  },
  'assessment.entry.edit': { label: m.permission_entryEdit, hint: m.permissionHint_entryEdit },
  'assessment.entry.submit': {
    label: m.permission_entrySubmit,
    hint: m.permissionHint_entrySubmit,
  },
  'assessment.entry.withdraw': {
    label: m.permission_entryWithdraw,
    hint: m.permissionHint_entryWithdraw,
  },
  'assessment.entry.abandon': {
    label: m.permission_entryAbandon,
    hint: m.permissionHint_entryAbandon,
  },
  'assessment.entry.proxy': { label: m.permission_entryProxy, hint: m.permissionHint_entryProxy },
  'assessment.entry.record': {
    label: m.permission_entryRecord,
    hint: m.permissionHint_entryRecord,
  },
  'assessment.entry.appeal': {
    label: m.permission_entryAppeal,
    hint: m.permissionHint_entryAppeal,
  },
  'assessment.review.process': {
    label: m.permission_reviewProcess,
    hint: m.permissionHint_reviewProcess,
  },
  'assessment.review.escalate': {
    label: m.permission_reviewEscalate,
    hint: m.permissionHint_reviewEscalate,
  },
  'assessment.review.reopen': {
    label: m.permission_reviewReopen,
    hint: m.permissionHint_reviewReopen,
  },
  'assessment.review.view-reviewers': {
    label: m.permission_reviewViewReviewers,
    hint: m.permissionHint_reviewViewReviewers,
  },
  'assessment.review.view-chain': {
    label: m.permission_reviewViewChain,
    hint: m.permissionHint_reviewViewChain,
  },
  'assessment.result.view-peers': {
    label: m.permission_resultViewPeers,
    hint: m.permissionHint_resultViewPeers,
  },
  'assessment.ranking.view': {
    label: m.permission_rankingView,
    hint: m.permissionHint_rankingView,
  },
}

export const OPERATION_GROUPS: readonly {
  key: 'entry' | 'review' | 'result'
  codes: readonly PhaseGatedCode[]
}[] = [
  {
    key: 'entry',
    codes: OFFERED_PHASE_CODES.filter((code) => code.startsWith('assessment.entry.')),
  },
  {
    key: 'review',
    codes: OFFERED_PHASE_CODES.filter((code) => code.startsWith('assessment.review.')),
  },
  {
    key: 'result',
    codes: OFFERED_PHASE_CODES.filter(
      (code) => !code.startsWith('assessment.entry.') && !code.startsWith('assessment.review.'),
    ),
  },
]

export const GROUP_LABELS = {
  entry: m.permissionGroup_entry,
  review: m.permissionGroup_review,
  result: m.permissionGroup_result,
} as const
