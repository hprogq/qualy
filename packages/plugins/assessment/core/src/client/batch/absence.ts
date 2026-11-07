import { isRecordId, useLoadFailure } from '@qualy/web-runtime'
import type { ResourceFailure } from '@qualy/ui/resource-state'

import * as m from '#messages'

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

  const gone = { title: m.batch_goneTitle(), description: m.batch_goneHint() }
  const copy = { missing: gone, denied: gone }
  if (!isRecordId(batchId)) return failure.missing({ copy })
  return failure.subject(query, { missing: BATCH_MISSING, copy })
}
