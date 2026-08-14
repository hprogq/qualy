import type { MessageDescriptor } from '@qualy/i18n-contract'
import { assessmentMessages as m } from '../i18n.ts'

// The wire shapes these screens read, named once. They mirror the api
// group's views; the typed client checks the calls, these keep the pages
// from re-describing rows inline.

export interface EntryRevisionDto {
  id: string
  revisionNo: number
  itemRevisionId: string
  payload: unknown
  note: string | null
  source: string
  actorId: string
  subjectId: string
  attachments: readonly { attachmentId: string; position: number }[]
  createdAt: string
}

export interface EntryDto {
  id: string
  batchId: string
  itemId: string
  participantId: string
  status: 'draft' | 'in_review' | 'approved' | 'rejected' | 'voided'
  source: string
  currentRevision: EntryRevisionDto | null
  currentReviewInstanceId: string | null
  createdAt: string
  capabilities: { canEdit: boolean; canSubmit: boolean; canWithdraw: boolean }
}

export interface ItemDto {
  id: string
  batchId: string
  itemType: string
  title: string
  scoreGroupId: string
  maxEntries: number | null
  sortOrder: number
  status: string
  currentRevision: {
    id: string
    revisionNo: number
    entrySource: 'student' | 'administrative'
    formConfig: unknown
    scoringConfig: unknown
    reviewPolicy: unknown
    displayConfig: unknown
    reason: string | null
    createdAt: string
  } | null
  createdAt: string
}

export const entryStatusMessage: Record<EntryDto['status'], MessageDescriptor> = {
  draft: m.entryStatusDraft,
  in_review: m.entryStatusInReview,
  approved: m.entryStatusApproved,
  rejected: m.entryStatusRejected,
  voided: m.entryStatusVoided,
}

export const entryStatusVariant: Record<
  EntryDto['status'],
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  draft: 'outline',
  in_review: 'secondary',
  approved: 'default',
  rejected: 'destructive',
  voided: 'outline',
}

/** the evidence field list out of a form configuration, defensively */
export const fieldsOf = (
  formConfig: unknown,
): readonly import('./EvidenceForm.tsx').EvidenceFieldSpec[] =>
  Array.isArray((formConfig as { fields?: unknown[] } | null)?.fields)
    ? ((formConfig as { fields: unknown[] }).fields as never)
    : []

/** the url the api serves bytes at, for stores without their own door */
export const attachmentContentUrl = (attachmentId: string) =>
  `/api/assessment/attachments/${attachmentId}/content`

/**
 * The last day a half-open material range actually admits.
 *
 * The window is stored `[start, end)` - the day named by `end` is already
 * outside it - so a date picker offering it would offer a day the server
 * refuses.
 */
export const lastDay = (end: string): string => {
  const at = new Date(`${end}T00:00:00Z`)
  at.setUTCDate(at.getUTCDate() - 1)
  return at.toISOString().slice(0, 10)
}

/** amounts render without their bookkeeping zeros: 10.0000 reads as 10 */
export const trimAmount = (value: string): string =>
  value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value
