import type { EntryHistoryView, EntryView } from '../entry/service.ts'
import type { ReviewDetailView } from '../review/service.ts'

// Citation positions are domain data. Do not recursively interpret arbitrary
// payload keys as files: only the item type's validated citation list counts.
export const entryFileIds = (entry: EntryView): readonly string[] =>
  (entry.currentRevision?.attachments ?? []).map((file) => file.attachmentId)

export const historyFileIds = (history: EntryHistoryView): readonly string[] => [
  ...history.revisions.flatMap((revision) => revision.attachments.map((file) => file.attachmentId)),
  ...history.rounds.flatMap((round) =>
    round.supplements.flatMap((supplement) =>
      (supplement.response?.attachments ?? []).map((file) => file.attachmentId),
    ),
  ),
]

export const reviewFileIds = (review: ReviewDetailView): readonly string[] => [
  ...(review.context?.previousRevision?.attachments ?? []).map((file) => file.attachmentId),
  ...review.revision.attachments.map((file) => file.attachmentId),
  ...review.supplements.flatMap((supplement) =>
    (supplement.response?.attachments ?? []).map((file) => file.attachmentId),
  ),
]
