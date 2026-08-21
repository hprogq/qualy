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

/** one asked-for piece of a supplement: a written answer or files */
export interface SupplementRequirementDto {
  key: string
  label: string
  kind: 'text' | 'file'
  required: boolean
}

/** the reviewer's open ask on this claim, if its round is waiting on one */
export interface EntrySupplementDto {
  requestId: string
  instanceId: string
  requestNo: number
  instructions: string
  requirements: readonly SupplementRequirementDto[]
  requestedByName: string | null
  requestedAt: string
}

export interface EntryDto {
  id: string
  batchId: string
  itemId: string
  participantId: string
  status: 'draft' | 'in_review' | 'needs_revision' | 'approved' | 'rejected' | 'voided'
  source: string
  currentRevision: EntryRevisionDto | null
  currentReviewInstanceId: string | null
  createdAt: string
  supplement: EntrySupplementDto | null
  /** why it came back, while it is waiting on its owner */
  refusal: {
    kind: string
    reason: string | null
    comment: string | null
    /** the reviewer's suggested rewrite, applied only by the owner's hand */
    suggestedPayload: unknown
    actorName: string | null
    at: string
  } | null
  capabilities: {
    edit: ActionAvailability
    submit: ActionAvailability
    withdraw: ActionAvailability
    appeal: ActionAvailability
    abandon: ActionAvailability
  }
}

/** offered, offered disabled with its reason, or not spoken of */
export interface ActionAvailability {
  state: 'available' | 'blocked' | 'hidden'
  reason: string | null
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
  /** why the question was withdrawn, when it was */
  voidReason: string | null
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
  needs_revision: m.entryStatusNeedsRevision,
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
  needs_revision: 'destructive',
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

/** what a file weighs, at the precision anybody reads it at */
export const sizeLabel = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * A limit, said the way a rule is said rather than the way a measurement is.
 *
 * `sizeLabel` reports what a file weighs, to a decimal; a ceiling of ten
 * megabytes is "10 MB", not "10.0 MB" - the decimal reads as precision about
 * a number that was chosen round.
 */
export const sizeLimitLabel = (bytes: number): string => {
  const mb = bytes / (1024 * 1024)
  if (mb >= 1) return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`
  const kb = bytes / 1024
  return `${Number.isInteger(kb) ? kb : Math.round(kb)} KB`
}

/**
 * What an administrator's accept list is called where people can read it.
 *
 * The list is written for a file picker - mime types, or bare extensions -
 * and printing it as it stands puts
 * `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
 * on screen. Known kinds get their everyday name; anything else falls back
 * to its own subtype, which is at least short.
 */
const KIND_NAMES: Record<string, string> = {
  'image/jpeg': 'JPG',
  'image/png': 'PNG',
  'image/webp': 'WEBP',
  'image/gif': 'GIF',
  'image/avif': 'AVIF',
  'image/heic': 'HEIC',
  'application/pdf': 'PDF',
  'text/plain': 'TXT',
  'application/zip': 'ZIP',
  'application/msword': 'DOC',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/vnd.ms-excel': 'XLS',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  'application/vnd.ms-powerpoint': 'PPT',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX',
}

export const fileKindLabels = (accept: readonly string[] | undefined): string | null => {
  if (accept === undefined || accept.length === 0) return null
  const names = accept.map((one) => {
    if (one.startsWith('.')) return one.slice(1).toUpperCase()
    const known = KIND_NAMES[one.toLowerCase()]
    if (known !== undefined) return known
    const subtype = one.split('/').at(-1) ?? one
    return (subtype.split('.').at(-1) ?? subtype).toUpperCase()
  })
  return [...new Set(names)].join(' / ')
}

/** the file types this product will draw rather than only offer to download */
export const LOOKS_LIKE_A_PHOTOGRAPH: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
])

/**
 * The types shown in the document previewer. Deliberately short: a pdf in
 * an iframe is the browser's own sandboxed viewer, while html or svg loaded
 * as a document would run - those stay downloads, which is the whole reason
 * the bytes are served as one.
 */
export const LOOKS_LIKE_A_DOCUMENT: ReadonlySet<string> = new Set(['application/pdf'])

/** amounts render without their bookkeeping zeros: 10.0000 reads as 10 */
export const trimAmount = (value: string): string =>
  value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value

/**
 * Amounts are counted, not floated.
 *
 * They are stored to four places, and every sum this product shows is money
 * in all but name: 0.1 three times is 0.30000000000000004 in a float, and a
 * screen that prints that has lied about somebody's marks. So arithmetic
 * happens on whole ten-thousandths and comes back out through `amountOf`.
 */
export const unitsOf = (value: string | number): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.round(parsed * 10_000) : 0
}

/** whole ten-thousandths back into something to read */
export const amountOf = (units: number): string => trimAmount((units / 10_000).toFixed(4))
