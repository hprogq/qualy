import { BatchScreen } from './batch/BatchScreen.tsx'
import { PhaseTimelineEditor } from './PhaseTimelineEditor.tsx'
import * as m from '#messages'

/** the stage plan of one batch */
export default function BatchPhasesPage() {
  // one editor per batch: the switcher keeps this page mounted, and a draft
  // begun on one batch is never laid over the plan of the next
  return (
    <BatchScreen title={m.phase_tab()} description={m.phase_hint()} requires="manage">
      {(batch) => <PhaseTimelineEditor key={batch.id} batch={batch} />}
    </BatchScreen>
  )
}
