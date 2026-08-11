import { BatchScreen } from './batch/BatchScreen.tsx'
import { RosterPanel } from './RosterPanel.tsx'

/** who takes part in one batch */
export default function BatchParticipantsPage() {
  return <BatchScreen>{(batch) => <RosterPanel batch={batch} />}</BatchScreen>
}
