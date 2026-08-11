import { BatchScreen } from './batch/BatchScreen.tsx'
import { PhaseTimelineEditor } from './PhaseTimelineEditor.tsx'

/** the stage plan of one batch */
export default function BatchPhasesPage() {
  return (
    <BatchScreen section="assessment/batch-phases">
      {(batch) => <PhaseTimelineEditor batch={batch} />}
    </BatchScreen>
  )
}
