import { useI18n } from '@qualy/web-i18n'
import { BatchScreen } from './batch/BatchScreen.tsx'
import { BatchSettingsForm } from './batch/BatchSettingsForm.tsx'
import { assessmentMessages as m } from './i18n.ts'

/** what the batch is called, what it covers, and what may happen to it */
export default function BatchSettingsPage() {
  const { format } = useI18n()
  return (
    <BatchScreen title={format(m.tabSettings)} description={format(m.settingsHint)}>
      {(batch) => <BatchSettingsForm batch={batch} />}
    </BatchScreen>
  )
}
