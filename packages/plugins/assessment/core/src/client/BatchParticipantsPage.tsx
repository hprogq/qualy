import { useI18n } from '@qualy/web-i18n'
import { BatchScreen } from './batch/BatchScreen.tsx'
import { RosterPanel } from './RosterPanel.tsx'
import { assessmentMessages as m } from './i18n.ts'

/** who takes part in one batch */
export default function BatchParticipantsPage() {
  const { format } = useI18n()
  return (
    <BatchScreen title={format(m.tabRoster)} description={format(m.rosterHint)}>
      {(batch) => <RosterPanel batch={batch} />}
    </BatchScreen>
  )
}
