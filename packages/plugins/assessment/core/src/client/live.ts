import { useApi, useApiStream } from '@qualy/web-runtime'
import { assessmentApi } from './api.ts'
import type { BatchLiveEvent } from '../api.ts'

// One batch's live wake-ups, for whichever screen holds it open. The screen
// says what each kind of wake-up refreshes; this hook only keeps the channel
// dialled and hands the kinds through. `live` is the degrade signal - false
// means the screen should fall back to its own polling cadence.

export function useBatchLive(
  batchId: string,
  onEvent: (kind: BatchLiveEvent['kind']) => void,
): { live: boolean } {
  const api = useApi(assessmentApi)
  // absent under a stubbed harness that does not fake this endpoint; the
  // hook then stays idle and the screen simply polls
  const there = typeof api.assessment.watchBatch === 'function'
  return useApiStream(
    there ? () => api.assessment.watchBatch({ params: { batchId } }) : undefined,
    (event) => onEvent(event.kind),
    { key: batchId },
  )
}
