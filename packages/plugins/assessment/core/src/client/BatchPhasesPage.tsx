import { BatchScreen } from './batch/BatchScreen.tsx'
import { PhaseTimelineEditor } from './PhaseTimelineEditor.tsx'

/** the stage plan of one batch */
export default function BatchPhasesPage() {
  return <BatchScreen>{(batch) => <PhaseTimelineEditor batch={batch} />}</BatchScreen>
}
