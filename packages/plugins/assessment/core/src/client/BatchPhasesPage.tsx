import { useI18n } from '@qualy/web-i18n'
import { BatchScreen } from './batch/BatchScreen.tsx'
import { PhaseTimelineEditor } from './PhaseTimelineEditor.tsx'
import { assessmentMessages as m } from './i18n.ts'

/** the stage plan of one batch */
export default function BatchPhasesPage() {
  const { format } = useI18n()
  // one editor per batch: the switcher keeps this page mounted, and a draft
  // begun on one batch is never laid over the plan of the next
  return (
    <BatchScreen title={format(m.tabPhases)} description={format(m.phasesHint)}>
      {(batch) => <PhaseTimelineEditor key={batch.id} batch={batch} />}
    </BatchScreen>
  )
}
