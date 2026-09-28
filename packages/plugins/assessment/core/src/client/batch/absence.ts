import { isRecordId, useLoadFailure } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import type { ResourceFailure } from '@qualy/ui/resource-state'
import { assessmentMessages as m } from '../i18n.ts'
import type { BatchDto } from '../phase/model.ts'

// Whether the batch a workspace is drawn around is there for this reader,
// said once for the bar above the rail and the screens below it.
//
// Gone, never there and not the reader's to see are one answer, because the
// server gives them one (§32.96): the words may not tell apart what the
// status code refuses to. An address that cannot name a batch at all is
// known to be absent without asking anybody.

/** the codes that mean the batch itself is not there for this reader */
const BATCH_MISSING = ['ASSESSMENT_BATCH_NOT_FOUND'] as const

export function useBatchAbsence(
  batchId: string,
  query: { readonly data: unknown; readonly error: unknown; readonly isError: boolean },
): ResourceFailure | null {
  const failure = useLoadFailure()
  const { format } = useI18n()
  const gone = { title: format(m.batchGoneTitle), description: format(m.batchGoneHint) }
  const copy = { missing: gone, denied: gone }
  if (!isRecordId(batchId)) return failure.missing({ copy })
  return failure.subject(query, { missing: BATCH_MISSING, copy })
}

/**
 * Which of the reader's standings in a batch a screen of it is for. The
 * records page says its own no to a reader who may not record, with what to
 * do about it, so it is not one of these.
 */
export type BatchStanding = 'personal' | 'review' | 'manage' | 'results'

/** whether the server's projection of the reader in this batch includes a standing */
export const holdsStanding = (
  capabilities: BatchDto['capabilities'],
  standing: BatchStanding,
): boolean =>
  standing === 'results'
    ? // whoever re-determines or records reads the accounts it covers
      // (ruling #33; assessment-design §30 #12)
      capabilities.manage || capabilities.redetermine || capabilities.record
    : capabilities[standing]
