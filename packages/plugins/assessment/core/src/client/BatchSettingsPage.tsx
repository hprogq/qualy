import { BatchScreen } from './batch/BatchScreen.tsx'
import { BatchSettingsForm } from './batch/BatchSettingsForm.tsx'
import * as m from '#messages'

/** what the batch is called, what it covers, and what may happen to it */
export default function BatchSettingsPage() {
  return (
    <BatchScreen title={m.settings_tab()} description={m.settings_hint()} requires="manage">
      {(batch) => <BatchSettingsForm batch={batch} />}
    </BatchScreen>
  )
}
