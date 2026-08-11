import { useI18n } from '@qualy/web-i18n'
import { BatchScreen } from './batch/BatchScreen.tsx'
import { PhaseTimelineEditor } from './PhaseTimelineEditor.tsx'
import { assessmentMessages as m } from './i18n.ts'

/** the stage plan of one batch */
export default function BatchPhasesPage() {
  const { format } = useI18n()
  return (
    <BatchScreen title={format(m.tabPhases)} description={format(m.phasesHint)}>
      {(batch) => <PhaseTimelineEditor batch={batch} />}
    </BatchScreen>
  )
}
