import { useI18n } from '@qualy/web-i18n'
import { BatchScreen } from './batch/BatchScreen.tsx'
import { AccessPanel } from './access/AccessPanel.tsx'
import { assessmentMessages as m } from './i18n.ts'

/** who may work on one batch, and what it accepted of their authority */
export default function BatchAccessPage() {
  const { format } = useI18n()
  return (
    <BatchScreen title={format(m.tabAccess)} description={format(m.accessHint)}>
      {(batch) => <AccessPanel batchId={batch.id} />}
    </BatchScreen>
  )
}
